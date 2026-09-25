import { join } from "node:path";
import { normalizeLinkedInUrl } from "../attio/people.js";
import type { LinkedInArchive } from "../imports/linkedin-archive.js";
import { contactId } from "../mail/store.js";
import { readJson } from "./private-workspace.js";
import type { RelationshipContact, TimelineEvent } from "./relationships.js";

/** Historical evidence stays separate from live sync state and send/invitation guards. */
export async function appendLinkedInHistory(
  root: string,
  account: string,
  contacts: Map<string, RelationshipContact>,
  timeline: TimelineEvent[]
) {
  const archive = await readJson<LinkedInArchive | null>(
    join(root, "linkedin-archives", `${account}.json`),
    null
  );
  if (!archive) return;
  if (archive.version !== 1 || archive.account !== account)
    throw new Error("Archive account mismatch");
  const byUrl = new Map<string, string | null>();
  for (const contact of contacts.values()) {
    if (!contact.linkedin.some((l) => l.account === account)) continue;
    const urls = [
      ...(contact.linkedinUrls ?? []),
      ...contact.linkedin
        .filter((l) => l.account === account)
        .map((l) => `https://www.linkedin.com/in/${l.flagshipId}`),
    ];
    for (const raw of urls) {
      const url = normalizeLinkedInUrl(raw);
      if (url) byUrl.set(url, byUrl.has(url) && byUrl.get(url) !== contact.id ? null : contact.id);
    }
  }
  for (const e of archive.events) {
    const ids: string[] = [];
    for (const p of e.participants) {
      const url = normalizeLinkedInUrl(p.url);
      if (!url || (byUrl.has(url) && byUrl.get(url) === null)) continue;
      const id = byUrl.get(url) ?? contactId(`linkedin-archive:${account}:${url}`);
      if (!contacts.has(id))
        contacts.set(id, {
          id,
          name: p.name || decodeURIComponent(url.split("/").at(-1) ?? url),
          emails: [],
          linkedin: [],
          linkedinUrls: [url],
          tags: [],
        });
      byUrl.set(url, id);
      ids.push(id);
    }
    timeline.push({
      id: e.id,
      account,
      thread: `linkedin-archive:${account}:${e.thread}`,
      contactIds: [...new Set(ids)],
      channel: "linkedin",
      timestamp: e.timestamp,
      timestampPrecision: e.timestampPrecision,
      originalTimestamp: e.originalTimestamp,
      direction: e.direction,
      subject: e.subject,
      body: e.body,
      source: e.sourceRefs[0] ?? "",
      references: e.sourceRefs,
      eligible: false,
      direct: e.participants.length === 1,
      coverage: "partial",
      historical: true,
      kind: e.kind,
      draft: e.draft,
      status: e.status,
    });
  }
  const byFlagship = new Map(
    [...contacts.values()].flatMap((c) =>
      c.linkedin.filter((l) => l.account === account).map((l) => [l.flagshipId, c] as const)
    )
  );
  for (const email of archive.emails) {
    const contact = byFlagship.get(email.flagshipId);
    if (contact) {
      contact.historicalEmails ??= [];
      contact.historicalEmails.push(email);
    }
  }
}
