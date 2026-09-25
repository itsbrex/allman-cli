import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { exportsCommand } from "@/commands/exports.js";
import { beginAutomaticExports } from "@/exports/automatic.js";
import { exportRoot, refreshTeamExports } from "@/exports/team.js";
import { saveSessionRegistry } from "@/linkedin/session-control.js";
import { MailStore } from "@/mail/store.js";
import { writePrivate } from "@/store/private-workspace.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-team-export-"));
  vi.stubEnv("XDG_CONFIG_HOME", join(root, "config"));
  vi.stubEnv("ALLMAN_PROFILE", "brian");
  vi.stubEnv("ALLMAN_STORE", join(root, "brian"));
  const profiles = [];
  for (const [i, name] of ["brian", "jp"].entries()) {
    const store = join(root, name),
      workspace = join(root, "config/allman", name);
    await mkdir(join(store, `ACo${name}`, "connections"), { recursive: true });
    await writePrivate(join(store, `ACo${name}`, "AUTH.json"), {
      name,
      profileSlug: name,
      status: "authenticated",
    });
    await writePrivate(join(workspace, "default-store.json"), { storePath: store });
    await writePrivate(join(store, `ACo${name}`, "connections/ACoShared.json"), {
      flagshipId: "ACoShared",
      memberUrn: "urn:li:fsd_profile:ACoShared",
      source: "connections",
      firstName: "=Unsafe Name",
      lastName: "Fixture",
      publicIdentifier: "shared-person",
      connectedAt: null,
      firstSeenAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-02-01T00:00:00Z",
      raw: { profile: { marker: name } },
      enrichedAt: "2026-02-01T00:00:00Z",
    });
    await writePrivate(join(store, `ACo${name}`, "COOKIES.json"), {
      cookieJar: "NEVER_EXPORT_THIS",
    });
    profiles.push({
      name,
      store,
      account: `ACo${name}`,
      workspace: join(workspace, "browser"),
      browser: { cdpEndpoint: `http://127.0.0.1:${9230 + i}`, shieldPath: join(root, "shield") },
    });
  }
  saveSessionRegistry({ version: 1, active: null, profiles });
  await exportsCommand("configure", {
    profiles: "brian,jp",
    owner: ["brian=brian@example.test", "jp=jp@example.test"],
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
const load = async (name = "team") =>
  JSON.parse(await readFile(join(exportRoot(), `${name}.json`), "utf8"));

it("rebuilds six private files offline, upserts by account, keeps evidence and prevents CSV formulas", async () => {
  await refreshTeamExports();
  const first = await load();
  expect(first.rows.filter((r: { kind: string }) => r.kind === "connections")).toHaveLength(2);
  expect(JSON.stringify(first)).not.toContain("NEVER_EXPORT_THIS");
  expect(
    first.rows
      .filter((r: { kind: string }) => r.kind === "connections")
      .map((r: { relationshipFrom: string }) => r.relationshipFrom)
      .sort()
  ).toEqual(["linkedin:ACobrian", "linkedin:ACojp"]);
  for (const name of ["brian", "jp", "team"]) {
    expect((await stat(join(exportRoot(), `${name}.json`))).mode & 0o777).toBe(0o600);
    const csv = await readFile(join(exportRoot(), `${name}.csv`), "utf8");
    expect(csv).toContain("'=Unsafe Name Fixture");
    expect(csv).toContain(first.generation);
  }
  const raw = first.rows.find((r: { kind: string }) => r.kind === "connections").rawRefs[0];
  expect(JSON.parse(await readFile(raw, "utf8")).payload.profile.marker).toBeTruthy();
  await refreshTeamExports();
  expect((await load()).rows.map((r: { id: string }) => r.id)).toEqual(
    first.rows.map((r: { id: string }) => r.id)
  );
  expect(await readdir(exportRoot())).toHaveLength(7);
  const generation = (await load()).generation;
  expect(await refreshTeamExports(true)).toMatchObject({ generation, unchanged: true });
});

it("attributes email to the supplied sender owner, not the workspace holding the copy", async () => {
  const mail = new MailStore(join(root, "config/allman/brian/relationships"));
  await mail.applyPage([
    {
      id: 1,
      account_id: "mail-jp",
      account: "JP mailbox",
      mailbox: "Sent",
      subject: "Fixture",
      sender: "JP <jp@example.test>",
      to: [{ name: "Other", address: "other@example.test" }],
      cc: [],
      content: "Synthetic message",
      date_received: "2026-09-22T12:00:00Z",
      date_sent: "2026-09-22T12:00:00Z",
      message_id: "synthetic-message",
      in_reply_to: null,
      references: [],
      read: true,
      flagged: false,
      attachments: [],
    },
  ]);
  await refreshTeamExports();
  const event = (await load()).rows.find(
    (r: { kind: string; channel: string }) => r.kind === "activity" && r.channel === "email"
  );
  expect(event.data.sourceMessages[0].sender).toBe("JP <jp@example.test>");
  expect(event.data.sourceMessages[0]).not.toHaveProperty("content");
  expect(event.data.body).toBe("Synthetic message");
  expect(event).toMatchObject({
    profile: "brian",
    actorProfile: "jp",
    teamMembers: ["jp"],
    account: "mail-jp",
    direction: "outbound",
  });
});

it("exports archived messages with historical status, raw provenance and JP ownership", async () => {
  await writePrivate(join(root, "config/allman/jp/relationships/linkedin-archives/ACojp.json"), {
    version: 1,
    account: "ACojp",
    sources: [],
    emails: [],
    events: [
      {
        id: "archive-message",
        account: "ACojp",
        kind: "message",
        thread: "archived-thread",
        timestamp: Date.parse("2026-01-01T00:00:00Z"),
        timestampPrecision: "instant",
        originalTimestamp: "2026-01-01 00:00:00 UTC",
        direction: "outbound",
        participants: [{ url: "https://www.linkedin.com/in/shared-person", name: "Fixture" }],
        subject: "",
        body: "Archived fixture",
        draft: false,
        status: "historical-message",
        sourceRefs: ["/private/messages.csv#record=1"],
      },
    ],
  });
  await refreshTeamExports();
  const event = (await load()).rows.find(
    (r: { sourceKey: string }) => r.sourceKey === "archive-message"
  );
  expect(event).toMatchObject({
    profile: "jp",
    actorProfile: "jp",
    teamMembers: ["jp"],
    status: "historical-message",
    personKeys: ["linkedin:ACoShared", "url:https://www.linkedin.com/in/shared-person"],
    rawRefs: ["/private/messages.csv#record=1"],
    data: { historical: true, eligible: false },
  });
  expect((await load()).rows.some((r: { kind: string }) => r.kind === "followup")).toBe(false);
});

it("retains missing observations but marks them absent, and preserves published exports on corrupt input", async () => {
  await refreshTeamExports();
  await rm(join(root, "brian/ACobrian/connections/ACoShared.json"));
  await refreshTeamExports();
  expect(
    (await load("brian")).rows.find((r: { kind: string }) => r.kind === "connections")
      .presentInLatestSnapshot
  ).toBe(false);
  const before = await readFile(join(exportRoot(), "team.json"), "utf8");
  await writeFile(join(root, "jp/ACojp/connections/ACoShared.json"), "broken");
  await expect(refreshTeamExports()).rejects.toThrow();
  expect(await readFile(join(exportRoot(), "team.json"), "utf8")).toBe(before);
});

it("refreshes on command completion, respects no-save, and classifies exports as offline", async () => {
  expect(await beginAutomaticExports("connections", "allman", { save: false })).toBeUndefined();
  const finish = await beginAutomaticExports("connections", "allman", {});
  expect(finish).toBeTypeOf("function");
  await finish?.();
  expect((await load()).rows.length).toBeGreaterThan(0);
});
