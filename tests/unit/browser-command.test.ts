import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserConfigureCommand } from "@/commands/browser.js";
import { readBrowserConfig, saveBrowserConfig } from "@/linkedin/auth/browser-config.js";

const open = vi.hoisted(() => vi.fn());
vi.mock("@/linkedin/auth/browser.js", () => ({
  openBrowserContext: open,
  normalizeCdpEndpoint: (endpoint: string) => endpoint,
}));
vi.mock("@/linkedin/auth/shield.js", () => ({
  readShieldPackage: async () => ({ path: "/verified/shield", version: "3.4.0" }),
}));
vi.mock("@/utils/output.js", () => ({ success: vi.fn(), printData: vi.fn() }));
let workspace: string;
beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "allman-browser-command-"));
  vi.stubEnv("ALLMAN_BROWSER_WORKSPACE", workspace);
  for (const key of [
    "ALLMAN_BROWSER",
    "ALLMAN_CDP_URL",
    "ALLMAN_BROWSER_PROFILE",
    "ALLMAN_SHIELD_PATH",
    "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
  ])
    vi.stubEnv(key, "");
  vi.clearAllMocks();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(workspace, { recursive: true, force: true });
});
describe("browser configure", () => {
  it("preserves the old default when the candidate fails verification", async () => {
    await saveBrowserConfig({ channel: "browseros-neo", shieldPath: "/old/shield" }, workspace);
    open.mockRejectedValueOnce(new Error("Shield verification failed"));
    await expect(browserConfigureCommand({ browser: "chromium" })).rejects.toThrow(
      "Shield verification failed"
    );
    expect(readBrowserConfig(workspace)).toEqual({
      channel: "browseros-neo",
      shieldPath: "/old/shield",
    });
  });
  it("saves the verified browser, normalizes environment paths, and closes its session", async () => {
    vi.stubEnv("ALLMAN_BROWSER_PROFILE", "relative-profile");
    const close = vi.fn().mockResolvedValue(undefined);
    open.mockResolvedValueOnce({
      browser: "chromium",
      shield: { version: "3.4.0" },
      description: "fixture",
      close,
    });
    await browserConfigureCommand({ browser: "chromium" });
    expect(readBrowserConfig(workspace)).toEqual({
      channel: "chromium",
      profileDir: resolve("relative-profile"),
      shieldPath: "/verified/shield",
    });
    expect(close).toHaveBeenCalledOnce();
  });
});
