/**
 * Person records — one owner for person facts (ADR-0003).
 *
 * Phase 0 (this file): `readPerson` is a read-only join view over the two
 * places person facts already live — the connection record and the
 * conversation record — merged at read time. Nothing is written to disk;
 * `people/{flagshipId}.json` arrives in Phase 1 (enrich dual-writes with
 * provenance) and Phase 2 makes this reader prefer it. Callers build against
 * `readPerson` now so those phases change no callers.
 *
 * Join key: `ConversationRecord.profileId` and `StoredConnection.flagshipId`
 * are the same flagship id. Merge policy: the newer record wins per field
 * (connection `lastSeenAt` vs conversation `fetchedAt`), but a null on the
 * newer side never clobbers a real value from the older side — same
 * never-downgrade rule the write paths follow.
 */
import type { StoredConnection, StoredEducation, StoredPosition } from "./connections-store.js";
import { ConnectionsStore } from "./connections-store.js";
import { ConversationStore } from "./conversations.js";
import type { Provenance } from "./enricher.js";
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
  /** Per-field provenance stamps. Written from Phase 1; absent on Phase-0 joined views. */
  provenance?: Record<string, Provenance>;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Every fact `readPerson` merges newest-wins across its two sources. */
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

type PersonFacts = Partial<Pick<StoredPerson, (typeof MERGED_FIELDS)[number]>>;

export class PeopleStore {
  private readonly connections: ConnectionsStore;
  private readonly conversations: ConversationStore;

  constructor(accountDir: string, git: StoreGit) {
    this.connections = new ConnectionsStore(accountDir, git);
    this.conversations = new ConversationStore(accountDir, git);
  }

  /**
   * Read the joined person view by flagship id or slug. Null when neither
   * store knows the person. Only flagship-identified people resolve here —
   * salesnav-only rows wait for `resolveSalesnavIdsFromFlagshipIds`
   * (ADR-0003's materialization rule).
   */
  async readPerson(idOrSlug: string): Promise<StoredPerson | null> {
    const conn = await this.connections.readConnectionByKey(idOrSlug);
    const conv = await this.readConversation(conn?.flagshipId, idOrSlug);
    if (!conn && !conv) return null;
    return mergePerson(conn, conv);
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

function mergePerson(conn: StoredConnection | null, conv: ConversationRecord | null): StoredPerson {
  // Newest source first; a tie keeps the connection record (the canonical
  // store) ahead of the conversation cache. ISO timestamps compare as strings.
  const sources = [
    conn ? { at: conn.lastSeenAt, facts: connectionFacts(conn) } : null,
    conv ? { at: conv.fetchedAt, facts: conversationFacts(conv) } : null,
  ]
    .filter((s): s is { at: string; facts: PersonFacts } => s !== null)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const merged: Record<string, unknown> = {};
  for (const source of sources) {
    for (const field of MERGED_FIELDS) {
      if (merged[field] === undefined || merged[field] === null) {
        const value = source.facts[field];
        if (value !== undefined) merged[field] = value;
      }
    }
  }

  // At least one source exists, so flagshipId and a lastSeenAt stamp always resolve.
  const flagshipId = (conn?.flagshipId ?? conv?.profileId) as string;
  return {
    ...merged,
    flagshipId,
    memberUrn: (merged.memberUrn as string | undefined) ?? `urn:li:fsd_profile:${flagshipId}`,
    publicIdentifier: (merged.publicIdentifier as string | undefined) ?? null,
    firstSeenAt: conn?.firstSeenAt ?? (conv?.fetchedAt as string),
    lastSeenAt: (sources[0]?.at ?? sources[1]?.at) as string,
  } as StoredPerson;
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
