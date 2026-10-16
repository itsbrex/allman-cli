import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { allowExtensionLocalNetwork } from "@/linkedin/auth/local-network.js";
import type { ManagedProfile } from "@/linkedin/session-control.js";

const open = vi.hoisted(() => vi.fn());
vi.mock("@/linkedin/auth/browser.js", () => ({ openBrowserContext: open }));
let root: string;
let profile: ManagedProfile;
let installed: Array<{ id: string; path?: string; state: string }>;
let evaluate: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "allman-permissions-")));
  await mkdir(join(root, "shield"));
  await mkdir(join(root, "other"));
  profile = {
    name: "jp",
    account: "jp",
    store: root,
    workspace: root,
    browser: { cdpEndpoint: "http://127.0.0.1:9223", shieldPath: join(root, "shield") },
  };
  installed = [
    { id: "a".repeat(32), path: join(root, "shield"), state: "ENABLED" },
    { id: "b".repeat(32), path: join(root, "other"), state: "ENABLED" },
  ];
  evaluate = vi
    .fn()
    .mockImplementationOnce(async () => installed)
    .mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
  open.mockReset().mockResolvedValue({
    context: { newPage: async () => ({ goto: vi.fn(), evaluate }) },
    close,
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it("uses the registered browser and grants only configured installed extension origins", async () => {
  await allowExtensionLocalNetwork(profile, [join(root, "shield")]);
  expect(open).toHaveBeenCalledExactlyOnceWith({
    ...profile.browser,
    workspace: root,
    headless: true,
  });
  expect(evaluate.mock.calls[1]?.[1]).toEqual([`chrome-extension://${"a".repeat(32)}`]);
  expect(close).toHaveBeenCalledOnce();
});
it.each(["DISABLED", "TERMINATED"])("never enables or grants a %s extension", async (state) => {
  installed = installed.map((item) => ({ ...item, state }));
  await expect(allowExtensionLocalNetwork(profile, [join(root, "shield")])).rejects.toThrow(
    "Enabled development extension missing"
  );
  expect(evaluate).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledOnce();
});
it("rejects an unknown extension path before granting anything", async () => {
  await expect(allowExtensionLocalNetwork(profile, [join(root, "missing")])).rejects.toThrow(
    "Enabled development extension missing"
  );
  expect(evaluate).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledOnce();
});
it("cleans up scoped tabs and propagates permission failures", async () => {
  evaluate.mockRejectedValueOnce(new Error("Browser policy blocked permission"));
  await expect(allowExtensionLocalNetwork(profile, [join(root, "shield")])).rejects.toThrow(
    "Browser policy blocked permission"
  );
  expect(close).toHaveBeenCalledOnce();
});
