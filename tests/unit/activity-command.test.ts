import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configureDashboard } from "@/activity/config.js";
import { finishActivity, readActivitySnapshot } from "@/activity/journal.js";
import { readActivityMetrics } from "@/activity/metrics.js";
import { startActivityServer } from "@/activity/server.js";
import { activityContext, beginCommandActivity } from "@/commands/activity.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => Object.assign(new EventEmitter(), { unref: vi.fn() })),
}));
vi.mock("@/activity/server.js", () => ({
  startActivityServer: vi.fn(async () => ({ url: "http://127.0.0.1:8767/", close: vi.fn() })),
}));
let root: string, store: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-activity-command-"));
  store = join(root, "store");
  vi.stubEnv("XDG_CONFIG_HOME", join(root, "config"));
  vi.stubEnv("ALLMAN_PROFILE", "");
  vi.stubEnv("ALLMAN_DASHBOARD_AUTO_OPEN", "");
  vi.stubEnv("ALLMAN_DASHBOARD_URL", "");
  vi.stubEnv("ALLMAN_RELATIONSHIP_STORE", join(root, "private"));
  await mkdir(join(store, "ACoFixture"), { recursive: true });
  await writeFile(
    join(store, "ACoFixture", "AUTH.json"),
    JSON.stringify({ name: "Fixture", profileSlug: "fixture" })
  );
  await writeFile(
    join(store, "ACoFixture", "rate-state.json"),
    JSON.stringify({ enrichmentTimestamps: [Date.now()] })
  );
});
afterEach(async () => {
  finishActivity("finished");
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("uses saved auto-open preference, environment overrides, and explicit flags", async () => {
  const options = { store, account: "ACoFixture" };
  await configureDashboard({ autoOpen: false });
  expect(await beginCommandActivity("start", options)).toBeUndefined();
  vi.stubEnv("ALLMAN_DASHBOARD_AUTO_OPEN", "true");
  expect(await beginCommandActivity("start", options)).toBeDefined();
  expect(await beginCommandActivity("start", { ...options, dashboard: false })).toBeUndefined();
  vi.stubEnv("ALLMAN_DASHBOARD_AUTO_OPEN", "false");
  expect(await beginCommandActivity("start", { ...options, dashboard: true })).toBeDefined();
  expect(await beginCommandActivity("enrich", options)).toBeUndefined();
  expect(startActivityServer).toHaveBeenCalledTimes(2);
});

it("reuses the preferred viewer only after checking the current account identity", async () => {
  const options = { store, account: "ACoFixture" };
  const context = await activityContext(options);
  const url = "https://allman-activity.localhost/apps/activity.html";
  await configureDashboard({ url });
  const fetcher = vi.fn(async (_input: string | URL | Request) =>
    Response.json({
      app: "allman-activity-v1",
      key: createHash("sha256").update(context.root).digest("hex"),
    })
  );
  vi.stubGlobal("fetch", fetcher);
  const server = await beginCommandActivity("start", options);
  expect(server).toMatchObject({ url, reused: true });
  await server?.close();
  expect(startActivityServer).not.toHaveBeenCalled();
  expect(spawn).toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining([url]),
    expect.any(Object)
  );
  expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://allman-activity.localhost/api/identity");
});

it.each([
  "wrong-account",
  "offline",
  "http-error",
])("falls back when preferred viewer is %s", async (reason) => {
  await configureDashboard({ url: "https://allman-activity.localhost/apps/activity.html" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (reason === "offline") throw new Error("offline");
      return Response.json(
        { app: "allman-activity-v1", key: "wrong" },
        { status: reason === "http-error" ? 500 : 200 }
      );
    })
  );
  const server = await beginCommandActivity("start", { store, account: "ACoFixture" });
  expect(server?.url).toBe("http://127.0.0.1:8767/");
  expect(startActivityServer).toHaveBeenCalledOnce();
});

it("does not probe or open a preferred viewer when disabled, and honors explicit ports", async () => {
  await configureDashboard({
    autoOpen: false,
    url: "https://allman-activity.localhost/apps/activity.html",
  });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const options = { store, account: "ACoFixture" };
  expect(await beginCommandActivity("start", options)).toBeUndefined();
  expect(spawn).not.toHaveBeenCalled();
  await beginCommandActivity("start", { ...options, dashboard: true, dashboardPort: 9000 });
  expect(fetcher).not.toHaveBeenCalled();
  expect(startActivityServer).toHaveBeenCalledWith(expect.objectContaining({ port: 9000 }));
});

it("falls back without weakening TLS when a configured local CA is unavailable", async () => {
  await configureDashboard({
    url: "https://allman-activity.localhost/apps/activity.html",
    caFile: join(root, "missing-ca.pem"),
  });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await beginCommandActivity("start", { store, account: "ACoFixture" });
  expect(fetcher).not.toHaveBeenCalled();
  expect(startActivityServer).toHaveBeenCalledOnce();
});
it("opens the observer with start and preserves retained quota history before any pruning", async () => {
  const options = { store, account: "ACoFixture" };
  const server = await beginCommandActivity("start", options);
  expect(server?.url).toBe("http://127.0.0.1:8767/");
  expect(startActivityServer).toHaveBeenCalledOnce();
  expect(spawn).toHaveBeenCalledOnce();
  finishActivity("finished");
  await writeFile(join(store, "ACoFixture", "rate-state.json"), "{}");
  const context = await activityContext(options);
  expect(readActivityMetrics(context.accountDir, context.root).today.enrichmentAttempts).toBe(1);
});
it("honors start --no-dashboard and records other commands without opening a browser", async () => {
  const options = { store, account: "ACoFixture", dashboard: false };
  expect(await beginCommandActivity("start", options)).toBeUndefined();
  finishActivity("finished");
  expect(
    await beginCommandActivity("enrich", { ...options, deep: true, limit: 5 })
  ).toBeUndefined();
  const context = await activityContext(options);
  finishActivity("finished");
  expect(readActivitySnapshot(context.root).runs.map((run) => run.command)).toContain(
    "enrich --deep --limit 5"
  );
  expect(startActivityServer).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
});
