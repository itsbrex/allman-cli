/**
 * LinkedIn Voyager API client.
 *
 * Handles:
 *   - Constructing the full set of LinkedIn-required headers
 *   - Cookie injection and post-response cookie merging
 *   - HTTP proxy support via tunnel
 *   - 401/403/429 error detection
 *   - Persisting updated cookies back to the store after each response
 *
 * Reference:
 *   monorepo/lib/services/.../linkedin-api-services.ts
 *   allman/api/src/services/api/linkedin-api-client.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import type { CookieJar } from "tough-cookie";
import type tunnel from "tunnel";
import { activityRequestFinished, activityRequestStarted } from "../../activity/journal.js";
import { archiveRaw } from "../../store/raw-archive.js";
import type { AccountRecord, ProxyConfig } from "../../store/types.js";
import * as output from "../../utils/output.js";
import type { RateLimiter } from "../../utils/rate-limiter.js";
import {
  buildCookieHeader,
  getCsrfToken,
  loadCookieJar,
  mergeCookies,
  newCookieJar,
} from "./cookies.js";

// ---------------------------------------------------------------------------
// VCR recording (enabled when ALLMAN_VCR=record)
// ---------------------------------------------------------------------------

const IS_RECORD_MODE = process.env.ALLMAN_VCR === "record";
const VCR_DIR = process.env.ALLMAN_VCR_DIR ?? join(process.cwd(), "tests", "fixtures");

function vcrKey(method: string, url: string, params?: Record<string, string>): string {
  const urlObj = new URL(url.startsWith("http") ? url : `https://www.linkedin.com${url}`);
  const pathSlug = urlObj.pathname
    .replace(/^\//, "")
    .replace(/\//g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  const queryId = params?.queryId ?? urlObj.searchParams.get("queryId");
  const querySlug = queryId ? `_${queryId.replace(/\./g, "_").replace(/[^a-zA-Z0-9_]/g, "")}` : "";
  return `${method.toUpperCase()}_${pathSlug}${querySlug}`;
}

async function recordFixture(
  method: string,
  url: string,
  params: Record<string, string> | undefined,
  response: AxiosResponse
): Promise<void> {
  const key = vcrKey(method, url, params);
  const fixture = {
    request: { method: method.toUpperCase(), url, params },
    response: {
      status: response.status,
      headers: Object.fromEntries(
        Object.entries(response.headers as Record<string, unknown>).filter(
          ([k]) => !["set-cookie", "cookie"].includes(k.toLowerCase())
        )
      ),
      data: response.data,
    },
  };
  await mkdir(VCR_DIR, { recursive: true });
  await archiveRaw(VCR_DIR, "vcr", "linkedin/vcr", fixture);
  const path = join(VCR_DIR, `${key}.json`);
  await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
  output.debug(`[VCR] Saved fixture: ${key}.json`);
}

// ---------------------------------------------------------------------------
// LinkedIn standard headers
// Pulled from: https://github.com/beeper/linkedin (originally)
// Verified against: monorepo/lib/services/.../linkedin-api-services.ts
// ---------------------------------------------------------------------------

// Keep API requirements only; browser identity comes from the protected login.
// Never invent client hints, tracking metadata, or browser/version claims.
const API_HEADERS = {
  "x-restli-protocol-version": "2.0.0",
  referer: "https://www.linkedin.com/feed/",
  accept: "application/vnd.linkedin.normalized+json+2.1",
};

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class LinkedInError extends Error {
  constructor(
    message: string,
    public readonly code: LinkedInErrorCode,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "LinkedInError";
  }
}

export type LinkedInErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "NOT_CONNECTED"
  | "MESSAGING_BLOCKED"
  | "PREMIUM_REQUIRED"
  | "SERVER_ERROR"
  | "NETWORK_ERROR"
  | "UNKNOWN";

// ---------------------------------------------------------------------------
// Cookie persistence callback
// ---------------------------------------------------------------------------

export type CookiePersistFn = (updatedJar: CookieJar) => Promise<void>;
export type RateStatePersistFn = (lastMessageSentAt: number) => Promise<void>;

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

export interface ApiClientOptions {
  /** Account record for cookie loading. */
  account: AccountRecord;
  /** Called after every response to persist updated cookies. */
  onCookieUpdate?: CookiePersistFn;
  /** Rate limiter enforced before every outbound message send. */
  rateLimiter?: RateLimiter;
  /** Called after acquiring a send slot to persist the timestamp. */
  onRateStateUpdate?: RateStatePersistFn;
  /** Proxy configuration (from account config). */
  proxy?: ProxyConfig;
  requestIdentity?: AccountRecord["requestIdentity"];
}

