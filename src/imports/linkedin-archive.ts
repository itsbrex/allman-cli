/** Offline archive normalization. No browser, provider, or network dependencies. */
import { normalizeLinkedInUrl } from "../attio/people.js";
import type { IdentityCache } from "../attio/salesnav-list.js";
import { stableId } from "../mail/store.js";
import type { StoredConnection } from "../store/connections-store.js";
import type { ObservationSet } from "../store/enricher.js";
import { meaningful } from "../store/observations.js";
import type { StoredPerson } from "../store/people.js";

export interface ArchiveSource {
  id: string;
  kind: "connections" | "rich-connections" | "messages" | "invitations";
  /** Export snapshot date, not a claim that every field was observed then. */
  exportedAt: string;
  /** How the snapshot date was established; file timestamps are not live observation times. */
  dateBasis?: string;
  originalPath: string;
  rawPath: string;
  rows: Record<string, string>[];
}
export interface ArchiveBundle {
  version: 1;
  account: string;
  ownerProfileUrl: string;
  sources: ArchiveSource[];
}
export interface ArchivedEvent {
  id: string;
  account: string;
  kind: "message" | "invitation";
  thread: string;
  timestamp: number;
  timestampPrecision: "instant" | "date";
  originalTimestamp: string;
  direction: "inbound" | "outbound" | "unknown";
  participants: { url: string; name: string }[];
  subject: string;
  body: string;
  draft: boolean;
  sourceRefs: string[];
  /** Invitation exports do not report acceptance or current pending status. */
  status: "historical-message" | "historical-draft" | "historical-invitation; acceptance-unknown";
}
export interface HistoricalEmail {
  flagshipId: string;
  email: string;
  sourceField: string;
  sourceRef: string;
  exportedAt: string;
}
export interface LinkedInArchive {
  version: 1;
  account: string;
  sources: Omit<ArchiveSource, "rows">[];
  events: ArchivedEvent[];
  emails: HistoricalEmail[];
}
const ref = (source: ArchiveSource, index: number) => `${source.rawPath}#record=${index + 1}`;
const value = (s: string | undefined) => {
  const trimmed = s?.trim() ?? "";
  return /^(null|undefined|n\/a)$/i.test(trimmed) ? "" : trimmed;
};
const fid = (id: string) => /^ACo[\w-]{10,}$/.test(id);
const sid = (id: string) => /^ACw[\w-]{10,}$/.test(id);
const profileUrl = (slug: string | null | undefined) =>
  slug ? normalizeLinkedInUrl(`https://www.linkedin.com/in/${slug}`) : null;

/** Ambiguous public URLs cannot identify anyone. Names are never join keys. */
export function archiveMatcher(rows: StoredConnection[]) {
  const byId = new Map(rows.map((r) => [r.flagshipId, r]));
  const byUrl = new Map<string, StoredConnection | null>();
  for (const row of rows) {
    for (const url of [profileUrl(row.publicIdentifier), profileUrl(row.flagshipId)]) {
      if (!url) continue;
      byUrl.set(url, byUrl.has(url) && byUrl.get(url)?.flagshipId !== row.flagshipId ? null : row);
    }
  }
  return (data: Record<string, string>, rich: boolean): StoredConnection | null => {
    const url = normalizeLinkedInUrl(data[rich ? "linkedin_profile_url" : "URL"] ?? "");
    if (!rich) return url ? (byUrl.get(url) ?? null) : null;
    const row = byId.get(data.linkedin_id ?? "");
    if (!row || !fid(row.flagshipId)) return null;
    const slugUrl = profileUrl(data.linkedin_public_id);
    const currentUrl = profileUrl(row.publicIdentifier);
    // Both stable ID and current public slug must agree; reject conflicting URL evidence.
    if (!currentUrl || slugUrl !== currentUrl || byUrl.get(currentUrl) !== row) return null;
    if (url && url !== currentUrl && url !== profileUrl(row.flagshipId)) return null;
    return row;
  };
}

