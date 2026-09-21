/** Persistent browser acquisition shared by login and queryId capture. */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { BrowserContext } from "playwright";
import {
  type BrowserConfig,
  browserEnvDefaults,
  browserProfilePath,
  browserWorkspace,
  mergeBrowserConfig,
  readBrowserConfig,
} from "./browser-config.js";
import { createScopedCdp } from "./cdp.js";
import { readShieldPackage, type ShieldVerification, verifyShield } from "./shield.js";

export { browserEnvDefaults } from "./browser-config.js";

export interface BrowserSessionOptions extends BrowserConfig {
  headless: boolean;
  workspace?: string;
  purpose?: "login" | "capture";
  identity?: string;
}

export type BrowserSessionKind = "cdp" | "persistent";

export interface BrowserSession {
  context: BrowserContext;
  kind: BrowserSessionKind;
  browser: string;
  description: string;
  profileDir?: string;
  shield: ShieldVerification;
  /** Disconnects for CDP; closes only browsers launched by allman. */
  close(): Promise<void>;
}

export interface LaunchAttempt {
  channel?: string;
  executablePath?: string;
  label: string;
  browser: string;
}

/** Explicit choices never fall back. Auto selects installed Neo, then bundled Chromium. */
export function launchAttempts(
  opts: Pick<BrowserConfig, "channel" | "executablePath">,
  platform = process.platform
): LaunchAttempt[] {
  if (opts.executablePath) {
    return [
      { executablePath: resolve(opts.executablePath), label: "custom Chromium", browser: "custom" },
    ];
  }
  if (opts.channel === "browseros-neo" || opts.channel === "browseros") {
    if (platform !== "darwin")
      throw new Error(
        "Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to your BrowserOS executable on this platform."
      );
    const app = opts.channel === "browseros-neo" ? "BrowserOS neo" : "BrowserOS";
    return [
      {
        executablePath: `/Applications/${app}.app/Contents/MacOS/${app}`,
        label: app,
        browser: opts.channel,
      },
    ];
  }
  if (["viewforge", "obscura", "camoufox", "invisible_playwright"].includes(opts.channel ?? "")) {
    throw new Error(
      `${opts.channel} has no verified Chromium MV3 Shield adapter. Use BrowserOS neo, bundled Chromium, or an extension-capable Chromium CDP endpoint.`
    );
  }
  if (opts.channel) {
    return [
      {
        channel: opts.channel,
        label: opts.channel === "chromium" ? "bundled Chromium" : opts.channel,
        browser: opts.channel,
      },
    ];
  }
  return [
    ...(platform === "darwin" ? launchAttempts({ channel: "browseros-neo" }, platform) : []),
    { channel: "chromium", label: "bundled Chromium", browser: "chromium" },
  ];
}

export function normalizeCdpEndpoint(endpoint: string): string {
  const normalized = /^\d+$/.test(endpoint) ? `http://127.0.0.1:${endpoint}` : endpoint;
  const url = new URL(normalized);
  if (
    !["http:", "https:", "ws:", "wss:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Use an HTTP(S) or WS(S) CDP endpoint without embedded credentials, query parameters, or fragments."
    );
  }
  return normalized;
}

/** No caller receives a context until the exact Shield build and blocking rules pass. */
export async function openBrowserContext(options: BrowserSessionOptions): Promise<BrowserSession> {
  const workspace = resolve(options.workspace ?? browserWorkspace());
  const config = mergeBrowserConfig(readBrowserConfig(workspace), browserEnvDefaults(), options);
  const shield = await readShieldPackage(config.shieldPath);
  const { chromium } = await import("playwright");

  if (config.cdpEndpoint) {
    const bun = process.versions.bun;
    if (bun) {
      const [major = 0, minor = 0, patch = 0] = bun.split(".").map(Number);
      if (major < 1 || (major === 1 && (minor < 4 || (minor === 4 && patch < 2))))
        throw new Error(
          `CDP requires Bun 1.4.2 or newer (running ${bun}), or the Node entry point. Older Bun WebSocket transports can hang during browser attachment.`
        );
    }
    const endpoint = normalizeCdpEndpoint(config.cdpEndpoint);
    const url = new URL(endpoint);
    let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>;
    let scoped: Awaited<ReturnType<typeof createScopedCdp>> | undefined;
    try {
      scoped = await createScopedCdp(endpoint);
      browser = await chromium.connectOverCDP(scoped.endpoint, { timeout: 15_000 });
    } catch (error) {
      await scoped?.close();
      throw new Error(
        `Could not attach to CDP at ${url.protocol}//${url.host}.\n${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
    const disconnect = async () => {
      try {
        await browser.close();
      } finally {
        await scoped.close();
      }
    };
    try {
      // Incognito/new contexts do not inherit the installed extension.
      const context = browser.contexts()[0];
      if (!context)
        throw new Error(
          "CDP browser has no persistent default context. Start a persistent, extension-capable Chromium profile first."
        );
      const protection = await verifyShield(context, shield);
      return {
        context,
        kind: "cdp",
        browser: "cdp",
        shield: protection,
        description: `existing browser at ${url.protocol}//${url.host}, Shield ${protection.version}`,
        close: disconnect,
      };
    } catch (error) {
      await disconnect().catch(() => {});
      throw error;
    }
  }

  const attempts = launchAttempts(config);
  const explicit = Boolean(config.channel || config.executablePath);
  const attempt = attempts.find(
    (a) => explicit || !a.executablePath || existsSync(a.executablePath)
  );
  if (!attempt)
    throw new Error(
      "No supported browser found. Install BrowserOS neo or run `allman install-browsers`."
    );
  // Choose the profile using the resolved browser, so auto and explicit selection agree.
  const resolved = { ...config, channel: attempt.browser };
  const profileDir = browserProfilePath(
    resolved,
    workspace,
    options.purpose ?? "login",
    options.identity
  );
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: options.headless,
      ...(attempt.channel ? { channel: attempt.channel } : {}),
      ...(attempt.executablePath ? { executablePath: attempt.executablePath } : {}),
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [`--load-extension=${shield.path}`],
      viewport: { width: 1280, height: 800 },
      timeout: 15_000,
    });
  } catch (error) {
    throw new Error(
      `Could not launch ${attempt.label} with profile ${profileDir}. Close any process using this dedicated profile, or check the browser installation. No fallback was attempted.\n${(error as Error).message.split("\n")[0]}`
    );
  }
  try {
    const protection = await verifyShield(context, shield);
    return {
      context,
      kind: "persistent",
      browser: attempt.browser,
      profileDir,
      shield: protection,
      description: `${attempt.label}, profile ${profileDir}, Shield ${protection.version}`,
      close: () => context.close(),
    };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}