export interface ApiRequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  url: string;
  params?: Record<string, string>;
  data?: unknown;
  /** Additional headers merged over the defaults. */
  headers?: Record<string, string>;
  /** For SSE stream responses. */
  responseType?: "json" | "stream";
  /** Timeout in ms. 0 = no timeout. */
  timeout?: number;
}

const MESSAGES_ENDPOINT = "/voyagerMessagingDashMessengerMessages";

export class LinkedInApiClient {
  private jar: CookieJar;
  private rawArchive?: { root: string; account: string };
  setRawArchive(root: string, account: string): void {
    this.rawArchive = { root, account };
  }
  private readonly onCookieUpdate?: CookiePersistFn;
  private readonly rateLimiter?: RateLimiter;
  private readonly onRateStateUpdate?: RateStatePersistFn;
  private readonly proxy?: ProxyConfig;
  private readonly requestIdentity?: AccountRecord["requestIdentity"];

  constructor(options: ApiClientOptions) {
    this.jar = loadCookieJar(options.account);
    this.onCookieUpdate = options.onCookieUpdate;
    this.rateLimiter = options.rateLimiter;
    this.onRateStateUpdate = options.onRateStateUpdate;
    this.proxy = options.proxy;
    this.requestIdentity = options.requestIdentity ?? options.account.requestIdentity;
  }

  /** Replace the internal cookie jar (e.g. after login). */
  updateJar(jar: CookieJar): void {
    this.jar = jar;
  }

  /** Return a copy of the current cookie jar (for inspection). */
  getJar(): CookieJar {
    return this.jar;
  }

  /** Shared by REST, realtime streams, and heartbeat requests. */
  async getRequestHeaders(additional?: Record<string, string>): Promise<Record<string, string>> {
    return {
      ...API_HEADERS,
      ...(this.requestIdentity
        ? {
            "user-agent": this.requestIdentity.userAgent,
            "accept-language": this.requestIdentity.acceptLanguage,
          }
        : {}),
      cookie: await buildCookieHeader(this.jar),
      "csrf-token": (await getCsrfToken(this.jar)) ?? "",
      ...additional,
    };
  }

  async request<T = unknown>(options: ApiRequestOptions): Promise<T> {
    // Enforce rate limit on outbound message sends
    if (options.method === "POST" && options.url.includes(MESSAGES_ENDPOINT) && this.rateLimiter) {
      await this.rateLimiter.acquire();
      if (this.onRateStateUpdate) {
        await this.onRateStateUpdate(Date.now());
      }
    }

    const headers = await this.getRequestHeaders(options.headers);

    const axiosConfig: AxiosRequestConfig = {
      method: options.method,
      url: options.url,
      headers,
      params: options.params,
      data: options.data,
      responseType: options.responseType ?? "json",
      timeout: options.timeout ?? 30_000,
      // Prevent axios from following redirects automatically (detect LinkedIn's
      // login redirect when cookies expire)
      maxRedirects: 0,
      validateStatus: (status) => status < 400,
    };

    if (this.proxy) {
      const tunnelLib = (await import("tunnel")).default;
      axiosConfig.httpsAgent = tunnelLib.httpsOverHttp({
        proxy: {
          host: this.proxy.host,
          port: this.proxy.port,
          ...(this.proxy.username && this.proxy.password
            ? { proxyAuth: `${this.proxy.username}:${this.proxy.password}` }
            : {}),
        },
        rejectUnauthorized: false,
      } as tunnel.HttpsOverHttpOptions);
    }

    let response: AxiosResponse;
    const activityRequest =
      options.method === "GET"
        ? activityRequestStarted(options.url.includes("/sales-api/") ? "salesnav" : "flagship")
        : undefined;
    try {
      response = await axios(axiosConfig);
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: AxiosResponse;
        code?: string;
        message?: string;
      };
      if (axiosErr.response) {
        response = axiosErr.response;
      } else {
        activityRequestFinished(activityRequest);
        throw new LinkedInError(`Network error: ${axiosErr.message ?? "unknown"}`, "NETWORK_ERROR");
      }
    }
    activityRequestFinished(activityRequest, response.status);

