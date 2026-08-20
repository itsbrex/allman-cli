/**
 * Browser acquisition logic (auth/browser.ts) — the pure parts only. Actually
 * launching browsers is exercised manually; what's pinned here is the
 * resolution order that makes `playwright install chromium` optional.
 */
import { describe, expect, it } from "vitest";
import {
  browserEnvDefaults,
  launchAttempts,
  normalizeCdpEndpoint,
} from "@/linkedin/auth/browser.js";

describe("launchAttempts", () => {
  it("defaults to system Chrome, then Edge, then the bundled Chromium", () => {
    expect(launchAttempts({})).toEqual([
      { channel: "chrome", label: "Google Chrome (system)" },
      { channel: "msedge", label: "Microsoft Edge (system)" },
      { label: "bundled Chromium" },
    ]);
  });

  it("an explicit channel is authoritative — one attempt, no silent fallback", () => {
    const attempts = launchAttempts({ channel: "msedge" });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ channel: "msedge" });
  });

  it("channel 'chromium' means the bundled build, not a channel", () => {
    const attempts = launchAttempts({ channel: "chromium" });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.channel).toBeUndefined();
    expect(attempts[0]?.label).toBe("bundled Chromium");
  });

  it("an explicit executable path wins over any channel", () => {
    const attempts = launchAttempts({ channel: "chrome", executablePath: "/opt/chromium" });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ executablePath: "/opt/chromium" });
    expect(attempts[0]?.channel).toBeUndefined();
  });
});

describe("normalizeCdpEndpoint", () => {
  it("expands a bare port to a local http endpoint", () => {
    expect(normalizeCdpEndpoint("9222")).toBe("http://127.0.0.1:9222");
  });

  it("passes full endpoints through untouched", () => {
    expect(normalizeCdpEndpoint("http://10.0.0.5:9222")).toBe("http://10.0.0.5:9222");
    expect(normalizeCdpEndpoint("ws://127.0.0.1:9222/devtools/browser/abc")).toBe(
      "ws://127.0.0.1:9222/devtools/browser/abc"
    );
  });
});

describe("browserEnvDefaults", () => {
  it("reads the four browser env vars, treating empty strings as unset", () => {
    expect(
      browserEnvDefaults({
        ALLMAN_BROWSER: "msedge",
        ALLMAN_BROWSER_PROFILE: "/tmp/profile",
        ALLMAN_CDP_URL: "9222",
        PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "",
      })
    ).toEqual({
      channel: "msedge",
      profileDir: "/tmp/profile",
      cdpEndpoint: "9222",
      executablePath: undefined,
    });
  });

  it("returns all-undefined for an empty environment", () => {
    expect(browserEnvDefaults({})).toEqual({
      channel: undefined,
      profileDir: undefined,
      cdpEndpoint: undefined,
      executablePath: undefined,
    });
  });
});
