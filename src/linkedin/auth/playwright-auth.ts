/**
 * LinkedIn authentication via a headed browser.
 *
 * Because LinkedIn's login flow is highly interactive (2FA app notifications,
 * TOTP codes, email codes, captcha, device verification), we always use a
 * headed browser and let the human complete login manually.
 *
 * The browser comes from `openBrowserContext` (see auth/browser.ts): the
 * configured persistent browser with mandatory LinkedIn Shield, or — with
 * `--cdp` — an existing persistent Chromium context whose Shield build must
 * pass the same verification before any LinkedIn navigation.
 *
 * The CLI:
 *   1. Opens a browser window (headed) or attaches to a running one
 *   2. Injects existing cookies if any (may skip login form entirely;
 *      never done to a --cdp browser — that session is not ours to mutate)
 *   3. Verifies existing browser cookies against the authenticated /me endpoint
 *   4. Opens login only if the browser session needs authentication
 *   5. Captures the realtime app version from Shield-protected feed requests
 *   6. Optionally captures the Sales Navigator seat, then re-verifies the export
 *   7. Returns the verified owner and updated cookie jar for private local storage
 *
 * Re-auth flow (cookies exist but expired):
 *   Same as above — inject existing cookies first. LinkedIn may skip the login
 *   form if they're still valid.
 *
 * Timeout: 5 minutes (configurable via LOGIN_TIMEOUT_MS env var).
 */

import type { Page, Request } from "playwright";
import type { AccountCookies, ProxyConfig } from "../../store/types.js";
import * as output from "../../utils/output.js";
import { buildEmptyApiClient, LinkedInError } from "../api/client.js";
import {
  cookiesFromPlaywright,
  isAuthenticated,
  isLinkedInCookieDomain,
  type PlaywrightCookie,
  serializeCookieJar,
} from "../api/cookies.js";
import { getCurrentProfile } from "../api/endpoints/profiles.js";
import { openBrowserContext } from "./browser.js";

const LOGIN_URL = "https://www.linkedin.com/login";
const FEED_URL = "https://www.linkedin.com/feed/";
const FEED_URL_PATTERN = /^https:\/\/www\.linkedin\.com\/(feed|in\/|messaging)/;

const LOGIN_TIMEOUT_MS = parseInt(process.env.LOGIN_TIMEOUT_MS ?? "300000", 10); // 5 minutes

export interface AuthResult {
  success: boolean;
  profileUrn: string | null;
  name: string | null;
  headline: string | null;
  profileUrl: string | null;
  imageUrl: string | null;
  cookieJar: object;
  requestIdentity?: AccountCookies["requestIdentity"];
  error?: string;
}

export interface AuthOptions {
  /** Existing cookies to inject before navigating (for re-auth). */
  existingCookieJar?: object | null;
  /** Override executable path for the browser. */
  executablePath?: string;
  /** Playwright channel ("chrome", "msedge", "chromium" = bundled). */
  channel?: string;
  /** Persistent browser profile directory — the device LinkedIn learns to trust. */
  profileDir?: string;
  /** Attach to an already-running browser over CDP instead of launching one. */
  cdpEndpoint?: string;
  shieldPath?: string;
  identity?: string;
  /** Visit Sales Navigator to capture the seat cookie (optional; default true). */
  salesnav?: boolean;
  /** Use the same HTTP proxy as normal CLI requests when verifying the export. */
  proxy?: ProxyConfig;
}

/**
 * Run the interactive login flow.
 * Opens a headed browser window (or attaches to a running browser) and waits
 * for the user to authenticate.
 */
