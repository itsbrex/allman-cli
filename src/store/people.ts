/**
 * Person records — one owner for person facts (ADR-0003).
 *
 * All three phases live here:
 *
 * - **Phase 0** — `readPerson` joins the connection record and the
 *   conversation record at read time.
 * - **Phase 1** — `applyObservations` writes `people/{flagshipId}.json`
 *   (+ slug symlink) with per-field provenance, under the ADR-0004 overwrite
 *   policy. Enrich keeps mirroring the same facts onto `StoredConnection` as a
 *   declared back-compat shim.
 * - **Phase 2** — `readPerson` prefers the person record: fields it carries
 *   win outright; the mirrors only fill the gaps.
 *
 * Join key: `ConversationRecord.profileId` and `StoredConnection.flagshipId`
 * are the same flagship id. Mirror merge policy: the newer record wins per
 * field (connection `lastSeenAt` vs conversation `fetchedAt`), but a null on
 * the newer side never clobbers a real value from the older side — same
 * never-downgrade rule the write paths follow.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GeoGranularity } from "../linkedin/api/endpoints/profile-detail.js";
import { forceAlias } from "./alias.js";
import type { StoredConnection, StoredEducation, StoredPosition } from "./connections-store.js";
import { ConnectionsStore } from "./connections-store.js";
import { ConversationStore } from "./conversations.js";
import type { ObservationSet, Provenance } from "./enricher.js";
import type { StoreGit } from "./git.js";
import type { ConversationRecord, ProfilePicture } from "./types.js";

/**
 * The person record (ADR-0003). From Phase 1 this is the shape written to
 * `{account}/people/{flagshipId}.json`; in Phase 0 it is only materialized
 * in memory by `readPerson`. Relationship facts (`connectedAt`, `source`)
 * and conversation state stay on their own records.
 */
export interface StoredPerson {
  /** Flagship profile id (`ACo…`) — the join key and (from Phase 1) the filename key. */
  flagshipId: string;
  /** `urn:li:fsd_profile:{flagshipId}` */
  memberUrn: string;
  /** `urn:li:member:<n>` — the SalesNav bridge (LinkedIn's `objectUrn`). */
  objectUrn?: string | null;
  /** The numeric member id alone. */
  memberId?: string | null;
  /** Slug — mutable, so it merges newest-wins like any other fact. */
  publicIdentifier: string | null;
  firstName?: string | null;
  lastName?: string | null;
  headline?: string | null;
  /** Current role title. */
  title?: string | null;
  /** Current employer name. */
  company?: string | null;
  /** `urn:li:fsd_company:<id>` of the current employer. */
  companyUrn?: string | null;
  /** Human-readable location (e.g. "San Francisco Bay Area"). */
  location?: string | null;
  /** ISO-3166 alpha-2 country code. */
  country?: string | null;
  /** `urn:li:fsd_geo:<id>` — stable location identity, unlike the label. */
  geoUrn?: string | null;
  /** LinkedIn's label for the geo entity behind `geoUrn` (ADR-0001). */
  geoName?: string | null;
  /** Precision of `geoUrn` (ADR-0001): metro, country, or unknown. */
  geoGranularity?: GeoGranularity | null;
  about?: string | null;
  industry?: string | null;
  industryUrn?: string | null;
  /** The profile's free-text website/address contact field. */
  address?: string | null;
  /** Standardized pronoun, e.g. "SHE_HER". */
  pronoun?: string | null;
  premium?: boolean | null;
  /** True for a memorialized (deceased) member — exclude from outreach. */
  memorialized?: boolean | null;
  /** Signed and expiring CDN URL — a cache, not a permalink. */
  profilePictureUrl?: string | null;
  /** Locale tag like "en_US". */
  primaryLocale?: string | null;
  positions?: StoredPosition[] | null;
  education?: StoredEducation[] | null;
  skills?: string[] | null;
  /**
   * Per-field provenance stamps (ADR-0004), written by `applyObservations`.
   * Absent on fields that were only ever joined in from the mirrors.
   */
  provenance?: Record<string, Provenance>;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Every person fact: what `applyObservations` accepts and `readPerson` merges. */
const MERGED_FIELDS = [
  "memberUrn",
  "objectUrn",
  "memberId",
  "publicIdentifier",
  "firstName",
  "lastName",
  "headline",
  "title",
  "company",
  "companyUrn",
  "location",
  "country",
  "geoUrn",
  "geoName",
  "geoGranularity",
  "about",
  "industry",
  "industryUrn",
  "address",
  "pronoun",
  "premium",
  "memorialized",
  "profilePictureUrl",
  "primaryLocale",
  "positions",
  "education",
  "skills",
] as const;

/** A field name `applyObservations` accepts and `readPerson` merges. */
export type PersonFactField = (typeof MERGED_FIELDS)[number];

type PersonFacts = Partial<Pick<StoredPerson, PersonFactField>>;

const PERSON_FACT_FIELDS: ReadonlySet<string> = new Set(MERGED_FIELDS);

/**
 * ADR-0004 overwrite ranking:
 * "user" > enrich-deep > enrich-core > sweep > everything else.
 * New namespaces slot below the LinkedIn tiers until an ADR says otherwise.
 */
const SOURCE_RANK: Record<string, number> = {
  user: 4,
  "linkedin/enrich-deep": 3,
  "linkedin/enrich-core": 2,
  "linkedin/sweep": 1,
};

function sourceRank(source: string): number {
  return SOURCE_RANK[source] ?? 0;
}

/**
 * Build an `ObservationSet` from resolved person facts, all stamped with one
 * provenance. Null and undefined facts are dropped: a partial fetch says
 * nothing about the fields it did not resolve, and the never-downgrade rule
 * means an absent fact must not erase a stored one.
 */
export function observationsFrom(facts: PersonFacts, provenance: Provenance): ObservationSet {
  const out: ObservationSet = {};
  for (const [field, value] of Object.entries(facts)) {
    if (value === undefined || value === null) continue;
    out[field] = { value, provenance };
  }
  return out;
}

export class PeopleStore {
  private readonly connections: ConnectionsStore;
  private readonly conversations: ConversationStore;

