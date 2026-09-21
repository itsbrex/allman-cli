import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  launchAttempts,
  normalizeCdpEndpoint,
  openBrowserContext,
} from "@/linkedin/auth/browser.js";
import {
  browserEnvDefaults,
  browserProfilePath,
  mergeBrowserConfig,
  readBrowserConfig,
  saveBrowserConfig,
} from "@/linkedin/auth/browser-config.js";

const mocks = vi.hoisted(() => ({
  persistent: vi.fn(),
  cdp: vi.fn(),
  verify: vi.fn(),
  shield: vi.fn(),
  scoped: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("playwright", () => ({
  chromium: { launchPersistentContext: mocks.persistent, connectOverCDP: mocks.cdp },
}));
vi.mock("@/linkedin/auth/shield.js", () => ({
  readShieldPackage: mocks.shield,
  verifyShield: mocks.verify,
}));
vi.mock("@/linkedin/auth/cdp.js", () => ({ createScopedCdp: mocks.scoped }));

let workspace: string;
beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "allman-browser-unit-"));
  for (const name of [
    "ALLMAN_BROWSER",
    "ALLMAN_CDP_URL",
    "ALLMAN_BROWSER_PROFILE",
    "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
    "ALLMAN_SHIELD_PATH",
  ])
    vi.stubEnv(name, "");
  vi.stubEnv("ALLMAN_BROWSER_WORKSPACE", workspace);
  vi.clearAllMocks();
  mocks.scoped.mockResolvedValue({
    endpoint: "ws://127.0.0.1:1234/scoped",
    close: mocks.disconnect,
  });
  mocks.disconnect.mockResolvedValue(undefined);
  mocks.shield.mockResolvedValue({ path: "/shield/dist", version: "3.4.0" });
  mocks.verify.mockResolvedValue({
    id: "shield-id",
    version: "3.4.0",
    rulesets: ["linkedin_blocklist"],
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(workspace, { recursive: true, force: true });
});

describe("browser configuration", () => {
  it("rejects Bun versions with broken CDP WebSockets before opening a connection", async () => {
    vi.stubGlobal("process", { ...process, versions: { ...process.versions, bun: "1.3.14" } });
    await expect(
      openBrowserContext({ headless: true, workspace, cdpEndpoint: "9222" })
    ).rejects.toThrow("Bun 1.4.2 or newer");
    expect(mocks.scoped).not.toHaveBeenCalled();
    expect(mocks.cdp).not.toHaveBeenCalled();
  });
  it("resolves auto to Neo then full bundled Chromium on macOS", () => {
    expect(launchAttempts({}, "darwin").map((a) => a.browser)).toEqual([
      "browseros-neo",
      "chromium",
    ]);
    expect(launchAttempts({}, "linux")).toEqual([
      { channel: "chromium", label: "bundled Chromium", browser: "chromium" },
    ]);
  });
  it("preserves explicit executables and maps named BrowserOS applications", () => {
    expect(launchAttempts({ executablePath: "/opt/custom", channel: "chrome" })).toHaveLength(1);
    expect(
      launchAttempts({ executablePath: "/opt/custom", channel: "chrome" })[0]?.channel
    ).toBeUndefined();
    expect(launchAttempts({ channel: "browseros-neo" }, "darwin")[0]?.executablePath).toBe(
      "/Applications/BrowserOS neo.app/Contents/MacOS/BrowserOS neo"
    );
    expect(() => launchAttempts({ channel: "obscura" })).toThrow("no verified");
  });
  it("uses the full Chromium channel for headless extension support", () => {
    expect(launchAttempts({ channel: "chromium" })[0]?.channel).toBe("chromium");
  });
  it("lets a CLI browser replace saved CDP/executable choices without dropping Shield", () => {
    expect(
      mergeBrowserConfig(
        { cdpEndpoint: "9222", shieldPath: "/shield" },
        { executablePath: "/old" },
        { channel: "chromium" }
      )
    ).toEqual({ shieldPath: "/shield", profileDir: undefined, channel: "chromium" });
  });
  it("keeps env parsing pure and treats empty strings as unset", () => {
    expect(
      browserEnvDefaults({
        ALLMAN_BROWSER: "browseros-neo",
        ALLMAN_SHIELD_PATH: "/shield",
        ALLMAN_CDP_URL: "",
      })
    ).toEqual({
      channel: "browseros-neo",
      shieldPath: "/shield",
      cdpEndpoint: undefined,
      executablePath: undefined,
      profileDir: undefined,
    });
  });
  it("round-trips private configuration and rejects malformed or relative paths", async () => {
    await saveBrowserConfig({ channel: "chromium", shieldPath: "/shield" }, workspace);
    expect(readBrowserConfig(workspace)).toEqual({ channel: "chromium", shieldPath: "/shield" });
    expect((await stat(join(workspace, "config.json"))).mode & 0o777).toBe(0o600);
    await writeFile(join(workspace, "config.json"), '{"shieldPath":"relative"}');
    expect(() => readBrowserConfig(workspace)).toThrow("must be absolute");
    await writeFile(join(workspace, "config.json"), '{"unknown":"field"}');
    expect(() => readBrowserConfig(workspace)).toThrow("invalid field unknown");
  });
  it("keeps profiles stable, separates capture/accounts/providers, and contains path-like identities", () => {
    const config = { channel: "browseros-neo" };
    const path = browserProfilePath(config, workspace, "login", "../account");
    expect(path.startsWith(workspace)).toBe(true);
    expect(path).toBe(browserProfilePath(config, workspace, "login", "../account"));
    expect(path).not.toBe(browserProfilePath(config, workspace, "capture", "../account"));
    expect(path).not.toBe(browserProfilePath(config, workspace, "login", "second"));
    expect(path).not.toBe(
      browserProfilePath({ channel: "chromium" }, workspace, "login", "../account")
    );
    expect(
      browserProfilePath({ profileDir: "/dedicated" }, workspace, "capture", "account")
    ).toMatch(/^\/dedicated\/allman-capture\//);
  });
  it("normalizes CDP ports and keeps credentials out of saved endpoints", () => {
    expect(normalizeCdpEndpoint("9222")).toBe("http://127.0.0.1:9222");
    expect(normalizeCdpEndpoint("ws://127.0.0.1:9222/devtools/browser/abc")).toContain("/abc");
    expect(() => normalizeCdpEndpoint("https://browser.example?token=secret")).toThrow(
      "without embedded credentials"
    );
  });
});

describe("protected browser acquisition", () => {
  it("uses the same persistent profile and reloads Shield on every launch", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.persistent.mockResolvedValue({ close });
    await saveBrowserConfig({ channel: "chromium", shieldPath: "/shield" }, workspace);
    const first = await openBrowserContext({ headless: true });
    await first.close();
    const second = await openBrowserContext({ headless: true });
    await second.close();
    expect(first.profileDir).toBe(second.profileDir);
    expect(mocks.persistent).toHaveBeenCalledTimes(2);
    expect(mocks.persistent.mock.calls[0]?.[1]).toMatchObject({
      channel: "chromium",
      args: ["--load-extension=/shield/dist"],
      ignoreDefaultArgs: ["--disable-extensions"],
    });
    expect(mocks.persistent.mock.calls[0]?.[1]).not.toHaveProperty("userAgent");
    expect(mocks.verify).toHaveBeenCalledTimes(2);
  });
  it("refuses before any launch when the required Shield package is missing", async () => {
    mocks.shield.mockRejectedValueOnce(new Error("LinkedIn Shield is required"));
    await expect(openBrowserContext({ headless: true })).rejects.toThrow("Shield is required");
    expect(mocks.persistent).not.toHaveBeenCalled();
    expect(mocks.cdp).not.toHaveBeenCalled();
  });
  it("closes its owned context and fails rather than trying an unprotected fallback", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.persistent.mockResolvedValueOnce({ close });
    mocks.verify.mockRejectedValueOnce(new Error("Shield disabled"));
    await expect(openBrowserContext({ headless: true, channel: "chromium" })).rejects.toThrow(
      "Shield disabled"
    );
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.persistent).toHaveBeenCalledOnce();
  });
  it("does not fall back after a locked or broken profile launch", async () => {
    mocks.persistent.mockRejectedValueOnce(new Error("profile is locked"));
    await expect(openBrowserContext({ headless: true, channel: "chromium" })).rejects.toThrow(
      "No fallback was attempted"
    );
    expect(mocks.persistent).toHaveBeenCalledOnce();
  });
  it("requires the CDP default context and never creates an extension-free context", async () => {
    const browser = {
      contexts: () => [],
      newContext: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mocks.cdp.mockResolvedValueOnce(browser);
    await expect(openBrowserContext({ headless: true, cdpEndpoint: "9222" })).rejects.toThrow(
      "no persistent default context"
    );
    expect(browser.newContext).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });
  it("disconnects CDP without closing the borrowed context", async () => {
    const context = { close: vi.fn() };
    const browser = { contexts: () => [context], close: vi.fn().mockResolvedValue(undefined) };
    mocks.cdp.mockResolvedValueOnce(browser);
    const session = await openBrowserContext({ headless: true, cdpEndpoint: "9222" });
    await session.close();
    expect(context.close).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(await readFile(join(workspace, "config.json")).catch(() => null)).toBeNull();
  });
  it("preserves the underlying CDP error for diagnosis", async () => {
    const cause = new Error("browserType.connectOverCDP: Timeout 15000ms exceeded.");
    mocks.cdp.mockRejectedValueOnce(cause);
    const error = await openBrowserContext({ headless: true, cdpEndpoint: "9222" }).catch(
      (error: unknown) => error
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty("cause", cause);
    expect((error as Error).message).toContain(cause.message);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});
