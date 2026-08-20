/**
 * PeopleStore (ADR-0003): the joined person view over connection and
 * conversation records (Phase 0), the provenance-governed `people/` writes
 * (Phase 1, ADR-0004 policy), and the reader preferring `people/` (Phase 2).
 * Uses a real temp directory (no git). Synthetic ids/slugs.
 */
import { mkdtemp, readFile, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectionsStore } from "@/store/connections-store.js";
import { ConversationStore } from "@/store/conversations.js";
import type { StoreGit } from "@/store/git.js";
import { observationsFrom, PeopleStore } from "@/store/people.js";
import type { ConversationRecord } from "@/store/types.js";

// ConversationStore.upsert schedules a git commit; swallow it in tests.
const FAKE_GIT = { scheduleCommit: () => {} } as unknown as StoreGit;

const FLAGSHIP = "ACoAAB0000000000000000000000000000000001";
const SLUG = "example-user-1";

let accountDir: string;
let people: PeopleStore;
let connections: ConnectionsStore;
let conversations: ConversationStore;

beforeEach(async () => {
  accountDir = await mkdtemp(join(tmpdir(), "allman-people-"));
  people = new PeopleStore(accountDir, FAKE_GIT);
  connections = new ConnectionsStore(accountDir, FAKE_GIT);
  conversations = new ConversationStore(accountDir, FAKE_GIT);
});
afterEach(async () => {
  await rm(accountDir, { recursive: true, force: true });
});