  constructor(
    private readonly accountDir: string,
    git: StoreGit
  ) {
    this.connections = new ConnectionsStore(accountDir, git);
    this.conversations = new ConversationStore(accountDir, git);
  }

  private peopleDir(): string {
    return join(this.accountDir, "people");
  }

  /**
   * Read the joined person view by flagship id or slug. Null when no store
   * knows the person. Fields carried by the `people/` record win outright
   * (Phase 2); connection and conversation mirrors fill the gaps. Only
   * flagship-identified people resolve here — salesnav-only rows wait for
   * `resolveSalesnavIdsFromFlagshipIds` (ADR-0003's materialization rule).
   */
  async readPerson(idOrSlug: string): Promise<StoredPerson | null> {
    const conn = await this.connections.readConnectionByKey(idOrSlug);
    const person = await this.readPersonRecord(conn?.flagshipId ?? idOrSlug);
    const conv = await this.readConversation(conn?.flagshipId ?? person?.flagshipId, idOrSlug);
    if (!person && !conn && !conv) return null;
    return mergePerson(person, conn, conv);
  }

  /**
   * Read the raw `people/{flagshipId}.json` record by flagship id or slug
   * (slugs resolve through the symlink). Null when it doesn't exist yet —
   * records materialize when an enricher first observes the person (Phase 1).
   */
  async readPersonRecord(idOrSlug: string): Promise<StoredPerson | null> {
    for (const name of [`${idOrSlug}.json`, idOrSlug]) {
      try {
        return JSON.parse(await readFile(join(this.peopleDir(), name), "utf8")) as StoredPerson;
      } catch {
        // try the next name
      }
    }
    return null;
  }

  /**
   * Every flagship id that resolves to a person view: person records plus
   * connection records. (Conversation-only people are readable by id but are
   * not enumerated — there is no per-account index of contact profile ids.)
   */
  async listPersonIds(): Promise<string[]> {
    const ids = new Set<string>(await this.connections.listConnectionIds());
    try {
      for (const name of await readdir(this.peopleDir())) {
        if (name.endsWith(".json")) ids.add(name.slice(0, -".json".length));
      }
    } catch {
      // no people/ directory yet
    }
    return [...ids];
  }

  /**
   * Apply an enricher's observations to `people/{flagshipId}.json`, creating
   * the record if absent (Phase 1, ADR-0003/0004). Per field, a write lands
   * only when its provenance is equal-or-better than what the field already
   * carries, and `"user"`-sourced values are never auto-overwritten. Field
   * names are validated against the person-fact shape — an unknown field is a
   * contract violation and throws.
   */
  async applyObservations(
    identity: { flagshipId: string; memberUrn?: string },
    observations: ObservationSet,
    nowIso: string
  ): Promise<StoredPerson> {
    const { flagshipId } = identity;
    const prev = await this.readPersonRecord(flagshipId);
    const rec: StoredPerson = prev ?? {
      flagshipId,
      memberUrn: identity.memberUrn ?? `urn:li:fsd_profile:${flagshipId}`,
      publicIdentifier: null,
      provenance: {},
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
    };
    const provenance = rec.provenance ?? {};
    rec.provenance = provenance;
    const target = rec as unknown as Record<string, unknown>;

    for (const [field, obs] of Object.entries(observations)) {
      if (!PERSON_FACT_FIELDS.has(field)) {
        throw new Error(`Unknown person field in observation set: "${field}"`);
      }
      const existing = provenance[field];
      if (existing?.source === "user") continue;
      if (existing && sourceRank(existing.source) > sourceRank(obs.provenance.source)) continue;
      target[field] = obs.value;
      provenance[field] = obs.provenance;
    }

    rec.firstSeenAt = prev?.firstSeenAt ?? nowIso;
    rec.lastSeenAt = nowIso;

    const dir = this.peopleDir();
    await mkdir(dir, { recursive: true });
    const file = `${flagshipId}.json`;
    await writeFile(join(dir, file), `${JSON.stringify(rec, null, 2)}\n`, "utf8");
    if (rec.publicIdentifier) await forceAlias(dir, rec.publicIdentifier, file);
    return rec;
  }

