import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import axios, { type AxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCookieHeader, loadCookieJar } from "@/linkedin/api/cookies.js";
import { runLogin } from "@/linkedin/auth/playwright-auth.js";

const mocks = vi.hoisted(() => ({ launch: vi.fn(), attach: vi.fn(), verify: vi.fn() }));
vi.mock("playwright", () => ({
  chromium: { launchPersistentContext: mocks.launch, connectOverCDP: mocks.attach },
}));
vi.mock("@/linkedin/auth/shield.js", () => ({
  readShieldPackage: async () => ({ path: "/shield", version: "3.4.0" }),
  verifyShield: mocks.verify,
}));
vi.mock("@/linkedin/auth/cdp.js", () => ({
  createScopedCdp: async () => ({ endpoint: "ws://127.0.0.1:1234", close: vi.fn() }),
}));
vi.mock("@/utils/output.js", () => ({ info: vi.fn(), debug: vi.fn(), success: vi.fn() }));
vi.mock("axios", () => ({ default: vi.fn() }));

const ownerResponse = {
  status: 200,
  headers: {},
  data: {
    data: { "*miniProfile": "urn:li:fs_miniProfile:ACoOwner" },
    included: [
      {
        entityUrn: "urn:li:fs_miniProfile:ACoOwner",
        firstName: "Account",
        lastName: "Owner",
        publicIdentifier: "owner",
      },
    ],
  },
};

