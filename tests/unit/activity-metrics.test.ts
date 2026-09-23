import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ActivityRun, beginActivity, finishActivity } from "@/activity/journal.js";
import { localDay, readActivityMetrics } from "@/activity/metrics.js";
import { Store } from "@/store/index.js";
import { AccountQuota } from "@/utils/account-quota.js";
import { DAY_MS, HOUR_MS } from "@/utils/quota.js";

let root: string, account: string, activity: string;
const now = new Date(2026, 8, 22, 12).getTime();
const iso = new Date(now).toISOString();
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-activity-metrics-"));
  account = join(root, "store", "fixture");
  activity = join(root, "activity");
  await mkdir(account, { recursive: true });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(async () => {
  finishActivity("finished");
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});
async function put(path: string, data: unknown) {
  const target = join(account, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(data));
}

it("deduplicates person mirrors and unambiguous Sales Navigator bridges without guessing unmatched identities", async () => {
  await put("connections/ACoOne.json", {
    flagshipId: "ACoOne",
    memberId: "1",
    enrichedAt: iso,
    enrichDepth: "deep",
    lastSeenAt: iso,
    companyUrn: "urn:li:fsd_company:10",
  });
  await put("people/ACoOne.json", {
    flagshipId: "ACoOne",
    memberId: "1",
    lastSeenAt: iso,
    positions: [{ companyUrn: "urn:li:fsd_company:10" }, { companyUrn: "urn:li:fsd_company:20" }],
  });
  await put("connections-salesnav/1.json", {
    salesnavId: "ACwOne",
    memberId: "1",
    lastSeenAt: iso,
  });
  await put("connections-salesnav/2.json", {
    salesnavId: "ACwTwo",
    memberId: "2",
    lastSeenAt: iso,
  });
  await symlink("ACoOne.json", join(account, "connections", "alias.json"));
  await put("companies/10.json", { id: "10", fetchedAt: iso });
  await put("companies/20.json", { id: "20", fetchedAt: new Date(now - DAY_MS).toISOString() });
  const run = new ActivityRun(activity, {
    command: "connections",
    account: "fixture",
    label: "Fixture",
  });
  run.person("found", "ACwOne");
  run.person("saved", "ACwOne");
  run.person("saved", "ACoOne");
  run.person("skipped", "ACoUnprocessed");
  run.finish("finished");
  const result = readActivityMetrics(account, activity);
  expect(result.inventory).toEqual({
    people: 1,
    firstDegree: 1,
    salesnav: 2,
    unlinkedSalesnav: 1,
    deep: 1,
    companies: 2,
    referencedCompanies: 2,
  });
  expect(result.today).toMatchObject({
    people: 1,
    unlinkedSalesnav: 1,
    companies: 1,
    deep: 1,
    saves: 2,
    repeatSaves: 1,
    skipped: 1,
  });
  expect(result.coverage.unreadable).toBe(0);
});

it("keeps conflicting immutable identities separate and reports unreadable records", async () => {
  for (const id of ["ACoOne", "ACoTwo"])
    await put(`connections/${id}.json`, { flagshipId: id, memberId: "1", lastSeenAt: iso });
  await put("connections-salesnav/1.json", {
    salesnavId: "ACwOne",
    memberId: "1",
    lastSeenAt: iso,
  });
  await writeFile(join(account, "connections", "bad.json"), "{");
  const result = readActivityMetrics(account, activity);
  expect(result.today).toMatchObject({ people: 2, unlinkedSalesnav: 1 });
  expect(result.coverage).toMatchObject({ identityConflicts: 1, unreadable: 1 });
});

it("counts quota charges once across repeated runs, failures, baseline snapshots and pruned ledgers", async () => {
  const old = now - 2 * HOUR_MS;
  const run = new ActivityRun(activity, {
    command: "enrich --deep",
    account: "fixture",
    label: "Fixture",
  });
  run.baseline([old, old], []); // two distinct charges in one millisecond
  run.attempt("enrichment", now);
  run.attempt("enrichment", now);
  run.person("failed", "ACoOne");
  run.person("skipped", "ACoTwo");
  run.finish("finished");
  const second = new ActivityRun(activity, {
    command: "enrich",
    account: "fixture",
    label: "Fixture",
  });
  second.baseline([old, old, now, now], []);
  second.finish("finished");
  await put("rate-state.json", { enrichmentTimestamps: [now, now] });
  expect(readActivityMetrics(account, activity).today).toMatchObject({
    enrichmentAttempts: 4,
    people: 0,
    failed: 1,
    skipped: 1,
  });
  expect(readActivityMetrics(account, activity).quotas[0]?.used).toBe(2);
  expect(readActivityMetrics(account, activity).coverage.retainedQuotaAttempts).toBe(2);
  await put("rate-state.json", { enrichmentTimestamps: [] });
  expect(readActivityMetrics(account, activity).today.enrichmentAttempts).toBe(4);
});

