import { join } from "node:path";
import { type AttioAssociation, correlateAttio } from "../attio/correlation.js";
import { normalizeLinkedInUrl, readAttioCache } from "../attio/people.js";
import { companyId } from "../linkedin/api/endpoints/companies.js";
import { type Contact, contactId, emailAddress, MailStore, stableId } from "../mail/store.js";
import { type ContactFact, personFacts } from "../relationships/facts.js";
import { readIcps } from "../relationships/icp.js";
import {
  type QualificationView,
  qualificationView,
  readQualifications,
} from "../relationships/qualification.js";
import { type RelationshipScore, relationshipScore } from "../relationships/rank.js";
import { applyRankOverride, readRankOverrides } from "../relationships/rank-overrides.js";
import { companyRollups } from "./company-view.js";
import type { Store } from "./index.js";
import { readJson, writePrivate } from "./private-workspace.js";
import { coalesceTimeline } from "./timeline.js";
export interface RelationshipContact extends Contact {
  rank?: RelationshipScore;
  facts?: ContactFact[];
  qualifications?: Record<string, QualificationView>;
  linkedinUrls?: string[];
  attio?: AttioAssociation;
  company?: string | null;
  geo?: string | null;
  geoUrn?: string | null;
}
export interface TimelineEvent {
  /** False for group mail; absent on legacy snapshots. */
  direct?: boolean;
  automated?: boolean;
  sourceCopies?: { account: string; id: string; source: string; thread: string }[];
  threadAliases?: string[];
  id: string;
  thread: string;
  contactIds: string[];
  channel: "linkedin" | "email";
  account: string;
  timestamp: number;
  direction: "inbound" | "outbound" | "unknown";
  subject: string;
  body: string;
  source: string;
  references: string[];
  eligible: boolean;
  coverage: "stored" | "partial";
}
export interface ThreadAction {
  through: number;
  snoozeUntil?: number;
  dismissed?: boolean;
}
export interface RelationshipFilters {
  tag?: string;
  anyTag?: string[];
  allTags?: string[];
  withoutTags?: string[];
  icp?: string;
  fit?: "yes" | "no" | "unknown" | "stale";
  minConfidence?: number;
  minRank?: number;
  sort?: "name" | "rank" | "fit" | "recent";
  hasFacts?: boolean;
  company?: string;
  geo?: string;
  channel?: string;
  account?: string;
}
export interface RelationshipSettings {
  attioBlocked?: string[];
  threads: Record<string, ThreadAction>;
  lists: Record<string, RelationshipFilters>;
}
export interface FollowUp {
  thread: string;
  contactId: string;
  kind: "needs-reply" | "awaiting-response";
  eventId: string;
  timestamp: number;
  businessDays: number;
  reason: string;
  provisional: boolean;
}
export interface RelationshipSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  contacts: RelationshipContact[];
  timeline: TimelineEvent[];
  followups: FollowUp[];
  companies: Awaited<ReturnType<typeof companyRollups>>["companies"];
  mergeReview: Awaited<ReturnType<typeof companyRollups>>["mergeReview"];
  coverage: {
    mailAccounts: number;
    mailIndexedComplete: number;
    mailErrors: number;
    archiveComplete: false;
    warnings: string[];
  };
  lists: Record<string, RelationshipFilters>;
  icps?: { id: string; version: number; name: string }[];
}
export function businessDaysSince(
  timestamp: number,
  now: number,
  timeZone = "America/Los_Angeles"
): number {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone });
  let days = 0;
  for (let time = timestamp + 86400000; time <= now; time += 86400000) {
    const d = weekday.format(time);
    if (d !== "Sat" && d !== "Sun") days++;
  }
  return days;
}
export function followUps(
  events: TimelineEvent[],
  contacts: RelationshipContact[],
  actions: Record<string, ThreadAction>,
  now: number
): FollowUp[] {
  const latest = new Map<string, TimelineEvent>();
  for (const e of events) {
    if (e.automated) continue;
    if (!latest.has(e.thread) || (latest.get(e.thread)?.timestamp ?? 0) < e.timestamp)
      latest.set(e.thread, e);
  }
  const people = new Map(contacts.map((c) => [c.id, c]));
  const results: FollowUp[] = [];
  for (const e of latest.values()) {
    if (!e.eligible || e.direction === "unknown") continue;
    const action = [e.thread, ...(e.threadAliases ?? [])]
      .map((thread) => actions[thread])
      .filter((a): a is ThreadAction => !!a)
      .sort((a, b) => b.through - a.through)[0];
    if (
      action &&
      e.timestamp <= action.through &&
      (action.dismissed || (action.snoozeUntil ?? 0) > now)
    )
      continue;
    for (const id of e.contactIds) {
      const contact = people.get(id);
      if (!contact) continue;
      const days = businessDaysSince(e.timestamp, now);
      const threshold =
        e.direction === "inbound" ? (contact.inboundDays ?? 2) : (contact.outboundDays ?? 5);
      if (days < threshold) continue;
      results.push({
        thread: e.thread,
        contactId: id,
        kind: e.direction === "inbound" ? "needs-reply" : "awaiting-response",
        eventId: e.id,
        timestamp: e.timestamp,
        businessDays: days,
        provisional: e.coverage === "partial",
        reason: `${days} business days since ${e.direction === "inbound" ? "latest inbound" : "latest outbound"} in this ${e.channel} thread; no later reply in stored evidence.`,
      });
    }
  }
  return results.sort((a, b) => a.timestamp - b.timestamp);
}
export async function relationshipSnapshot(
  store: Store,
  root: string,
  now = Date.now()
): Promise<RelationshipSnapshot> {
  const mail = new MailStore(root),
    identities = await mail.identities(),
    runs = await mail.runs();
  const settings = await readJson<RelationshipSettings>(join(root, "relationship-settings.json"), {
    threads: {},
    lists: {},
  });
  const contacts = new Map<string, RelationshipContact>(
    Object.values(identities.contacts).map((c) => [c.id, { ...c }])
  );
  const linked = new Map<string, string>();
  for (const contact of contacts.values())
    for (const link of contact.linkedin)
      linked.set(`${link.account}/${link.flagshipId}`, contact.id);
  const timeline: TimelineEvent[] = [],
    companies: RelationshipSnapshot["companies"] = [],
    mergeReview: RelationshipSnapshot["mergeReview"] = [];
  for (const account of await store.accounts.list()) {
    const people = store.peopleFor(account);
    for (const id of await people.listPersonIds()) {
      const person = await people.readPerson(id);
      if (!person) continue;
      const cid = linked.get(`${account}/${id}`) ?? contactId(`linkedin:${account}/${id}`);
      const previous = contacts.get(cid);
      const linkedinUrl = person.publicIdentifier
        ? normalizeLinkedInUrl(`https://www.linkedin.com/in/${person.publicIdentifier}`)
        : null;
      const employerId = person.companyUrn ? companyId(person.companyUrn) : null;
      contacts.set(cid, {
        id: cid,
        name:
          [person.firstName, person.lastName].filter(Boolean).join(" ") ||
          person.publicIdentifier ||
          id,
        emails: previous?.emails ?? [],
        linkedin: [
          ...(previous?.linkedin ?? []).filter(
            (link) => link.account !== account || link.flagshipId !== id
          ),
          { account, flagshipId: id },
        ],
        tags: previous?.tags ?? [],
        linkedinUrls: [
          ...new Set([...(previous?.linkedinUrls ?? []), ...(linkedinUrl ? [linkedinUrl] : [])]),
        ],
        inboundDays: previous?.inboundDays,
        outboundDays: previous?.outboundDays,
        facts: [
          ...(previous?.facts ?? []),
          ...personFacts(
            account,
            person,
            employerId ? await store.connectionsFor(account).readCompany(employerId) : null
          ),
        ],
        company: person.company,
        geo: person.geoName ?? person.location,
        geoUrn: person.geoUrn,
      });
      linked.set(`${account}/${id}`, cid);
    }
    const convs = store.forAccount(account);
    for (const id of await convs.list()) {
      const conv = await convs.read(id);
      if (!conv) continue;
      const cid = linked.get(`${account}/${conv.profileId}`);
      if (!cid) continue;
      for (const msg of await convs.readMessages(id))
        timeline.push({
          id: stableId(`${account}/${msg.urn}`),
          thread: `linkedin:${account}:${id}`,
          contactIds: [cid],
          channel: "linkedin",
          account,
          timestamp: msg.timestamp,
          direction: msg.isFromMe ? "outbound" : "inbound",
          subject: "",
          body: msg.body,
          source:
            conv.conversationUrl ??
            `https://www.linkedin.com/messaging/thread/${encodeURIComponent(id)}/`,
          references: [msg.urn],
          eligible: true,
          direct: true,
          coverage:
            !conv.syncState.lastSyncAt || now - Date.parse(conv.syncState.lastSyncAt) > 86400000
              ? "partial"
              : "stored",
        });
    }
    const company = await companyRollups(store, account);
    companies.push(...company.companies);
    mergeReview.push(...company.mergeReview);
  }
  const emailContacts = correlateAttio(
    contacts,
    await readAttioCache(root),
    now,
    settings.attioBlocked
  );
  const messages = await mail.messages();
  const own = new Set<string>();
  const isSent = (mailbox: string) => /(^|[/])(?:sent|sent messages|sent items)$/i.test(mailbox);
  for (const m of messages)
    if (m.copies.some((c) => isSent(c.mailbox))) {
      const sender = emailAddress(m.sender);
      if (sender) own.add(sender);
    }
  for (const m of messages) {
    const sender = emailAddress(m.sender),
      recipients = [...m.to, ...m.cc]
        .map((p) => emailAddress(p.address))
        .filter((s): s is string => !!s);
    const outbound = sender !== null && own.has(sender);
    const direction = outbound
      ? "outbound"
      : recipients.some((s) => own.has(s)) || /(^|[/])inbox$/i.test(m.mailbox)
        ? "inbound"
        : "unknown";
    const participants = (outbound ? recipients : sender ? [sender] : []).filter(
      (s) => !own.has(s)
    );
    const ids = participants
      .map((email) => {
        const id = contactId(`email:${email}`);
        return emailContacts.get(id) ?? id;
      })
      .filter((id) => contacts.has(id));
    const timestamp = Date.parse(m.date_sent ?? m.date_received);
    if (!Number.isFinite(timestamp)) continue;
    const rootId = m.references[0] ?? m.in_reply_to ?? m.message_id ?? m.key;
    timeline.push({
      id: m.key,
      thread: `email:${m.account_id}:${stableId(rootId)}`,
      contactIds: ids,
      channel: "email",
      account: m.account_id,
      timestamp,
      direction,
      subject: m.subject,
      body: m.content,
      automated: m.automated ?? false,
      source: m.message_id ? `message://${encodeURIComponent(m.message_id)}` : "",
      references: m.message_id ? [m.message_id] : [],
      direct: new Set(recipients).size === 1,
      eligible: !m.automated && !m.partial && recipients.length <= 5 && ids.length > 0,
      coverage: "partial",
    });
  }
  const all = coalesceTimeline(timeline);
  const activeContacts = [...contacts.values()].filter(
    (c) => !c.emails.length || c.emails.some((e) => !own.has(e))
  );
  const byContact = new Map<string, TimelineEvent[]>();
  for (const event of all)
    for (const id of event.contactIds) byContact.set(id, [...(byContact.get(id) ?? []), event]);
  const rankOverrides = await readRankOverrides(root);
  for (const contact of activeContacts)
    contact.rank = applyRankOverride(
      relationshipScore(byContact.get(contact.id) ?? [], now),
      rankOverrides.contacts[contact.id]
    );
  const definitions = await readIcps(root),
    qualifications = await readQualifications(root);
  for (const contact of activeContacts) {
    contact.qualifications = {};
    for (const [id, versions] of Object.entries(definitions.definitions)) {
      const definition = versions.at(-1),
        result = qualifications.results[id]?.[contact.id];
      if (definition && result)
        contact.qualifications[id] = qualificationView(result, definition, contact, now);
    }
  }
  const runValues = Object.values(runs);
  return {
    schemaVersion: 1,
    generatedAt: new Date(now).toISOString(),
    contacts: activeContacts,
    timeline: all,
    followups: followUps(all, activeContacts, settings.threads, now),
    companies,
    mergeReview,
    lists: settings.lists,
    icps: Object.values(definitions.definitions).flatMap((versions) => {
      const d = versions.at(-1);
      return d ? [{ id: d.id, version: d.version, name: d.name }] : [];
    }),
    coverage: {
      mailAccounts: runValues.length,
      mailIndexedComplete: runValues.filter((r) => r.indexedComplete).length,
      mailErrors: runValues.reduce((n, r) => n + r.errors.length, 0),
      archiveComplete: false,
      warnings: [
        "Email coverage describes the local Apple Mail index, not a complete server archive.",
        ...runValues.flatMap((r) => r.coverage?.warnings ?? []),
      ],
    },
  };
}
export function filterContacts(
  snapshot: RelationshipSnapshot,
  filter: RelationshipFilters
): RelationshipContact[] {
  if (
    filter.minRank !== undefined &&
    (!Number.isFinite(filter.minRank) || filter.minRank < 0 || filter.minRank > 100)
  )
    throw new Error("--min-rank must be 0–100");
  if (
    filter.minConfidence !== undefined &&
    (!Number.isFinite(filter.minConfidence) || filter.minConfidence < 0 || filter.minConfidence > 1)
  )
    throw new Error("--min-confidence must be 0–1");
  if ((filter.fit || filter.minConfidence !== undefined || filter.sort === "fit") && !filter.icp)
    throw new Error("Fit filtering/sorting requires --icp");
  if (filter.fit && !["yes", "no", "unknown", "stale"].includes(filter.fit))
    throw new Error("--fit must be yes, no, unknown or stale");
  if (filter.sort && !["name", "rank", "fit", "recent"].includes(filter.sort))
    throw new Error("--sort must be name, rank, fit or recent");
  if (filter.channel && !["linkedin", "email"].includes(filter.channel))
    throw new Error("--channel must be linkedin or email");
  if (filter.icp && snapshot.icps && !snapshot.icps.some((d) => d.id === filter.icp))
    throw new Error(`Unknown ICP: ${filter.icp}`);
  const matchesFit = (contact: RelationshipContact) => {
    if (!filter.icp) return true;
    const result = contact.qualifications?.[filter.icp],
      fit = filter.fit ?? "yes";
    if (fit === "stale") return result?.freshness === "stale";
    if (result?.freshness === "stale") return false;
    if ((result?.confidence ?? 0) < (filter.minConfidence ?? 0)) return false;
    return fit === "unknown" ? !result || result.match === null : result?.match === (fit === "yes");
  };
  const contacts = snapshot.contacts.filter(
    (c) =>
      matchesFit(c) &&
      (!filter.hasFacts || !!c.facts?.length) &&
      (filter.minRank === undefined || (c.rank?.score ?? 0) >= filter.minRank) &&
      (!filter.tag || c.tags.includes(filter.tag)) &&
      (!filter.anyTag?.length || filter.anyTag.some((t) => c.tags.includes(t))) &&
      (!filter.allTags?.length || filter.allTags.every((t) => c.tags.includes(t))) &&
      (!filter.withoutTags?.length || !filter.withoutTags.some((t) => c.tags.includes(t))) &&
      (!filter.company || c.company?.toLowerCase().includes(filter.company.toLowerCase())) &&
      (!filter.geo ||
        c.geoUrn === filter.geo ||
        c.geo?.toLowerCase().includes(filter.geo.toLowerCase())) &&
      ((!filter.channel && !filter.account) ||
        ((!filter.channel || filter.channel === "linkedin") &&
          c.linkedin.some((link) => !filter.account || link.account === filter.account)) ||
        snapshot.timeline.some(
          (e) =>
            e.contactIds.includes(c.id) &&
            (!filter.channel || e.channel === filter.channel) &&
            (!filter.account ||
              e.account === filter.account ||
              e.sourceCopies?.some((copy) => copy.account === filter.account))
        ))
  );
  const fitScore = (c: RelationshipContact) => {
    const q = filter.icp ? c.qualifications?.[filter.icp] : undefined;
    return q?.freshness === "fresh" && q.match === true ? q.confidence : -1;
  };
  if (filter.sort)
    contacts.sort((a, b) => {
      const tie = () => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
      if (filter.sort === "name") return tie();
      if (filter.sort === "rank")
        return (
          Number(b.rank?.pinned ?? false) - Number(a.rank?.pinned ?? false) ||
          (b.rank?.score ?? 0) - (a.rank?.score ?? 0) ||
          tie()
        );
      if (filter.sort === "fit") return fitScore(b) - fitScore(a) || tie();
      return (b.rank?.signals.lastActivityAt ?? 0) - (a.rank?.signals.lastActivityAt ?? 0) || tie();
    });
  return contacts;
}
export function selectContacts(
  snapshot: RelationshipSnapshot,
  opts: RelationshipFilters & { list?: string }
) {
  if (!opts.list) return filterContacts(snapshot, opts);
  const saved = Object.hasOwn(snapshot.lists, opts.list) ? snapshot.lists[opts.list] : undefined;
  if (!saved) throw new Error("Unknown saved list");
  const extra = { ...opts };
  if (!extra.icp && (extra.fit || extra.minConfidence !== undefined || extra.sort === "fit")) {
    extra.icp = saved.icp;
    extra.fit ??= saved.fit;
  }
  return filterContacts({ ...snapshot, contacts: filterContacts(snapshot, saved) }, extra);
}
export async function saveSnapshot(store: Store, root: string) {
  const result = await relationshipSnapshot(store, root);
  await writePrivate(join(root, "relationship-view.json"), result);
  return result;
}
