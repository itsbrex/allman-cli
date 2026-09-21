import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exactAttioLookup, storeAttioLookups } from "@/attio/people.js";
import { relationshipsCommand } from "@/commands/relationships.js";
import { MailStore } from "@/mail/store.js";
import { Store } from "@/store/index.js";
import { writePrivate } from "@/store/private-workspace.js";
import { relationshipSnapshot } from "@/store/relationships.js";

const account = "ACoFixtureAccount",
  flagship = "ACoFixturePerson",
  url = "https://www.linkedin.com/in/example-person";
let root: string, privateRoot: string, store: Store;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-relationship-test-"));
  privateRoot = join(root, "private");
  store = new Store({ path: join(root, "linkedin") });
  vi.spyOn(store.git, "scheduleCommit").mockImplementation(() => {});
  vi.stubEnv("ALLMAN_RELATIONSHIP_STORE", privateRoot);
  await store.accounts.writeAuth(account, {
    urn: `urn:li:fsd_profile:${account}`,
    profileSlug: "me",
    name: "Me",
    headline: null,
    profileUrl: null,
    imageUrl: null,
    userType: null,
    networkSize: null,
    status: "authenticated",
    lastSyncAt: null,
  });
  await store.connectionsFor(account).upsertConnection(
    {
      flagshipId: flagship,
      memberUrn: `urn:li:fsd_profile:${flagship}`,
      publicIdentifier: "example-person",
      firstName: "Example",
      lastName: "Person",
    },
    new Date().toISOString()
  );
  const mail = new MailStore(privateRoot);
  await mail.applyPage(
    ["person@example.test", "person.work@example.test"].map((sender, i) => ({
      id: i + 1,
      account_id: "mail-work",
      account: "Work",
      mailbox: "Inbox",
      subject: "Hello",
      sender,
      to: [{ name: "Me", address: "me@example.test" }],
      cc: [],
      content: "Synthetic inbound",
      date_received: new Date().toISOString(),
      date_sent: new Date().toISOString(),
      message_id: `m${i}@example.test`,
      in_reply_to: null,
      references: [],
      read: false,
      flagged: false,
      attachments: [],
    }))
  );
  await storeAttioLookups(privateRoot, [
    exactAttioLookup(url, [
      {
        id: { workspace_id: "test", record_id: "person" },
        values: {
          linkedin: [{ value: url }],
          email_addresses: [
            { email_address: "person@example.test" },
            { email_address: "person.work@example.test" },
          ],
        },
      },
    ]),
  ]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
describe("relationship snapshot through stored source records", () => {
  it("keeps a confirmed email link when its LinkedIn-only node already has tags", async () => {
    await writePrivate(join(privateRoot, "attio-lookups.json"), { schemaVersion: 1, lookups: {} });
    const first = await relationshipSnapshot(store, privateRoot);
    const person = first.contacts.find((c) => c.linkedin.length);
    await relationshipsCommand("tag", person?.id, ["VIP"], { store: store.root });
    await relationshipsCommand("link", "person@example.test", [], {
      store: store.root,
      account,
      flagship: "example-person",
    });
    const linked = await relationshipSnapshot(store, privateRoot);
    const email = linked.contacts.find((c) => c.emails.includes("person@example.test"));
    expect(email?.linkedin).toContainEqual({ account, flagshipId: flagship });
    expect(email?.tags).toContain("VIP");
    expect(linked.contacts.some((c) => c.id === person?.id)).toBe(false);
  });

  it("connects two mail identities to one LinkedIn person through Attio, with reversible unlink", async () => {
    const before = await relationshipSnapshot(store, privateRoot),
      person = before.contacts.find((c) => c.linkedin.length);
    expect(person?.attio?.status).toBe("matched");
    expect(before.timeline).toHaveLength(2);
    expect(before.timeline.every((e) => e.contactIds.includes(person?.id ?? ""))).toBe(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await relationshipsCommand("unlink", person?.id, [], {
      store: store.root,
      account,
      flagship: "example-person",
    });
    const after = await relationshipSnapshot(store, privateRoot),
      unlinked = after.contacts.find((c) => c.id === person?.id);
    expect(unlinked?.attio?.status).toBe("unlinked");
    expect(after.timeline.every((e) => !e.contactIds.includes(person?.id ?? ""))).toBe(true);
    await relationshipsCommand("link", person?.id, [], {
      store: store.root,
      account,
      flagship: "example-person",
    });
    const restored = await relationshipSnapshot(store, privateRoot);
    expect(restored.contacts.find((c) => c.id === person?.id)?.attio?.status).toBe("matched");
    expect(restored.timeline.every((e) => e.contactIds.includes(person?.id ?? ""))).toBe(true);
  });
});
