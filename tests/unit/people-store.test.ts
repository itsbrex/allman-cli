/**
 * PeopleStore (ADR-0003 Phase 0): read-only join view over connection and
 * conversation records — no `people/` directory on disk yet.
 * Uses a real temp directory (no git). Synthetic ids/slugs.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectionsStore } from "@/store/connections-store.js";
import { ConversationStore } from "@/store/conversations.js";
import type { StoreGit } from "@/store/git.js";
import { PeopleStore } from "@/store/people.js";
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