function convRecord(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    convId: "2-conv1",
    profileId: FLAGSHIP,
    slug: SLUG,
    convUrn: "urn:li:msg_conversation:(urn:li:fsd_profile:me,2-conv1)",
    backendUrn: null,
    profileUrn: `urn:li:fsd_profile:${FLAGSHIP}`,
    memberUrn: "urn:li:member:1000001",
    firstName: "Ex",
    lastName: "Ample",
    name: "Ex Ample",
    headline: "Conversation headline",
    profileUrl: null,
    profilePictures: [
      { width: 100, height: 100, url: "https://cdn.example/small" },
      { width: 400, height: 400, url: "https://cdn.example/large" },
    ],
    distance: "DISTANCE_1",
    pronoun: null,
    memberBadgeType: null,
    isPremium: true,
    isVerified: false,
    unreadCount: 0,
    lastActivityAt: null,
    lastReadAt: null,
    createdAt: null,
    read: true,
    notificationStatus: null,
    categories: [],
    conversationUrl: null,
    disabledFeatures: [],
    syncState: {
      oldestMessageAt: null,
      newestMessageAt: null,
      lastSyncAt: null,
      totalSynced: 0,
      fullyBackfilled: false,
    },
    fetchedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

const baseConnection = {
  memberUrn: `urn:li:fsd_profile:${FLAGSHIP}`,
  flagshipId: FLAGSHIP,
  publicIdentifier: SLUG,
  firstName: "Ex",
  lastName: "Ample",
  headline: "Connection headline",
  title: "Staff Engineer",
  company: "Example Corp",
  location: "San Francisco Bay Area",
};

describe("PeopleStore.readPerson", () => {
  it("returns null when neither store knows the person", async () => {
    expect(await people.readPerson(FLAGSHIP)).toBeNull();
    expect(await people.readPerson("nobody-here")).toBeNull();
  });

  it("reads a connection-only person by flagship id and by slug", async () => {
    await connections.upsertConnection(baseConnection, "2026-05-01T00:00:00.000Z");

    const byId = await people.readPerson(FLAGSHIP);
    expect(byId).not.toBeNull();
    expect(byId?.flagshipId).toBe(FLAGSHIP);
    expect(byId?.memberUrn).toBe(`urn:li:fsd_profile:${FLAGSHIP}`);
    expect(byId?.publicIdentifier).toBe(SLUG);
    expect(byId?.title).toBe("Staff Engineer");
    expect(byId?.company).toBe("Example Corp");
    expect(byId?.headline).toBe("Connection headline");
    expect(byId?.firstSeenAt).toBe("2026-05-01T00:00:00.000Z");
    expect(byId?.lastSeenAt).toBe("2026-05-01T00:00:00.000Z");

    const bySlug = await people.readPerson(SLUG);
    expect(bySlug).toEqual(byId);
  });

  it("reads a conversation-only person by profile id and by slug", async () => {
    await conversations.upsert("2-conv1", convRecord());

    const byId = await people.readPerson(FLAGSHIP);
    expect(byId).not.toBeNull();
    expect(byId?.flagshipId).toBe(FLAGSHIP);
    expect(byId?.memberUrn).toBe(`urn:li:fsd_profile:${FLAGSHIP}`);
    // ConversationRecord.memberUrn is the urn:li:member urn — the objectUrn bridge.
    expect(byId?.objectUrn).toBe("urn:li:member:1000001");
    expect(byId?.memberId).toBe("1000001");
    expect(byId?.publicIdentifier).toBe(SLUG);
    expect(byId?.firstName).toBe("Ex");
    expect(byId?.headline).toBe("Conversation headline");
    expect(byId?.premium).toBe(true);
    // largest cached picture wins
    expect(byId?.profilePictureUrl).toBe("https://cdn.example/large");
    // no enrichment fields without a connection record
    expect(byId?.title).toBeUndefined();
    expect(byId?.firstSeenAt).toBe("2026-06-01T00:00:00.000Z");
    expect(byId?.lastSeenAt).toBe("2026-06-01T00:00:00.000Z");

    const bySlug = await people.readPerson(SLUG);
    expect(bySlug).toEqual(byId);
  });

  it("joins both records — the newer record wins per overlapping field", async () => {
    // connection stamped 2026-05-01, conversation fetched 2026-06-01 → conversation newer
    await connections.upsertConnection(baseConnection, "2026-05-01T00:00:00.000Z");
    await conversations.upsert("2-conv1", convRecord({ firstName: "Exie" }));

    const person = await people.readPerson(FLAGSHIP);
    expect(person?.headline).toBe("Conversation headline");
    expect(person?.firstName).toBe("Exie");
    // connection-only facts survive the join
    expect(person?.title).toBe("Staff Engineer");
    expect(person?.location).toBe("San Francisco Bay Area");
    // premium only known to the conversation side
    expect(person?.premium).toBe(true);
    // stamps span both records
    expect(person?.firstSeenAt).toBe("2026-05-01T00:00:00.000Z");
    expect(person?.lastSeenAt).toBe("2026-06-01T00:00:00.000Z");

    // slug lookup joins identically
    expect(await people.readPerson(SLUG)).toEqual(person);
  });

  it("never lets a null on the newer side clobber an older real value", async () => {
    await connections.upsertConnection(
      { ...baseConnection, pronoun: "SHE_HER" },
      "2026-05-01T00:00:00.000Z"
    );
    await conversations.upsert("2-conv1", convRecord({ headline: null, pronoun: null }));

    const person = await people.readPerson(FLAGSHIP);
    expect(person?.headline).toBe("Connection headline");
    expect(person?.pronoun).toBe("SHE_HER");
  });

  it("an older record never overrides newer real values", async () => {
    // conversation fetched 2026-06-01, connection re-swept 2026-07-01 → connection newer
    await conversations.upsert("2-conv1", convRecord({ slug: "old-slug" }));
    await connections.upsertConnection(
      { ...baseConnection, publicIdentifier: "new-slug", firstName: "Newer" },
      "2026-07-01T00:00:00.000Z"
    );

    const person = await people.readPerson(FLAGSHIP);
    expect(person?.firstName).toBe("Newer");
    expect(person?.publicIdentifier).toBe("new-slug");
    expect(person?.lastSeenAt).toBe("2026-07-01T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Phase 1 — applyObservations (ADR-0003 / ADR-0004 overwrite policy)
// ---------------------------------------------------------------------------

const T1 = "2026-06-01T00:00:00.000Z";
const T2 = "2026-07-01T00:00:00.000Z";
const stamp = (source: string, observedAt: string) => ({ source, observedAt });
const identity = { flagshipId: FLAGSHIP, memberUrn: `urn:li:fsd_profile:${FLAGSHIP}` };

describe("PeopleStore.applyObservations", () => {
  it("creates people/{flagshipId}.json with per-field provenance and a slug symlink", async () => {
    await people.applyObservations(
      identity,
      observationsFrom(
        { publicIdentifier: SLUG, title: "Staff Engineer", location: "San Francisco Bay Area" },
        stamp("linkedin/enrich-core", T1)
      ),
      T1
    );

    const rec = JSON.parse(await readFile(join(accountDir, "people", `${FLAGSHIP}.json`), "utf8"));
    expect(rec.flagshipId).toBe(FLAGSHIP);
    expect(rec.title).toBe("Staff Engineer");
    expect(rec.provenance.title).toEqual({ source: "linkedin/enrich-core", observedAt: T1 });
    expect(rec.firstSeenAt).toBe(T1);
    expect(rec.lastSeenAt).toBe(T1);
    expect(await readlink(join(accountDir, "people", SLUG))).toBe(`${FLAGSHIP}.json`);
  });

  it("a re-observation of equal provenance overwrites — newest observation wins", async () => {
    await people.applyObservations(
      identity,
      observationsFrom({ title: "Old Title" }, stamp("linkedin/enrich-core", T1)),
      T1
    );
    const rec = await people.applyObservations(
      identity,
      observationsFrom({ title: "New Title" }, stamp("linkedin/enrich-core", T2)),
      T2
    );
    expect(rec.title).toBe("New Title");
    expect(rec.provenance?.title?.observedAt).toBe(T2);
    expect(rec.firstSeenAt).toBe(T1);
    expect(rec.lastSeenAt).toBe(T2);
  });

  it("preserves a better-provenance value against a worse write (pinned by ADR-0001)", async () => {
    await people.applyObservations(
      identity,
      observationsFrom(
        { location: "Austin, Texas Metropolitan Area" },
        stamp("linkedin/enrich-core", T1)
      ),
      T1
    );
    const rec = await people.applyObservations(
      identity,
      observationsFrom(
        { location: "United States", headline: "From a sweep" },
        stamp("linkedin/sweep", T2)
      ),
      T2
    );
    // The worse-ranked sweep must not overwrite the enrich-core location…
    expect(rec.location).toBe("Austin, Texas Metropolitan Area");
    expect(rec.provenance?.location?.source).toBe("linkedin/enrich-core");
    // …but it may still fill fields nothing better has claimed.
    expect(rec.headline).toBe("From a sweep");
    expect(rec.provenance?.headline?.source).toBe("linkedin/sweep");
  });

  it("never auto-overwrites a user-sourced value", async () => {
    await people.applyObservations(
      identity,
      observationsFrom({ location: "Where I say I am" }, stamp("user", T1)),
      T1
    );
    const rec = await people.applyObservations(
      identity,
      observationsFrom({ location: "Somewhere else" }, stamp("linkedin/enrich-deep", T2)),
      T2
    );
    expect(rec.location).toBe("Where I say I am");
    expect(rec.provenance?.location?.source).toBe("user");
  });

  it("throws on a field outside the person-fact shape", async () => {
    await expect(
      people.applyObservations(
        identity,
        { convId: { value: "2-nope", provenance: stamp("linkedin/enrich-core", T1) } },
        T1
      )
    ).rejects.toThrow(/Unknown person field/);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — readPerson prefers the person record over the mirrors
// ---------------------------------------------------------------------------

describe("readPerson prefers people/ (Phase 2)", () => {
  it("person-record fields beat a newer connection mirror; mirrors fill the gaps", async () => {
    await people.applyObservations(
      identity,
      observationsFrom(
        { publicIdentifier: SLUG, headline: "Person headline", title: "Person Title" },
        stamp("linkedin/enrich-core", T1)
      ),
      T1
    );
    // Mirror re-swept LATER with different values — must not win.
    await connections.upsertConnection(
      { ...baseConnection, headline: "Mirror headline" },
      "2026-08-01T00:00:00.000Z"
    );

    const person = await people.readPerson(FLAGSHIP);
    expect(person?.headline).toBe("Person headline");
    expect(person?.title).toBe("Person Title");
    // Fields the person record does not carry still join in from the mirror.
    expect(person?.company).toBe("Example Corp");
    // Provenance rides along on the view; stamps span all sources.
    expect(person?.provenance?.headline?.source).toBe("linkedin/enrich-core");
    expect(person?.firstSeenAt).toBe(T1);
    expect(person?.lastSeenAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("a person-only record resolves by flagship id and by slug", async () => {
    await people.applyObservations(
      identity,
      observationsFrom(
        { publicIdentifier: SLUG, firstName: "Solo", headline: "Only in people/" },
        stamp("linkedin/enrich-core", T1)
      ),
      T1
    );
    const byId = await people.readPerson(FLAGSHIP);
    expect(byId?.firstName).toBe("Solo");
    expect(await people.readPerson(SLUG)).toEqual(byId);
  });

  it("listPersonIds unions connection ids and person records", async () => {
    const OTHER = "ACoAAB0000000000000000000000000000000002";
    await connections.upsertConnection(baseConnection, T1);
    await people.applyObservations(
      { flagshipId: OTHER },
      observationsFrom({ firstName: "Rec" }, stamp("linkedin/enrich-core", T1)),
      T1
    );
    expect((await people.listPersonIds()).sort()).toEqual([FLAGSHIP, OTHER]);
  });
});