    // Handle error status codes — includes 3xx redirects (LinkedIn 302s on session
    // expiry must throw, not silently return empty JSON).
    if (response.status >= 300 && response.status !== 304) {
      this.handleErrorResponse(response);
    }

    if (this.rawArchive && options.responseType !== "stream") {
      // No cookies, headers or request body enter the archive. Keep query variables
      // with the response so pages and target identities can be distinguished.
      try {
        await archiveRaw(this.rawArchive.root, this.rawArchive.account, "linkedin/api", {
          method: options.method,
          url: options.url,
          params: options.params,
          status: response.status,
          data: response.data,
        });
      } catch {
        output.warn(
          "Raw response could not be archived. Do not repeat a send or invitation; inspect local storage."
        );
      }
    }

    // Merge Set-Cookie headers into jar and persist
    const setCookieHeaders = this.extractSetCookieHeaders(response);
    if (setCookieHeaders.length > 0) {
      await mergeCookies(this.jar, setCookieHeaders);
      if (this.onCookieUpdate) {
        await this.onCookieUpdate(this.jar);
      }
    }

    output.debug(`${options.method} ${options.url} → ${response.status}`);

    // Save fixture for VCR replay in tests
    if (IS_RECORD_MODE) {
      try {
        await recordFixture(options.method, options.url, options.params, response);
      } catch {
        output.warn("VCR recording failed; do not repeat a provider write to recover its output.");
      }
    }

    return response.data as T;
  }

  private handleErrorResponse(response: AxiosResponse): never {
    const status = response.status;

    if (status === 401 || status === 302) {
      throw new LinkedInError(
        `LinkedIn rejected the session (HTTP ${status}). Run \`allman login\` to re-authenticate.`,
        "UNAUTHENTICATED",
        status
      );
    }

    if (status === 403) {
      // Check if it's a messaging restriction
      const body = JSON.stringify(response.data ?? "");
      if (body.includes("NOT_CONNECTED")) {
        throw new LinkedInError(
          "You are not connected with this person on LinkedIn.",
          "NOT_CONNECTED",
          403
        );
      }
      if (body.includes("MESSAGING_BLOCKED")) {
        throw new LinkedInError(
          "This person has restricted who can message them.",
          "MESSAGING_BLOCKED",
          403
        );
      }
      if (body.includes("PREMIUM") || body.includes("INMAIL")) {
        throw new LinkedInError(
          "Sending to this person requires LinkedIn Premium (InMail).",
          "PREMIUM_REQUIRED",
          403
        );
      }
      throw new LinkedInError("Access forbidden (403).", "FORBIDDEN", 403);
    }

    if (status === 429) {
      throw new LinkedInError(
        "LinkedIn rate limit hit. Wait 60s before retrying.",
        "RATE_LIMITED",
        429
      );
    }

    throw new LinkedInError(`LinkedIn API error: HTTP ${status}`, "UNKNOWN", status);
  }

  private extractSetCookieHeaders(response: AxiosResponse): string[] {
    const raw = response.headers["set-cookie"];
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    return [raw];
  }
}

/**
 * Build an API client for an account, with automatic cookie persistence.
 * The `persistCookies` callback is called whenever cookies are updated.
 */
export function buildApiClient(
  account: AccountRecord,
  persistCookies: CookiePersistFn,
  proxy?: ProxyConfig,
  rateLimiter?: RateLimiter,
  persistRateState?: RateStatePersistFn
): LinkedInApiClient {
  return new LinkedInApiClient({
    account,
    onCookieUpdate: persistCookies,
    proxy,
    rateLimiter,
    onRateStateUpdate: persistRateState,
  });
}

/** Build an empty API client; login supplies its captured jar before verification. */
export function buildEmptyApiClient(
  proxy?: ProxyConfig,
  requestIdentity?: AccountRecord["requestIdentity"]
): LinkedInApiClient {
  return new LinkedInApiClient({
    proxy,
    requestIdentity,
    account: {
      urn: null,
      profileSlug: null,
      name: null,
      headline: null,
      profileUrl: null,
      imageUrl: null,
      userType: null,
      networkSize: null,
      status: "unauthenticated",
      cookieJar: null,
      cookiesUpdatedAt: null,
      lastSyncAt: null,
    },
  });
}

export { newCookieJar };