let root: string;
const saved = {
  cookies: [
    { key: "li_at", value: "fixture-session", domain: ".linkedin.com" },
    { key: "unrelated", value: "private-fixture", domain: ".linkedin.com.example.test" },
  ],
};
const protection = { id: "shield", version: "3.4.0", rulesets: ["linkedin_blocklist"] };
function browserContext() {
  let response: ((value: unknown) => Promise<void>) | undefined;
  const page = {
    context: () => context,
    on: vi.fn((_event, callback) => {
      response = callback;
    }),
    goto: vi.fn(async () => {
      await response?.({
        url: () => "https://www.linkedin.com/voyagerIdentityDashProfiles",
        request: () => ({ method: () => "GET" }),
        status: () => 200,
        json: async () => ({ entityUrn: "urn:li:fsd_profile:ACoFixture" }),
      });
    }),
    waitForURL: vi.fn().mockResolvedValue(undefined),
    waitForRequest: vi.fn().mockResolvedValue({
      url: () => "https://www.linkedin.com/voyager/api/voyagerGlobalAlerts",
      headers: () => ({ "x-li-track": '{"mpName":"voyager-web","mpVersion":"1.13.46745"}' }),
    }),
    evaluate: vi
      .fn()
      .mockResolvedValue({ userAgent: "FixtureBrowser/151 macOS", acceptLanguage: "en-US" }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const context = {
    addCookies: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
    cookies: vi.fn().mockResolvedValue([
      { name: "JSESSIONID", value: '"fixture"', domain: ".linkedin.com", path: "/", expires: -1 },
      {
        name: "li_at",
        value: "fixture-session",
        domain: ".www.linkedin.com",
        path: "/",
        expires: -1,
      },
      { name: "li_a", value: "fixture-seat", domain: ".www.linkedin.com", path: "/", expires: -1 },
      {
        name: "unrelated",
        value: "private-fixture",
        domain: ".linkedin.com.example.test",
        path: "/",
        expires: -1,
      },
    ]),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { page, context };
}
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), "allman-login-shield-"));
  vi.stubEnv("ALLMAN_BROWSER_WORKSPACE", root);
  for (const key of [
    "ALLMAN_BROWSER",
    "ALLMAN_CDP_URL",
    "ALLMAN_BROWSER_PROFILE",
    "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
    "ALLMAN_SHIELD_PATH",
  ])
    vi.stubEnv(key, "");
  mocks.verify.mockResolvedValue(protection);
  vi.mocked(axios).mockReset().mockResolvedValue(ownerResponse);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("login protection ordering", () => {
  it("waits for live Shield verification before injecting cookies or creating a LinkedIn page", async () => {
    const { context, page } = browserContext();
    mocks.launch.mockResolvedValue(context);
    vi.mocked(axios).mockResolvedValueOnce({ status: 401, headers: {}, data: {} });
    let approve!: (value: typeof protection) => void;
    mocks.verify.mockReturnValue(
      new Promise((resolve) => {
        approve = resolve;
      })
    );
    const pending = runLogin({ channel: "chromium", existingCookieJar: saved, salesnav: false });
    await vi.waitFor(() => expect(mocks.verify).toHaveBeenCalledOnce());
    expect(context.addCookies).not.toHaveBeenCalled();
    expect(context.newPage).not.toHaveBeenCalled();
    expect(context.cookies).not.toHaveBeenCalled();
    approve(protection);
    const result = await pending;
    expect(result.success).toBe(true);
    expect(context.addCookies.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ name: "li_at", domain: ".linkedin.com" }),
    ]);
    expect(page.goto).toHaveBeenCalledWith("https://www.linkedin.com/login", expect.any(Object));
    expect(JSON.stringify(result.cookieJar)).not.toContain("private-fixture");
    expect(context.close).toHaveBeenCalledOnce();
  });
  it("stops before cookie access or LinkedIn navigation when Shield verification fails", async () => {
    const { context } = browserContext();
    mocks.launch.mockResolvedValue(context);
    mocks.verify.mockRejectedValueOnce(new Error("Shield disabled"));
    await expect(
      runLogin({ channel: "chromium", existingCookieJar: saved, salesnav: false })
    ).rejects.toThrow("Shield disabled");
    expect(context.addCookies).not.toHaveBeenCalled();
    expect(context.cookies).not.toHaveBeenCalled();
    expect(context.newPage).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
  });
  it("never injects stored cookies into an attached browser", async () => {
    const { context } = browserContext();
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.attach.mockResolvedValue({ contexts: () => [context], close });
    expect(
      (await runLogin({ cdpEndpoint: "9222", existingCookieJar: saved, salesnav: false })).success
    ).toBe(true);
    expect(mocks.verify).toHaveBeenCalledOnce();
    expect(context.addCookies).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("verified browser session export", () => {
  it("reuses the signed-in browser without visiting login or guessing identity from page traffic", async () => {
    const { context, page } = browserContext();
    mocks.launch.mockResolvedValue(context);
    const result = await runLogin({ channel: "chromium" });
    expect(result).toMatchObject({
      success: true,
      profileUrn: "urn:li:fsd_profile:ACoOwner",
      profileUrl: "https://www.linkedin.com/in/owner",
      name: "Account Owner",
    });
    expect(page.goto).not.toHaveBeenCalledWith("https://www.linkedin.com/login", expect.anything());
    expect(result).toMatchObject({
      requestIdentity: {
        userAgent: "FixtureBrowser/151 macOS",
        acceptLanguage: "en-US",
        mpVersion: "1.13.46745",
      },
    });
    const request = vi.mocked(axios).mock.calls.at(-1)?.[0] as unknown as AxiosRequestConfig;
    expect(request.headers).toMatchObject({
      "user-agent": "FixtureBrowser/151 macOS",
    });
  });

  it("does not save a session when the required realtime version cannot be verified", async () => {
    const { context, page } = browserContext();
    mocks.launch.mockResolvedValue(context);
    page.waitForRequest.mockRejectedValue(new Error("Realtime version unavailable"));
    const result = await runLogin({ channel: "chromium", salesnav: false });
    expect(result.success).toBe(false);
    expect(result.cookieJar).toEqual({});
  });

  it("does not report success when the captured session is rejected by LinkedIn", async () => {
    const { context } = browserContext();
    mocks.launch.mockResolvedValue(context);
    vi.mocked(axios).mockResolvedValue({ status: 401, headers: {}, data: {} });
    const result = await runLogin({ channel: "chromium", salesnav: false });
    expect(result.success).toBe(false);
    expect(result.cookieJar).toEqual({});
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("exports cookie rotations received during the successful account verification", async () => {
    const { context } = browserContext();
    mocks.launch.mockResolvedValue(context);
    vi.mocked(axios).mockResolvedValue({
      ...ownerResponse,
      headers: {
        "set-cookie": [
          "li_at=verified-session; Path=/; Domain=.www.linkedin.com; Secure; HttpOnly",
        ],
      },
    });
    const result = await runLogin({ channel: "chromium", salesnav: false });
    const jar = loadCookieJar({ cookieJar: result.cookieJar } as Parameters<
      typeof loadCookieJar
    >[0]);
    expect(await buildCookieHeader(jar)).toContain("li_at=verified-session");
  });

  it("rejects missing account identity even when cookies and the post-login URL exist", async () => {
    const { context } = browserContext();
    mocks.launch.mockResolvedValue(context);
    vi.mocked(axios).mockResolvedValue({ status: 200, headers: {}, data: {} });
    const result = await runLogin({ channel: "chromium", salesnav: false });
    expect(result.success).toBe(false);
    expect(result.cookieJar).toEqual({});
  });
});