/** Only requested list members; require globally one-to-one, corroborated ID pairs. */
export function archiveMappings(
  sources: ArchiveSource[],
  rows: StoredConnection[],
  cache: IdentityCache,
  missingSalesnavIds: Set<string>
) {
  const match = archiveMatcher(rows);
  const forward = new Map<string, Set<string>>(),
    reverse = new Map<string, Set<string>>();
  const evidence: { flagshipId: string; salesnavId: string; sourceRef: string }[] = [];
  const add = (f: string, s: string) => {
    forward.set(f, new Set([...(forward.get(f) ?? []), s]));
    reverse.set(s, new Set([...(reverse.get(s) ?? []), f]));
  };
  for (const [f, s] of Object.entries(cache.mappings)) add(f, s);
  for (const source of sources.filter((s) => s.kind === "rich-connections")) {
    source.rows.forEach((data, index) => {
      const f = data.linkedin_id ?? "";
      let s = "";
      try {
        const url = new URL(data.salesnavigator_url ?? "");
        if (url.protocol === "https:" && /^(www\.)?linkedin\.com$/.test(url.hostname))
          s = /^\/sales\/lead\/(ACw[\w-]+)/.exec(url.pathname)?.[1] ?? "";
      } catch {
        /* An invalid URL is not identity evidence. */
      }
      if (!fid(f) || !sid(s)) return;
      // Even an uncorroborated row can reveal a collision; it cannot create a mapping.
      add(f, s);
      const row = match(data, true);
      if (row && (row.source ?? "connections") === "connections")
        evidence.push({ flagshipId: f, salesnavId: s, sourceRef: ref(source, index) });
    });
  }
  return [...new Map(evidence.map((e) => [e.flagshipId, e])).values()].filter(
    (e) =>
      missingSalesnavIds.has(e.salesnavId) &&
      !cache.mappings[e.flagshipId] &&
      forward.get(e.flagshipId)?.size === 1 &&
      reverse.get(e.salesnavId)?.size === 1
  );
}

export function archiveFacts(sources: ArchiveSource[], rows: StoredConnection[]) {
  const match = archiveMatcher(rows);
  const candidates = new Map<
    string,
    Map<string, { at: string; values: Map<string, unknown>; ref: string }>
  >();
  const emails: HistoricalEmail[] = [];
  let matchedRows = 0,
    unmatchedRows = 0;
  for (const source of sources) {
    if (!["connections", "rich-connections"].includes(source.kind)) continue;
    const rich = source.kind === "rich-connections";
    source.rows.forEach((data, index) => {
      const row = match(data, rich);
      if (!row) {
        unmatchedRows++;
        return;
      }
      matchedRows++;
      const sourceRef = ref(source, index);
      const facts: Record<string, unknown> = rich
        ? {
            title: value(data.job),
            company: value(data.company),
            location: value(data.location),
            headline: value(data.headline),
            about: value(data.summary),
            industry: value(data.industry),
            skills: [
              ...new Set(
                value(data.all_skills)
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean)
              ),
            ],
          }
        : { title: value(data.Position), company: value(data.Company) };
      const fields = candidates.get(row.flagshipId) ?? new Map();
      for (const [field, fact] of Object.entries(facts)) {
        if (!meaningful(fact)) continue;
        const previous = fields.get(field);
        if (!previous || previous.at < source.exportedAt)
          fields.set(field, {
            at: source.exportedAt,
            values: new Map([[JSON.stringify(fact), fact]]),
            ref: sourceRef,
          });
        else if (previous.at === source.exportedAt) previous.values.set(JSON.stringify(fact), fact);
      }
      candidates.set(row.flagshipId, fields);
      for (const field of rich ? ["email", "email_enrich", "uploaded_email"] : ["Email Address"]) {
        const email = value(data[field]).toLowerCase();
        if (/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email))
          emails.push({
            flagshipId: row.flagshipId,
            email,
            sourceField: field,
            sourceRef,
            exportedAt: source.exportedAt,
          });
      }
    });
  }
  const facts = new Map<string, ObservationSet>();
  let ambiguousFields = 0;
  for (const [id, fields] of candidates) {
    const observations: ObservationSet = {};
    for (const [field, c] of fields) {
      if (c.values.size !== 1) {
        ambiguousFields++;
        continue;
      }
      observations[field] = {
        value: [...c.values.values()][0],
        provenance: {
          source: "linkedin/archive",
          observedAt: c.at,
          sourceRef: c.ref,
        },
      };
    }
    facts.set(id, observations);
  }
  return { facts, emails, matchedRows, unmatchedRows, ambiguousFields };
}

/** Joined values and explicit provenance-owned blanks both outrank historical fills. */
export function missingArchiveFacts(person: StoredPerson, facts: ObservationSet): ObservationSet {
  return Object.fromEntries(
    Object.entries(facts).filter(
      ([field]) =>
        !meaningful((person as unknown as Record<string, unknown>)[field]) &&
        !person.provenance?.[field]
    )
  );
}

