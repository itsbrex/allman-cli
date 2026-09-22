import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  acquireLinkedInLock,
  assertActiveProfile,
  type ManagedProfile,
  saveSessionRegistry,
  usesLinkedIn,
} from "@/linkedin/session-control.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-session-control-"));
  vi.stubEnv("XDG_CONFIG_HOME", root);
  for (const name of [
    "ALLMAN_STORE",
    "ALLMAN_ACCOUNT",
    "ALLMAN_CDP_URL",
    "ALLMAN_BROWSER",
    "ALLMAN_BROWSER_PROFILE",
    "ALLMAN_SHIELD_PATH",
    "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
  ])
    vi.stubEnv(name, "");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("allows a new command after its predecessor releases the global lock", () => {
  const first = acquireLinkedInLock("sync");
  expect(() => acquireLinkedInLock("enrich")).toThrow("already running");
  first();
  first();
  const second = acquireLinkedInLock("enrich");
  second();
  expect(existsSync(join(root, "allman/linkedin-command.lock"))).toBe(false);
});
it("recovers a crashed command without deleting an active owner's lock", async () => {
  const exited = spawnSync(process.execPath, ["-e", ""]);
  expect(exited.status).toBe(0);
  const dir = join(root, "allman/linkedin-command.lock");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "owner-crashed.json"),
    JSON.stringify({ pid: exited.pid, operation: "sync" })
  );
  const release = acquireLinkedInLock("enrich");
  expect(() => acquireLinkedInLock("sync")).toThrow("already running");
  release();
});
it("fails closed for an incomplete lock instead of assuming its owner is dead", async () => {
  await mkdir(join(root, "allman/linkedin-command.lock"), { recursive: true });
  expect(() => acquireLinkedInLock("sync")).toThrow("owner unreadable");
});
it("resolves store and account aliases but rejects browser and account overrides", async () => {
  const store = join(root, "store"),
    workspace = join(root, "browser");
  await mkdir(join(store, "ACoJp"), { recursive: true });
  await writeFile(join(store, "ACoJp/AUTH.json"), "{}");
  await symlink("ACoJp", join(store, "jp"));
  await symlink(store, join(root, "store-alias"));
  await mkdir(workspace);
  const browser = { cdpEndpoint: "http://127.0.0.1:9233", shieldPath: "/fixture/shield" };
  await writeFile(join(workspace, "config.json"), JSON.stringify(browser));
  vi.stubEnv("ALLMAN_BROWSER_WORKSPACE", workspace);
  const profile: ManagedProfile = { name: "jp", store, account: "jp", workspace, browser };
  saveSessionRegistry({ version: 1, active: "jp", profiles: [profile] });
  await expect(
    assertActiveProfile({ store: join(root, "store-alias"), account: "ACoJp" })
  ).resolves.toMatchObject({ name: "jp" });
  await expect(assertActiveProfile({ store, account: "ACoOther" })).rejects.toThrow(
    "Active LinkedIn profile"
  );
  await expect(
    assertActiveProfile({ store, account: "jp", cdp: "http://127.0.0.1:9222" })
  ).rejects.toThrow("Browser configuration differs");
});
it.each([
  "login",
  "start",
  "sync",
  "listen",
  "enrich",
  "connections",
  "connections-of",
  "connect",
  "send",
  "react",
  "inbox",
  "future-network-command",
])("guards %s", (command) => {
  expect(usesLinkedIn(command, {})).toBe(true);
});
it("guards live variants while preserving local history and relationship queries", () => {
  expect(usesLinkedIn("status", { check: true })).toBe(true);
  expect(usesLinkedIn("status", {})).toBe(false);
  expect(usesLinkedIn("messages", {})).toBe(true);
  expect(usesLinkedIn("messages", { sync: false })).toBe(false);
  expect(usesLinkedIn("connections", { geo: ["San Diego"] })).toBe(false);
  expect(usesLinkedIn("connections", { geo: [] })).toBe(true);
  expect(
    usesLinkedIn("connections", { geo: ["San Diego"], browserosMcp: "http://127.0.0.1:9010/mcp" })
  ).toBe(true);
  for (const command of ["conversations", "contact", "rank", "icp", "intro-to", "graph"])
    expect(usesLinkedIn(command, {})).toBe(false);
});
