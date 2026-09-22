import { Readable } from "node:stream";
import axios, { type AxiosRequestConfig } from "axios";
import { afterEach, expect, it, vi } from "vitest";
import { buildEmptyApiClient } from "@/linkedin/api/client.js";
import { SseClient } from "@/linkedin/realtime/sse-client.js";
import * as output from "@/utils/output.js";

vi.mock("axios", () => ({ default: Object.assign(vi.fn(), { post: vi.fn() }) }));
vi.mock("@/utils/output.js", () => ({ debug: vi.fn(), warn: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("uses the captured browser identity for both realtime and its heartbeat", async () => {
  vi.useFakeTimers();
  const api = buildEmptyApiClient(undefined, {
    userAgent: "FixtureBrowser/151 macOS",
    acceptLanguage: "en-US",
  });
  const data = Readable.from([
    'data: {"com.linkedin.realtimefrontend.ClientConnection":{"id":"fixture"}}\n',
  ]);
  vi.mocked(axios).mockResolvedValue({ status: 200, data });
  vi.mocked(axios.post).mockResolvedValue({ status: 200 });
  const client = new SseClient(api, "ACoOwner", { mpVersion: "1.13.46745" });
  const events = client.connect();
  try {
    expect((await events.next()).value).toMatchObject({
      type: "connected",
      connectionId: "fixture",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const streamRequest = vi.mocked(axios).mock.calls[0]?.[0] as unknown as AxiosRequestConfig;
    const streamHeaders = streamRequest.headers;
    const heartbeatHeaders = vi.mocked(axios.post).mock.calls[0]?.[2]?.headers;
    expect(vi.mocked(axios.post).mock.calls[0]?.[2]).toMatchObject({
      params: { action: "sendHeartbeat" },
      headers: { accept: "application/json" },
    });
    expect(vi.mocked(axios.post).mock.calls[0]?.[1]).toMatchObject({ mpVersion: "1.13.46745" });
    expect(vi.mocked(axios.post).mock.calls[0]?.[1]).not.toHaveProperty("action");
    for (const headers of [streamHeaders, heartbeatHeaders]) {
      expect(headers).toMatchObject({
        "user-agent": "FixtureBrowser/151 macOS",
        "accept-language": "en-US",
      });
      // LinkedIn requires the app identifier for realtime, but not invented device metadata.
      expect(JSON.parse(String(headers?.["x-li-track"]))).toEqual({ mpName: "voyager-web" });
    }
  } finally {
    client.abort();
    await events.return(undefined);
    data.destroy();
  }
});

it.each([
  400, 401, 302, 403, 429,
])("reports HTTP %s instead of silently treating it as an open stream", async (status) => {
  const data = Readable.from(["fixture failure"]);
  const destroy = vi.spyOn(data, "destroy");
  vi.mocked(axios).mockResolvedValue({ status, data });
  const client = new SseClient(buildEmptyApiClient(), "ACoOwner", {
    maxReconnectAttempts: 1,
    mpVersion: "1.13.46745",
  });
  const events = client.connect();
  try {
    const event = (await events.next()).value;
    expect(event).toMatchObject({
      type: "raw",
      raw: { error: expect.stringContaining(`HTTP ${status}`) },
    });
    expect(output.warn).toHaveBeenCalledWith(expect.stringContaining(`HTTP ${status}`));
    expect(destroy).toHaveBeenCalled();
  } finally {
    await events.return(undefined);
    data.destroy();
  }
});

it("requires a captured application version instead of inventing one", async () => {
  const client = new SseClient(buildEmptyApiClient(), "ACoOwner");
  await expect(client.connect().next()).rejects.toThrow(/allman login/);
  expect(axios).not.toHaveBeenCalled();
});