function urls(text: string) {
  return [
    ...new Set(
      (text.match(/https?:\/\/[^\s,;]+/g) ?? [])
        .map(normalizeLinkedInUrl)
        .filter((u): u is string => !!u)
    ),
  ];
}
function invitationDay(input: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4}),/.exec(input);
  if (!m) return null;
  const year = Number(m[3]) + (m[3]?.length === 2 ? 2000 : 0);
  // Noon UTC is a sorting surrogate only. No timezone was provided by this export.
  const date = new Date(Date.UTC(year, Number(m[1]) - 1, Number(m[2]), 12));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === Number(m[1]) - 1 &&
    date.getUTCDate() === Number(m[2])
    ? date.getTime()
    : null;
}
export function archiveEvents(bundle: ArchiveBundle) {
  const owner = normalizeLinkedInUrl(bundle.ownerProfileUrl);
  if (!owner) throw new Error("Invalid archive owner profile URL");
  const events = new Map<string, ArchivedEvent>();
  let invalidDates = 0;
  for (const source of bundle.sources) {
    if (source.kind !== "messages" && source.kind !== "invitations") continue;
    const invitation = source.kind === "invitations";
    const occurrences = new Map<string, number>();
    source.rows.forEach((row, index) => {
      const from = urls(row[invitation ? "inviterProfileUrl" : "SENDER PROFILE URL"] ?? "");
      const to = urls(row[invitation ? "inviteeProfileUrl" : "RECIPIENT PROFILE URLS"] ?? "");
      const originalTimestamp = row[invitation ? "Sent At" : "DATE"] ?? "";
      const timestamp = invitation
        ? invitationDay(originalTimestamp)
        : /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC$/.test(originalTimestamp)
          ? Date.parse(originalTimestamp.replace(" ", "T").replace(" UTC", "Z"))
          : null;
      if (timestamp === null || !Number.isFinite(timestamp)) {
        invalidDates++;
        return;
      }
      let direction: ArchivedEvent["direction"] = from.includes(owner)
        ? "outbound"
        : to.includes(owner)
          ? "inbound"
          : "unknown";
      if (invitation) {
        const declared =
          row.Direction === "OUTGOING"
            ? "outbound"
            : row.Direction === "INCOMING"
              ? "inbound"
              : "unknown";
        direction = direction !== "unknown" && direction !== declared ? "unknown" : declared;
      }
      const participants = [...new Set([...from, ...to])]
        .filter((u) => u !== owner)
        .map((url) => ({
          url,
          name:
            from.length === 1 && from[0] === url
              ? (row[invitation ? "From" : "FROM"] ?? "")
              : to.length === 1 && to[0] === url
                ? (row[invitation ? "To" : "TO"] ?? "")
                : "",
        }));
      const draft =
        !invitation &&
        [row["IS MESSAGE DRAFT"], row["IS CONVERSATION DRAFT"]].some((v) =>
          /^(yes|true)$/i.test(v ?? "")
        );
      const thread = invitation
        ? `invitation:${stableId(JSON.stringify([from, to]))}`
        : (row["CONVERSATION ID"] ?? "");
      const subject = invitation ? "Connection invitation" : (row.SUBJECT ?? "");
      const body = row[invitation ? "Message" : "CONTENT"] ?? "";
      const key = stableId(
        JSON.stringify([
          bundle.account,
          source.kind,
          thread,
          from,
          [...to].sort(),
          originalTimestamp,
          subject,
          body,
          draft,
          row.ATTACHMENTS ?? "",
        ])
      );
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      // Preserve indistinguishable repeated messages inside an archive; coalesce repeated imports.
      const id = stableId(`${key}/${occurrence}`),
        previous = events.get(id);
      const sourceRef = ref(source, index);
      if (previous) {
        previous.sourceRefs.push(sourceRef);
        return;
      }
      events.set(id, {
        id,
        account: bundle.account,
        kind: invitation ? "invitation" : "message",
        thread,
        timestamp,
        timestampPrecision: invitation ? "date" : "instant",
        originalTimestamp,
        direction,
        participants,
        subject,
        body,
        draft,
        sourceRefs: [sourceRef],
        status: invitation
          ? "historical-invitation; acceptance-unknown"
          : draft
            ? "historical-draft"
            : "historical-message",
      });
    });
  }
  return { events: [...events.values()], invalidDates };
}

export function mergeLinkedInArchive(
  previous: LinkedInArchive,
  incoming: LinkedInArchive
): LinkedInArchive {
  if (previous.account !== incoming.account) throw new Error("Archive account mismatch");
  const events = new Map(previous.events.map((e) => [e.id, e]));
  for (const event of incoming.events) {
    const old = events.get(event.id);
    events.set(event.id, {
      ...event,
      sourceRefs: [...new Set([...(old?.sourceRefs ?? []), ...event.sourceRefs])],
    });
  }
  return {
    version: 1,
    account: incoming.account,
    sources: [
      ...new Map([...previous.sources, ...incoming.sources].map((s) => [s.id, s])).values(),
    ],
    emails: [
      ...new Map(
        [...previous.emails, ...incoming.emails].map((e) => [JSON.stringify(e), e])
      ).values(),
    ],
    events: [...events.values()].sort(
      (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)
    ),
  };
}
