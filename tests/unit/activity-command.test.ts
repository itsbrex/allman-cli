import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
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
