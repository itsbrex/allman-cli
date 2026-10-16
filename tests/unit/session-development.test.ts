import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ManagedProfile } from "@/linkedin/session-control.js";
import {
  prepareSessionDevelopment,
  readSessionDevelopment,
} from "@/linkedin/session-development.js";

const allow = vi.hoisted(() => vi.fn());
const restart = vi.hoisted(() => vi.fn());
vi.mock("@/linkedin/auth/local-network.js", () => ({ allowExtensionLocalNetwork: allow }));
vi.mock("@/linkedin/shield-dev-server.js", () => ({ restartShieldDevelopment: restart }));
let root: string;
let shield: string;
let extensions: string[];
let profiles: ManagedProfile[];
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "allman-session-dev-")));
  vi.stubEnv("XDG_CONFIG_HOME", root);
  shield = join(root, "shield");
  extensions = [join(shield, ".dev-build"), join(root, "session-alive")];
  await mkdir(join(root, "allman"));
  await mkdir(join(shield, "dev"), { recursive: true });
  await writeFile(join(shield, "dev/server.mjs"), "");
  await writeFile(
    join(shield, "package.json"),
    JSON.stringify({ name: "linkedin-shield", scripts: { dev: "node dev/server.mjs" } })
  );
  for (const path of extensions) {
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "manifest.json"), "{}");
  }
  profiles = ["brian", "jp"].map((name, i) => ({
    name,
    account: name,
    store: join(root, name),
    workspace: join(root, name),
    browser: {
      shieldPath: join(shield, ".dev-build"),
      cdpEndpoint: `http://127.0.0.1:${9222 + i}`,
    },
  }));
  allow.mockReset().mockResolvedValue(undefined);
  restart.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
async function configure(overrides = {}) {
  await writeFile(
    join(root, "allman/session-development.json"),
    JSON.stringify({
      version: 1,
      shield: { root: shield, node: process.execPath, port: 8396 },
      extensions,
      ...overrides,
    })
  );
}
it("leaves installations without the opt-in config untouched", async () => {
  expect(await prepareSessionDevelopment(profiles)).toBe(false);
  expect(allow).not.toHaveBeenCalled();
  expect(restart).not.toHaveBeenCalled();
});
it("grants configured extensions in both registered profiles before restarting once", async () => {
  await configure();
  restart.mockImplementation(async () => expect(allow).toHaveBeenCalledTimes(2));
  expect(await prepareSessionDevelopment(profiles)).toBe(true);
  expect(allow).toHaveBeenNthCalledWith(1, profiles[0], extensions);
  expect(allow).toHaveBeenNthCalledWith(2, profiles[1], extensions);
  expect(restart).toHaveBeenCalledExactlyOnceWith(
    { root: shield, node: await realpath(process.execPath), port: 8396 },
    join(root, "allman"),
    2
  );
});
it("does not restart if permission setup fails", async () => {
  await configure();
  allow.mockRejectedValue(new Error("permission refused"));
  await expect(prepareSessionDevelopment(profiles)).rejects.toThrow("permission refused");
  expect(restart).not.toHaveBeenCalled();
});
it("rejects a different Shield build before changing either browser", async () => {
  await configure();
  const jp = profiles.find((profile) => profile.name === "jp");
  if (!jp) throw new Error("Missing JP fixture");
  jp.browser.shieldPath = join(root, "session-alive");
  await expect(prepareSessionDevelopment(profiles)).rejects.toThrow("does not use");
  expect(allow).not.toHaveBeenCalled();
  expect(restart).not.toHaveBeenCalled();
});
it.each([
  { version: 2 },
  { shield: { root: "relative", node: process.execPath, port: 8396 } },
  { shield: { root: "/missing", node: process.execPath, port: 8396 } },
  { shield: { root: "/missing", node: process.execPath, port: 0 } },
  { extensions: [] },
  { extensions: ["*"] },
])("fails closed on invalid configuration %j", async (overrides) => {
  await configure(overrides);
  expect(() => readSessionDevelopment(join(root, "allman"))).toThrow(
    "Invalid session development configuration"
  );
});
