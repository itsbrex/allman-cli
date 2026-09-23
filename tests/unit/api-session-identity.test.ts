import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import axios, { type AxiosRequestConfig } from "axios";
import { afterEach, expect, it, vi } from "vitest";
import { beginActivity, finishActivity } from "@/activity/journal.js";
import { readActivityMetrics } from "@/activity/metrics.js";
import { loadSession } from "@/linkedin/api/session.js";
import { Store } from "@/store/index.js";

vi.mock("axios", () => ({ default: vi.fn() }));
let root: string;
afterEach(async () => {
  finishActivity("finished");
  if (root) await rm(root, { recursive: true, force: true });
  vi.clearAllMocks();
});

it("keeps the browser identity private and uses it after cookie updates and session reload", async () => {
  root = await mkdtemp(join(tmpdir(), "allman-request-identity-"));
  const store = new Store({ path: root });
  await store.init();
  const requestIdentity = { userAgent: "FixtureBrowser/151 macOS", acceptLanguage: "en-US" };
  await store.accounts.write("ACoOwner", {
    urn: "urn:li:fsd_profile:ACoOwner",
    profileSlug: "owner",
    name: "Owner",
    headline: null,
    profileUrl: null,
    imageUrl: null,
    userType: null,
    networkSize: null,
    status: "authenticated",
    cookieJar: null,
    cookiesUpdatedAt: null,
    lastSyncAt: null,
    requestIdentity,
  });
  const auth = JSON.parse(await readFile(join(root, "ACoOwner", "AUTH.json"), "utf8"));
  expect(auth).not.toHaveProperty("requestIdentity");
  expect(await store.accounts.readCookies("ACoOwner")).toMatchObject({ requestIdentity });

  const activity = join(root, "activity");
  beginActivity(activity, { command: "sync", account: "ACoOwner", label: "Fixture" });

  vi.mocked(axios).mockResolvedValue({
    status: 200,
    headers: { "set-cookie": ["bcookie=fixture; Path=/; Domain=.linkedin.com"] },
    data: {},
  });
  const first = await loadSession(store, "ACoOwner");
  await first.apiClient.request({ method: "GET", url: "https://www.linkedin.com/voyager/api/me" });
  const second = await loadSession(store, "ACoOwner");
  await second.apiClient.request({ method: "GET", url: "https://www.linkedin.com/voyager/api/me" });
  const request = vi.mocked(axios).mock.calls.at(-1)?.[0] as unknown as AxiosRequestConfig;
  const headers = request.headers;
  expect(headers).toMatchObject({
    "user-agent": "FixtureBrowser/151 macOS",
    "accept-language": "en-US",
  });
  for (const fabricated of [
    "sec-ch-ua",
    "sec-ch-ua-platform",
    "x-li-track",
    "x-li-page-instance",
    "x-li-recipe-map",
  ])
    expect(headers).not.toHaveProperty(fabricated);
  expect(await store.accounts.readCookies("ACoOwner")).toMatchObject({ requestIdentity });
  vi.mocked(axios).mockRejectedValueOnce(new Error("private transport detail"));
  await expect(
    second.apiClient.request({ method: "GET", url: "https://www.linkedin.com/voyager/api/me" })
  ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  vi.mocked(axios).mockResolvedValueOnce({
    status: 429,
    headers: {},
    data: { private: "response body" },
  });
  await expect(
    second.apiClient.request({ method: "GET", url: "https://www.linkedin.com/sales-api/fixture" })
  ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  finishActivity("finished");
  expect(readActivityMetrics(join(root, "ACoOwner"), activity).today).toMatchObject({
    requests: 4,
    salesnavRequests: 1,
    requestFailures: 2,
    rateLimited: 1,
  });
});