  /**
   * Find the person's conversation record: prefer the stable flagship id
   * (its symlink always exists), fall back to the raw input so a slug still
   * resolves when no connection record exists.
   */
  private async readConversation(
    flagshipId: string | undefined,
    input: string
  ): Promise<ConversationRecord | null> {
    for (const key of new Set([flagshipId, input])) {
      if (!key) continue;
      const convId = await this.conversations.resolve(key);
      if (!convId) continue;
      const record = await this.conversations.read(convId);
      if (record) return record;
    }
    return null;
  }
}

function mergePerson(
  person: StoredPerson | null,
  conn: StoredConnection | null,
  conv: ConversationRecord | null
): StoredPerson {
  const merged: Record<string, unknown> = {};
  // Phase 2: the person record owns the fields it carries — a newer mirror
  // never overrides them (only `applyObservations` may, under provenance).
  const owned = new Set<string>();
  if (person) {
    for (const field of MERGED_FIELDS) {
      const value = (person as unknown as Record<string, unknown>)[field];
      if (value !== undefined) {
        merged[field] = value;
        owned.add(field);
      }
    }
  }

  // Mirrors, newest first; a tie keeps the connection record (the canonical
  // store) ahead of the conversation cache. ISO timestamps compare as strings.
  const mirrors = [
    conn ? { at: conn.lastSeenAt, facts: connectionFacts(conn) } : null,
    conv ? { at: conv.fetchedAt, facts: conversationFacts(conv) } : null,
  ]
    .filter((s): s is { at: string; facts: PersonFacts } => s !== null)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  for (const source of mirrors) {
    for (const field of MERGED_FIELDS) {
      if (owned.has(field)) continue;
      if (merged[field] === undefined || merged[field] === null) {
        const value = source.facts[field];
        if (value !== undefined) merged[field] = value;
      }
    }
  }

  // At least one source exists, so flagshipId and a lastSeenAt stamp always resolve.
  const flagshipId = (person?.flagshipId ?? conn?.flagshipId ?? conv?.profileId) as string;
  return {
    ...merged,
    flagshipId,
    memberUrn: (merged.memberUrn as string | undefined) ?? `urn:li:fsd_profile:${flagshipId}`,
    publicIdentifier: (merged.publicIdentifier as string | undefined) ?? null,
    ...(person?.provenance ? { provenance: person.provenance } : {}),
    firstSeenAt: minIso(person?.firstSeenAt, conn?.firstSeenAt) ?? (conv?.fetchedAt as string),
    lastSeenAt: maxIso(person?.lastSeenAt, conn?.lastSeenAt, conv?.fetchedAt) as string,
  } as StoredPerson;
}

/** Earliest of the given ISO stamps (they compare as strings), if any. */
function minIso(...stamps: Array<string | undefined>): string | undefined {
  return stamps.filter((s): s is string => s !== undefined).sort()[0];
}

/** Latest of the given ISO stamps, if any. */
function maxIso(...stamps: Array<string | undefined>): string | undefined {
  return stamps
    .filter((s): s is string => s !== undefined)
    .sort()
    .at(-1);
}

function connectionFacts(c: StoredConnection): PersonFacts {
  return {
    memberUrn: c.memberUrn,
    objectUrn: c.objectUrn,
    memberId: c.memberId,
    publicIdentifier: c.publicIdentifier,
    firstName: c.firstName,
    lastName: c.lastName,
    headline: c.headline,
    title: c.title,
    company: c.company,
    companyUrn: c.companyUrn,
    location: c.location,
    country: c.country,
    geoUrn: c.geoUrn,
    geoName: c.geoName,
    geoGranularity: c.geoGranularity,
    about: c.about,
    industry: c.industry,
    industryUrn: c.industryUrn,
    address: c.address,
    pronoun: c.pronoun,
    premium: c.premium,
    memorialized: c.memorialized,
    profilePictureUrl: c.profilePictureUrl,
    primaryLocale: c.primaryLocale,
    positions: c.positions,
    education: c.education,
    skills: c.skills,
  };
}

function conversationFacts(r: ConversationRecord): PersonFacts {
  return {
    // ConversationRecord.profileUrn is the fsd_profile urn; its `memberUrn`
    // is the numeric `urn:li:member:<n>` — the person record's objectUrn.
    memberUrn: r.profileUrn,
    objectUrn: r.memberUrn,
    memberId: r.memberUrn ? (r.memberUrn.split(":").pop() ?? null) : null,
    publicIdentifier: r.slug,
    firstName: r.firstName,
    lastName: r.lastName,
    headline: r.headline,
    pronoun: r.pronoun,
    premium: r.isPremium,
    profilePictureUrl: largestPicture(r.profilePictures),
  };
}

function largestPicture(pictures: ProfilePicture[] | null): string | null {
  let best: ProfilePicture | null = null;
  for (const p of pictures ?? []) {
    if (!best || p.width > best.width) best = p;
  }
  return best?.url ?? null;
}
