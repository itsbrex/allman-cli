import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { applyArchiveChanges } from "@/imports/archive-journal.js";
import {
  type ArchiveBundle,
  type ArchiveSource,
  archiveEvents,
  archiveFacts,
  archiveMappings,
  archiveMatcher,
  mergeLinkedInArchive,
  missingArchiveFacts,
} from "@/imports/linkedin-archive.js";
import type { StoredConnection } from "@/store/connections-store.js";
import { Store } from "@/store/index.js";
import { appendLinkedInHistory } from "@/store/linkedin-history.js";
import type { StoredPerson } from "@/store/people.js";
import { writePrivate } from "@/store/private-workspace.js";
import { followUps, type RelationshipContact, type TimelineEvent } from "@/store/relationships.js";

const account = "ACo0000000000000",
  flagshipId = "ACo1111111111111",
  salesnavId = "ACw1111111111111";
const owner = "https://www.linkedin.com/in/owner",
  url = "https://www.linkedin.com/in/person";
const at = "2026-01-13T00:00:00.000Z";
const row: StoredConnection = {
  flagshipId,
  memberUrn: `urn:li:fsd_profile:${flagshipId}`,
  publicIdentifier: "person",
  firstSeenAt: at,
  lastSeenAt: at,
};
const source = (
  kind: ArchiveSource["kind"],
  rows: Record<string, string>[],
  exportedAt = at
): ArchiveSource => ({
  id: kind,
  kind,
  rows,
  exportedAt,
  originalPath: "/export.csv",
  rawPath: `/private/${kind}.csv`,
});
const rich = {
  linkedin_id: flagshipId,
  linkedin_public_id: "person",
  linkedin_profile_url: url,
  salesnavigator_url: `https://www.linkedin.com/sales/lead/${salesnavId},NAME_SEARCH,opaque`,
  job: "Older role",
  company: "Old company",
  summary: "Historical summary",
  all_skills: "Sales,Leasing",
  email_enrich: "person@example.test",
};
const bundle = (sources: ArchiveSource[]): ArchiveBundle => ({
  version: 1,
  account,
  ownerProfileUrl: owner,
  sources,
});
const dirs: string[] = [];
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), "allman-offline-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

it("requires exact corroborated identities, rejects name-only, slug conflicts and duplicate URLs", () => {
  const match = archiveMatcher([row]);
  expect(match(rich, true)?.flagshipId).toBe(flagshipId);
  expect(match({ ...rich, linkedin_public_id: "wrong" }, true)).toBeNull();
  expect(match({ ...rich, linkedin_id: "ACo2222222222222" }, true)).toBeNull();
  expect(match({ "First Name": "Person" }, false)).toBeNull();
  expect(match({ URL: `${url}/?tracking=ignored` }, false)?.flagshipId).toBe(flagshipId);
  expect(
    archiveMatcher([row, { ...row, flagshipId: "ACo2222222222222" }])({ URL: url }, false)
  ).toBeNull();
});

it("adds only requested, current-connection, bidirectionally unique mappings and respects existing cache", () => {
  const cache = { version: 1 as const, account, mappings: {} };
  const sources = [source("rich-connections", [rich])];
  const selected = new Set([salesnavId]);
  expect(archiveMappings(sources, [row], cache, selected)).toHaveLength(1);
  expect(archiveMappings(sources, [row], cache, new Set())).toHaveLength(0);
  expect(archiveMappings(sources, [{ ...row, source: "enrich" }], cache, selected)).toHaveLength(0);
  expect(
    archiveMappings(sources, [row], { ...cache, mappings: { [flagshipId]: salesnavId } }, selected)
  ).toHaveLength(0);
  expect(
    archiveMappings(
      [source("rich-connections", [rich, { ...rich, linkedin_id: "ACo2222222222222" }])],
      [row],
      cache,
      selected
    )
  ).toHaveLength(0);
  expect(
    archiveMappings(
      sources,
      [row],
      { ...cache, mappings: { [flagshipId]: "ACw2222222222222" } },
      selected
    )
  ).toHaveLength(0);
});

it("uses newest dated historical fields, retains raw email evidence, fills blanks only and never marks deep enrichment", () => {
  const result = archiveFacts(
    [
      source("rich-connections", [rich], "2025-03-14T00:00:00.000Z"),
      source("connections", [{ URL: url, Company: "Newer company", Position: "Newer role" }]),
    ],
    [row]
  );
  const facts = result.facts.get(flagshipId) ?? {};
  expect(facts.company?.value).toBe("Newer company");
  expect(facts.about?.provenance).toEqual({
    source: "linkedin/archive",
    observedAt: "2025-03-14T00:00:00.000Z",
    sourceRef: "/private/rich-connections.csv#record=1",
  });
  const missing = missingArchiveFacts(
    {
      ...row,
      company: "Current company",
      skills: [],
      title: null,
      provenance: { title: { source: "user", observedAt: at } },
    } as StoredPerson,
    facts
  );
  expect(missing.company).toBeUndefined();
  expect(missing.title).toBeUndefined();
  expect(missing.skills?.value).toEqual(["Sales", "Leasing"]);
  expect(missing).not.toHaveProperty("enrichedAt");
  expect(result.emails[0]?.sourceField).toBe("email_enrich");
  const conflict = archiveFacts(
    [
      source("connections", [
        { URL: url, Company: "A" },
        { URL: url, Company: "B" },
      ]),
    ],
    [row]
  );
  expect(conflict.facts.get(flagshipId)?.company).toBeUndefined();
  expect(conflict.ambiguousFields).toBe(1);
});