export async function runLogin(options: AuthOptions = {}): Promise<AuthResult> {
  const session = await openBrowserContext({
    headless: false,
    channel: options.channel,
    executablePath: options.executablePath,
    profileDir: options.profileDir,
    cdpEndpoint: options.cdpEndpoint,
    shieldPath: options.shieldPath,
    identity: options.identity,
  });
  const context = session.context;
  let page: Page | undefined;

  try {
    output.info(
      session.kind === "cdp"
        ? `Attached to ${session.description} — complete login there if prompted.`
        : `Opening LinkedIn via ${session.description} — please complete login in the browser window.`
    );

    // Inject existing cookies if provided (may let us skip login entirely).
    // Never into a --cdp browser: that session belongs to the user, and writing
    // our stored cookies into it could clobber whatever account they're using.
    if (options.existingCookieJar && session.kind !== "cdp") {
      try {
        const cookieData = options.existingCookieJar as { cookies?: PlaywrightCookie[] };
        if (cookieData.cookies && Array.isArray(cookieData.cookies)) {
          const playwrightCookies = cookieData.cookies
            .map((c) => toughCookieToPlaywright(c as unknown as Record<string, unknown>))
            .filter(Boolean) as Array<{
            name: string;
            value: string;
            domain: string;
            path: string;
            expires?: number;
            httpOnly?: boolean;
            secure?: boolean;
            sameSite?: "Strict" | "Lax" | "None";
          }>;
          if (playwrightCookies.length > 0) {
            await context.addCookies(playwrightCookies);
            output.debug(`Injected ${playwrightCookies.length} existing cookies`);
          }
        }
      } catch (err) {
        output.debug(`Failed to inject existing cookies: ${String(err)}`);
      }
    }

    // Read the actual browser identity from an owned blank page after Shield passes.
    // Navigator fields are available before any LinkedIn navigation.
    page = await context.newPage();
    const requestIdentity: NonNullable<AccountCookies["requestIdentity"]> = await page.evaluate(
      () => {
        const nav = (
          globalThis as unknown as { navigator: { userAgent: string; language: string } }
        ).navigator;
        return { userAgent: nav.userAgent, acceptLanguage: nav.language };
      }
    );
    const captureVerifiedSession = async () => {
      const rawCookies = (await context.cookies("https://www.linkedin.com")).filter((c) =>
        isLinkedInCookieDomain(c.domain)
      );
      const jar = await cookiesFromPlaywright(rawCookies);
      if (!(await isAuthenticated(jar))) {
        throw new LinkedInError("LinkedIn session cookies are missing.", "UNAUTHENTICATED");
      }
      const client = buildEmptyApiClient(options.proxy, requestIdentity);
      client.updateJar(jar);
      const profile = await getCurrentProfile(client);
      return { profile, cookieJar: serializeCookieJar(client.getJar()) };
    };

    let verified: Awaited<ReturnType<typeof captureVerifiedSession>> | undefined;
    try {
      verified = await captureVerifiedSession();
    } catch (error) {
      // Network errors and unknown identities must not trigger an unnecessary login.
      if (!(error instanceof LinkedInError) || error.code !== "UNAUTHENTICATED") throw error;
    }

    if (!verified) {
      try {
        await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      } catch {
        // A slow initial navigation can still complete within the login deadline.
      }
      output.info(
        `Waiting for you to complete login (up to ${Math.ceil(LOGIN_TIMEOUT_MS / 60000)} minutes)...`
      );
      try {
        await page.waitForURL(FEED_URL_PATTERN, {
          timeout: LOGIN_TIMEOUT_MS,
          waitUntil: "domcontentloaded",
        });
      } catch {
        throw new Error(`Login timed out after ${LOGIN_TIMEOUT_MS / 1000}s. Please try again.`);
      }
      verified = await captureVerifiedSession();
    }

    // Realtime requires the current voyager-web version. Capture it from actual
    // protected browser requests rather than inventing a version or scraping
    // the feed HTML, which can belong to a different LinkedIn frontend.
    const [runtimeRequest] = await Promise.all([
      page.waitForRequest((request) => Boolean(realtimeVersion(request)), { timeout: 30_000 }),
      page.goto(FEED_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }),
    ]);
    requestIdentity.mpVersion = realtimeVersion(runtimeRequest);
    if (!requestIdentity.mpVersion) throw new Error("Could not verify LinkedIn realtime version.");
    const afterCapture = await captureVerifiedSession();
    if (afterCapture.profile.urn !== verified.profile.urn) {
      throw new Error("LinkedIn account changed during login. No session was saved.");
    }
    verified = afterCapture;

    if (options.salesnav !== false) {
      const cookies = await context.cookies("https://www.linkedin.com");
      if (!cookies.some((cookie) => cookie.name === SALESNAV_SEAT_COOKIE && cookie.value)) {
        page ??= await context.newPage();
        await warmSalesNavSeat(page);
        const refreshed = await captureVerifiedSession();
        if (refreshed.profile.urn !== verified.profile.urn) {
          throw new Error("LinkedIn account changed during login. No session was saved.");
        }
        verified = refreshed;
      }
    }

    output.success("LinkedIn session and account verified.");
    return {
      success: true,
      profileUrn: verified.profile.urn,
      name: verified.profile.name,
      headline: verified.profile.headline,
      profileUrl: verified.profile.profileUrl,
      imageUrl: verified.profile.imageUrl,
      cookieJar: verified.cookieJar,
      requestIdentity,
    };
  } catch (error) {
    return {
      success: false,
      profileUrn: null,
      name: null,
      headline: null,
      profileUrl: null,
      imageUrl: null,
      cookieJar: {},
      error: error instanceof Error ? error.message : "LinkedIn login failed.",
    };
  } finally {
    await page?.close().catch(() => {});
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function realtimeVersion(request: Request): string | undefined {
  if (new URL(request.url()).origin !== "https://www.linkedin.com") return undefined;
  try {
    const track = JSON.parse(request.headers()["x-li-track"] ?? "{}");
    if (track.mpName === "voyager-web" && /^\d+(?:\.\d+)+$/.test(track.mpVersion ?? "")) {
      return track.mpVersion;
    }
  } catch {
    // Requests without a usable tracking header do not establish the app version.
  }
  return undefined;
}

/**
 * The cookie that carries the Sales Navigator seat. Set by the SPA only after
 * the full enterprise-auth handshake completes (i.e. once the app lands on
 * /sales/home — NOT at the intermediate /sales/contract-chooser step). Once
 * present in the saved jar, all `sales-api/*` REST calls work with no per-call
 * handshake. ~30-day expiry, refreshed on each login.
 */
const SALESNAV_SEAT_COOKIE = "li_a";

/**
 * Visit Sales Navigator so the SPA runs its enterprise-auth handshake and sets
 * the seat cookies (`li_a`, `li_ep_auth_context`) in the browser context, which
 * the caller then captures into the saved jar.
 *
 * Strictly best-effort and OPTIONAL — login never depends on SalesNav:
 *   - Accounts without a seat never get `li_a`; we time out and skip quietly.
 *   - Any navigation error is swallowed.
 * We poll the context for `li_a` (the definitive "seat is live" signal) rather
 * than racing on a URL match, because the URL hits /sales/contract-chooser
 * before `li_a` is set.
 */
async function warmSalesNavSeat(page: Page): Promise<void> {
  output.info("Checking for a Sales Navigator seat (optional)...");
  const context = page.context();
  const deadline = Date.now() + 30_000;
  try {
    await page.goto("https://www.linkedin.com/sales/?trk=d_flagship3_nav", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    while (Date.now() < deadline) {
      const cookies = await context.cookies();
      if (cookies.some((c) => c.name === SALESNAV_SEAT_COOKIE)) {
        output.success("Sales Navigator seat captured.");
        return;
      }
      // Bail fast if LinkedIn bounced us off the SalesNav app (no seat).
      const url = page.url();
      if (/\/(feed|premium|checkpoint)\b/.test(url) && !/\/sales\//.test(url)) break;
      await page.waitForTimeout(1500);
    }
    output.info(
      "No Sales Navigator seat detected — skipping (connections-of will need --salesnav off)."
    );
  } catch {
    output.debug("Sales Navigator warm-up skipped (navigation failed).");
  }
}

/** Convert a tough-cookie JSON object to Playwright's cookie format. */
function toughCookieToPlaywright(c: Record<string, unknown>): object | null {
  const domain = (c.domain as string | undefined) ?? "";
  if (!isLinkedInCookieDomain(domain)) return null;

  const expiresRaw = c.expires;
  let expires: number | undefined;
  if (expiresRaw && expiresRaw !== "Infinity") {
    expires = Math.floor(new Date(expiresRaw as string).getTime() / 1000);
  }

  const sameSiteRaw = (c.sameSite as string | undefined)?.toLowerCase();
  const sameSite =
    sameSiteRaw === "strict"
      ? "Strict"
      : sameSiteRaw === "lax"
        ? "Lax"
        : sameSiteRaw === "none" || sameSiteRaw === "no_restriction"
          ? "None"
          : undefined;

  return {
    name: (c.key as string) ?? "",
    value: (c.value as string) ?? "",
    domain: domain.startsWith(".") ? domain : `.${domain}`,
    path: (c.path as string | undefined) ?? "/",
    ...(expires !== undefined ? { expires } : {}),
    httpOnly: (c.httpOnly as boolean | undefined) ?? false,
    secure: (c.secure as boolean | undefined) ?? false,
    ...(sameSite ? { sameSite } : {}),
  };
}
