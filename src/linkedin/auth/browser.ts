/**
 * Shared browser acquisition for every flow that needs a real browser
 * (interactive login, headless queryId capture).
 *
 * Nothing here requires `playwright install chromium` any more. Three ways to
 * get a context, in priority order:
 *
 *   1. `cdpEndpoint` (`--cdp` / ALLMAN_CDP_URL) — attach to a browser the user
 *      is ALREADY running (started with `--remote-debugging-port=<n>`). Their
 *      real session, profile, and extensions. We only read from it and
 *      disconnect: never close it, never inject cookies into it.
 *   2. `profileDir` (`--profile` / ALLMAN_BROWSER_PROFILE) — a persistent
 *      profile directory of our own. LinkedIn learns to trust the device, so
 *      re-logins usually skip the 2FA dance.
 *   3. Plain launch, trying: the explicit channel (`--browser` /
 *      ALLMAN_BROWSER), else system Chrome → Microsoft Edge → Playwright's
 *      bundled Chromium. Only when none exists do we point at
 *      `allman install-browsers` (or just installing Chrome).
 *
 * Why there is no "use my daily Chrome profile" option: a running Chrome
 * locks its user-data-dir, and Chrome 136+ refuses remote debugging on the
 * DEFAULT profile outright. `--cdp` (the user launches Chrome themselves,
 * with a side user-data-dir) and `--profile` (a dedicated dir that becomes a
 * known device) are the two honest ways to reuse a known browser.
 */

import { resolve } from "node:path";
import type { BrowserContext } from "playwright";

/** Flags shared by launched and persistent contexts. */
const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-blink-features=AutomationControlled",
  "--disable-infobars",
];

/**
 * UA mask for the bundled Chromium only — a real branded browser presents its
 * own (masking it would just create a UA/fingerprint mismatch).
 */
const BUNDLED_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const VIEWPORT = { width: 1280, height: 800 };

export interface BrowserSessionOptions {
  headless: boolean;
  /** Playwright channel: "chrome", "msedge", "chrome-beta", … ("chromium" = bundled). */
  channel?: string;
  /** Explicit browser executable — wins over any channel. */
  executablePath?: string;
  /** Persistent profile directory → launchPersistentContext. */
  profileDir?: string;
  /** CDP endpoint (or bare port) of an already-running browser → connectOverCDP. */
  cdpEndpoint?: string;
}

export type BrowserSessionKind = "cdp" | "persistent" | "launched";

export interface BrowserSession {
  context: BrowserContext;
  kind: BrowserSessionKind;
  /** What we attached to / launched, for user-facing logging. */
  description: string;
  /** Disconnects for "cdp" (the user's browser stays open); closes otherwise. */
  close(): Promise<void>;
}

/** Environment fallbacks, so non-login flows pick the same browser up. */
export function browserEnvDefaults(
  env: Record<string, string | undefined> = process.env
): Pick<BrowserSessionOptions, "channel" | "executablePath" | "profileDir" | "cdpEndpoint"> {
  return {
    channel: env.ALLMAN_BROWSER || undefined,
    executablePath: env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    profileDir: env.ALLMAN_BROWSER_PROFILE || undefined,
    cdpEndpoint: env.ALLMAN_CDP_URL || undefined,
  };
}

export interface LaunchAttempt {
  channel?: string;
  executablePath?: string;
  label: string;
}

/**
 * The ordered launch attempts for the given options. Pure — exposed for tests.
 * An explicit executable or channel is authoritative (one attempt, so a typo
 * fails loudly instead of silently landing in a different browser).
 */
export function launchAttempts(
  opts: Pick<BrowserSessionOptions, "channel" | "executablePath">
): LaunchAttempt[] {
  if (opts.executablePath) {
    return [{ executablePath: opts.executablePath, label: `executable ${opts.executablePath}` }];
  }
  if (opts.channel) {
    if (opts.channel === "chromium") return [{ label: "bundled Chromium" }];
    return [{ channel: opts.channel, label: `${opts.channel} (system)` }];
  }
  return [
    { channel: "chrome", label: "Google Chrome (system)" },
    { channel: "msedge", label: "Microsoft Edge (system)" },
    { label: "bundled Chromium" },
  ];
}

/** `"9222"` → `http://127.0.0.1:9222`; full URLs pass through untouched. */
export function normalizeCdpEndpoint(endpoint: string): string {
  return /^\d+$/.test(endpoint) ? `http://127.0.0.1:${endpoint}` : endpoint;
}

/** Acquire a browser context per the resolution order in the file header. */
export async function openBrowserContext(options: BrowserSessionOptions): Promise<BrowserSession> {
  const { chromium } = await import("playwright");

  if (options.cdpEndpoint) {
    const endpoint = normalizeCdpEndpoint(options.cdpEndpoint);
    let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>;
    try {
      browser = await chromium.connectOverCDP(endpoint);
    } catch (err) {
      throw new Error(
        `Could not attach to a browser at ${endpoint}. Start one with remote debugging first, e.g.\n` +
          `  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.allman/chrome-debug"\n` +
          `(Chrome 136+ refuses debugging on its default profile — the --user-data-dir override is required.)\n` +
          `Underlying error: ${(err as Error).message}`
      );
    }
    const context = browser.contexts()[0] ?? (await browser.newContext());
    return {
      context,
      kind: "cdp",
      description: `existing browser over CDP at ${endpoint}`,
      // close() on a CDP connection disconnects; it never kills the browser.
      close: async () => {
        await browser.close().catch(() => {});
      },
    };
  }

  const attempts = launchAttempts(options);
  const failures: string[] = [];

  if (options.profileDir) {
    const dir = resolve(options.profileDir);
    for (const attempt of attempts) {
      try {
        const context = await chromium.launchPersistentContext(dir, {
          headless: options.headless,
          ...(attempt.channel ? { channel: attempt.channel } : {}),
          ...(attempt.executablePath ? { executablePath: attempt.executablePath } : {}),
          ...(attempt.channel ? {} : { userAgent: BUNDLED_UA }),
          args: LAUNCH_ARGS,
          viewport: VIEWPORT,
        });
        return {
          context,
          kind: "persistent",
          description: `${attempt.label}, profile ${dir}`,
          close: () => context.close(),
        };
      } catch (err) {
        failures.push(`${attempt.label}: ${firstLine((err as Error).message)}`);
      }
    }
    throw noBrowserError(failures);
  }

  for (const attempt of attempts) {
    try {
      const browser = await chromium.launch({
        headless: options.headless,
        ...(attempt.channel ? { channel: attempt.channel } : {}),
        ...(attempt.executablePath ? { executablePath: attempt.executablePath } : {}),
        args: LAUNCH_ARGS,
      });
      const context = await browser.newContext({
        viewport: VIEWPORT,
        ...(attempt.channel ? {} : { userAgent: BUNDLED_UA }),
      });
      return {
        context,
        kind: "launched",
        description: attempt.label,
        close: () => browser.close(),
      };
    } catch (err) {
      failures.push(`${attempt.label}: ${firstLine((err as Error).message)}`);
    }
  }
  throw noBrowserError(failures);
}

function noBrowserError(failures: string[]): Error {
  return new Error(
    "No usable browser found. Install Google Chrome (or Microsoft Edge) and re-run — " +
      "no download needed — or run `allman install-browsers` for the bundled Chromium.\n" +
      `Tried:\n  ${failures.join("\n  ")}`
  );
}

function firstLine(message: string): string {
  return message.split("\n", 1)[0] ?? message;
}