const message = {
  "CONVERSATION ID": "thread1",
  "SENDER PROFILE URL": owner,
  "RECIPIENT PROFILE URLS": url,
  FROM: "Owner",
  TO: "Person",
  DATE: "2026-01-08 17:40:17 UTC",
  CONTENT: "Example message",
  "IS MESSAGE DRAFT": "No",
  "IS CONVERSATION DRAFT": "No",
};
const invitation = {
  inviterProfileUrl: url,
  inviteeProfileUrl: owner,
  From: "Person",
  To: "Owner",
  "Sent At": "1/11/26, 11:40 AM",
  Direction: "INCOMING",
  Message: "Example invitation",
};
it("keeps drafts, account attribution, group participants and unknown invitation acceptance with date-only precision", () => {
  const result = archiveEvents(
    bundle([
      source("messages", [
        message,
        { ...message, "IS MESSAGE DRAFT": "Yes" },
        { ...message, "RECIPIENT PROFILE URLS": `${url}; https://www.linkedin.com/in/another` },
      ]),
      source("invitations", [invitation, { ...invitation, "Sent At": "2/30/26, 1:00 PM" }]),
    ])
  );
  expect(result.events).toHaveLength(4);
  expect(result.invalidDates).toBe(1);
  expect(result.events[0]).toMatchObject({
    account,
    direction: "outbound",
    timestampPrecision: "instant",
  });
  expect(result.events[1]).toMatchObject({ draft: true, status: "historical-draft" });
  expect(result.events[2]?.participants).toHaveLength(2);
  expect(result.events[3]).toMatchObject({
    direction: "inbound",
    timestampPrecision: "date",
    originalTimestamp: "1/11/26, 11:40 AM",
    status: "historical-invitation; acceptance-unknown",
  });
});

it("coalesces repeated imports while retaining identical messages occurring twice in one export", () => {
  const first = source("messages", [message, message]);
  const events = archiveEvents(bundle([first, { ...first, rawPath: "/second.csv" }])).events;
  expect(events).toHaveLength(2);
  expect(events[0]?.sourceRefs).toHaveLength(2);
  const archive = { version: 1 as const, account, sources: [], emails: [], events };
  const merged = mergeLinkedInArchive(archive, archive);
  expect(merged.events).toHaveLength(2);
  expect(merged.events[0]?.sourceRefs).toHaveLength(2);
  expect(() => mergeLinkedInArchive(archive, { ...archive, account: "other" })).toThrow(
    "account mismatch"
  );
});

it("shows archived relationship history without creating followups, email links or live invitation records", async () => {
  const root = await temp();
  const events = archiveEvents(
    bundle([source("messages", [message]), source("invitations", [invitation])])
  ).events;
  const emails = archiveFacts([source("rich-connections", [rich])], [row]).emails;
  await writePrivate(join(root, "linkedin-archives", `${account}.json`), {
    version: 1,
    account,
    sources: [],
    events,
    emails,
  });
  const contacts = new Map<string, RelationshipContact>([
    [
      "person",
      {
        id: "person",
        name: "Person",
        emails: [],
        linkedin: [{ account, flagshipId }],
        tags: [],
        linkedinUrls: [url],
      },
    ],
  ]);
  const timeline: TimelineEvent[] = [];
  await appendLinkedInHistory(root, account, contacts, timeline);
  expect(timeline).toHaveLength(2);
  expect(timeline.every((e) => e.contactIds[0] === "person" && e.historical && !e.eligible)).toBe(
    true
  );
  expect(followUps(timeline, [...contacts.values()], {}, Date.now())).toEqual([]);
  expect(contacts.get("person")?.emails).toEqual([]);
  expect(contacts.get("person")?.historicalEmails?.[0]?.email).toBe("person@example.test");
});

it("backs up exact original bytes before mutations and refuses changes since planning", async () => {
  const root = await temp(),
    path = join(root, "record.json");
  await writePrivate(path, { old: true });
  const before = await readFile(path, "utf8");
  const change = { stage: "fields" as const, path, before, after: { filled: true } };
  const backup = await applyArchiveChanges(root, [change], { providerRequests: 0 });
  expect(await readFile(join(backup as string, "0.before.json"), "utf8")).toBe(before);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(join(backup as string, "journal.json"), "utf8"))).toMatchObject({
    state: "complete",
    applied: 1,
  });
  await expect(applyArchiveChanges(root, [change], {})).rejects.toThrow("Store changed");
});

it("replaces mirror archive stamps when live enrichment later updates that field", async () => {
  const root = await temp(),
    store = new Store({ path: root });
  const cstore = store.connectionsFor(account);
  await cstore.upsertConnection(
    {
      ...row,
      title: "Historical title",
      provenance: { title: { source: "linkedin/archive", observedAt: at, sourceRef: "/old.csv" } },
    },
    at
  );
  await cstore.enrichConnection(
    flagshipId,
    { title: "Live title" },
    "core",
    "2026-09-25T00:00:00.000Z"
  );
  const current = await cstore.readConnection(flagshipId);
  expect(current?.provenance?.title).toEqual({
    source: "linkedin/enrich-core",
    observedAt: "2026-09-25T00:00:00.000Z",
  });
});
