import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { browserWorkspace } from "@/linkedin/auth/browser-config.js";
import { acquireLinkedInLock, sessionControlRoot } from "@/linkedin/session-control.js";
import { saveStoreDefault, storeDefaultFile } from "@/store/config.js";
import { resolveStorePath } from "@/store/index.js";
import { workspaceRoot } from "@/store/private-workspace.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-profile-config-"));
  vi.stubEnv("XDG_CONFIG_HOME", root);
  for (const key of ["ALLMAN_PROFILE", "ALLMAN_STORE", "ALLMAN_BROWSER_WORKSPACE"])
    vi.stubEnv(key, "");
  vi.stubEnv("ALLMAN_RELATIONSHIP_STORE", undefined);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("keeps each named profile's saved store and browser workspace separate", async () => {
  for (const name of ["brian", "jp"]) {
    vi.stubEnv("ALLMAN_PROFILE", name);
    const profile = join(root, "allman", name);
    await saveStoreDefault(join(profile, "store"));
    expect(storeDefaultFile()).toBe(join(profile, "default-store.json"));
    expect(resolveStorePath()).toBe(join(profile, "store"));
    expect(browserWorkspace()).toBe(join(profile, "browser-workspace"));
  }
  expect(JSON.parse(await readFile(join(root, "allman/brian/default-store.json"), "utf8"))).toEqual(
    { storePath: join(root, "allman/brian/store") }
  );
});

it("uses the saved default profile, with explicit profile selection taking precedence", async () => {
  vi.stubEnv("ALLMAN_PROFILE", "brian");
  await saveStoreDefault(join(root, "allman/brian/store"));
  await writeFile(join(root, "allman/default-profile.json"), JSON.stringify({ profile: "brian" }));
  vi.stubEnv("ALLMAN_PROFILE", "");
  expect(resolveStorePath()).toBe(join(root, "allman/brian/store"));
  vi.stubEnv("ALLMAN_PROFILE", "jp");
  await saveStoreDefault(join(root, "allman/jp/store"));
  expect(resolveStorePath()).toBe(join(root, "allman/jp/store"));
  vi.stubEnv("ALLMAN_PROFILE", "");
  expect(resolveStorePath()).toBe(join(root, "allman/brian/store"));
});

it("never shares private relationship data with a different explicit store", async () => {
  vi.stubEnv("ALLMAN_PROFILE", "brian");
  const profile = join(root, "allman/brian");
  const store = join(profile, "store");
  await saveStoreDefault(store);
  await mkdir(store, { recursive: true });
  await symlink(store, join(root, "old-store"));
  expect(workspaceRoot(store)).toBe(join(profile, "relationships"));
  expect(workspaceRoot(join(root, "old-store"))).toBe(join(profile, "relationships"));
  expect(workspaceRoot(join(root, "another-store"))).not.toBe(join(profile, "relationships"));
  vi.stubEnv("ALLMAN_RELATIONSHIP_STORE", join(root, "explicit-private"));
  vi.stubEnv("ALLMAN_BROWSER_WORKSPACE", join(root, "explicit-browser"));
  expect(workspaceRoot(store)).toBe(join(root, "explicit-private"));
  expect(browserWorkspace()).toBe(join(root, "explicit-browser"));
});

it("keeps the registry and command lock shared across profile selections", () => {
  vi.stubEnv("ALLMAN_PROFILE", "brian");
  expect(sessionControlRoot()).toBe(join(root, "allman"));
  const release = acquireLinkedInLock("sync");
  try {
    vi.stubEnv("ALLMAN_PROFILE", "jp");
    expect(sessionControlRoot()).toBe(join(root, "allman"));
    expect(() => acquireLinkedInLock("enrich")).toThrow("already running");
  } finally {
    release();
  }
});

it.each(["../jp", "/tmp/jp", "JP", ".", "jp/other"])("rejects unsafe profile name %s", (name) => {
  vi.stubEnv("ALLMAN_PROFILE", name);
  expect(() => storeDefaultFile()).toThrow("Invalid Allman profile");
});

it("fails closed on an unconfigured selected profile or malformed default selector", async () => {
  vi.stubEnv("ALLMAN_PROFILE", "missing");
  expect(() => resolveStorePath()).toThrow("No default store configured for profile");
  vi.stubEnv("ALLMAN_PROFILE", "");
  await mkdir(join(root, "allman"));
  await writeFile(join(root, "allman/default-profile.json"), "{");
  expect(() => storeDefaultFile()).toThrow("Invalid default profile configuration");
});