it("retains events beyond the 200-row feed and counts actual HTTP dispatches and failures", () => {
  const run = new ActivityRun(activity, {
    command: "enrich --deep",
    account: "fixture",
    label: "Fixture",
  });
  for (let n = 0; n < 230; n++) {
    run.request({ id: String(n), backend: n === 0 ? "salesnav" : "flagship", outcome: "started" });
    run.request({
      id: String(n),
      backend: n === 0 ? "salesnav" : "flagship",
      outcome: "response",
      statusCode: n === 0 ? 429 : 200,
    });
  }
  run.request({ id: "network-error", backend: "flagship", outcome: "started" });
  run.request({ id: "network-error", backend: "flagship", outcome: "network-error" });
  run.finish("finished");
  expect(readActivityMetrics(account, activity).today).toMatchObject({
    requests: 231,
    salesnavRequests: 1,
    requestFailures: 2,
    rateLimited: 1,
  });
});

it("uses local midnight for today and rolling windows for seat-aware defaults and overrides", async () => {
  const { start } = localDay(now);
  const oldRun = new ActivityRun(activity, {
    command: "enrich",
    account: "fixture",
    label: "Fixture",
  });
  oldRun.baseline([start - 1, start, now - HOUR_MS, now - 1], []);
  oldRun.finish("finished");
  await put("rate-state.json", { enrichmentTimestamps: [now - HOUR_MS, now - 1] });
  await put("COOKIES.json", {
    cookieJar: { cookies: [{ key: "li_a", value: "PRIVATE-COOKIE", expires: "Infinity" }] },
  });
  let result = readActivityMetrics(account, activity);
  expect(result.today.enrichmentAttempts).toBe(3);
  expect(result.quotas[0]).toMatchObject({
    used: 1,
    max: 100,
    windowMs: HOUR_MS,
    source: "default",
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE-COOKIE");
  await put("config.json", { rateLimit: { maxEnrichments: 5, enrichmentWindowMs: HOUR_MS } });
  await put("rate-state.json", { enrichmentTimestamps: [1, 2, 3, 4].map((n) => now - n) });
  result = readActivityMetrics(account, activity);
  expect(result.quotas[0]).toMatchObject({ used: 4, max: 5, level: "warning", source: "override" });
  await put("rate-state.json", { enrichmentTimestamps: [1, 2, 3, 4, 5].map((n) => now - n) });
  expect(readActivityMetrics(account, activity).quotas[0]).toMatchObject({
    level: "blocked",
    remaining: 0,
    nextFreeAt: now - 5 + HOUR_MS,
  });
  await put("config.json", {});
  await put("COOKIES.json", {
    cookieJar: { cookies: [{ key: "li_a", expires: new Date(now - 1).toISOString() }] },
  });
  expect(readActivityMetrics(account, activity).quotas[0]).toMatchObject({
    max: 25,
    windowMs: DAY_MS,
  });
  expect(readActivityMetrics(account, activity, localDay(now).end).today.enrichmentAttempts).toBe(
    0
  );
});

it("observes real persisted quota consumption, including exhausted and restarted accounts", async () => {
  beginActivity(activity, { command: "enrich", account: "fixture", label: "Fixture" });
  const store = new Store({ path: join(root, "store") });
  const config = { rateLimit: { maxEnrichments: 1, minMessageIntervalMs: 60000 } };
  const quota = await AccountQuota.load(store, "fixture", "enrichment", config, false);
  expect(await quota.tryConsume()).toBe(true);
  expect(await quota.tryConsume()).toBe(false);
  const reloaded = await AccountQuota.load(store, "fixture", "enrichment", config, false);
  expect(await reloaded.tryConsume()).toBe(false);
  finishActivity("finished");
  const result = readActivityMetrics(account, activity);
  expect(result.today.enrichmentAttempts).toBe(1);
  const file = (await readdir(activity)).find((name) => name.endsWith(".jsonl"));
  if (!file) throw new Error("Missing activity journal");
  const journal = await readFile(join(activity, file), "utf8");
  expect(journal.match(/"status":"attempt"/g)).toHaveLength(1);
});

it("does not present a full allowance when the quota ledger is unreadable", async () => {
  await writeFile(join(account, "rate-state.json"), "{broken");
  const result = readActivityMetrics(account, activity);
  expect(result.quotas).toEqual([]);
  expect(result.coverage.unreadable).toBe(1);
});
