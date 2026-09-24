import { beforeEach, expect, it, vi } from "vitest";
import type { EnrichmentPlan } from "../../src/attio/target-matches.js";
import type { Store } from "../../src/store/index.js";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  assert: vi.fn(),
  session: vi.fn(),
  enrich: vi.fn(),
  activity: vi.fn(),
  exports: vi.fn(),
  quota: vi.fn(),
  pace: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../../src/linkedin/session-control.js", () => ({
  beginLinkedInCommand: mocks.begin,
  assertActiveProfile: mocks.assert,
}));
vi.mock("../../src/linkedin/api/session.js", () => ({ loadSession: mocks.session }));
vi.mock("../../src/linkedin/api/endpoints/profile-detail.js", () => ({
  parseProfileCore: (x: unknown) => x,
}));
vi.mock("../../src/commands/enrich.js", () => ({ enrichConnections: mocks.enrich }));
vi.mock("../../src/commands/connections-of.js", () => ({ hasSalesNavSeat: () => false }));
vi.mock("../../src/commands/activity.js", () => ({ beginCommandActivity: mocks.activity }));
vi.mock("../../src/exports/automatic.js", () => ({ beginAutomaticExports: mocks.exports }));
vi.mock("../../src/utils/account-quota.js", () => ({ AccountQuota: { load: mocks.quota } }));
vi.mock("../../src/utils/random-delay.js", () => ({
  DEFAULT_PAGE_DELAY: {},
  randomPageSleep: mocks.pace,
}));
vi.mock("../../src/activity/journal.js", () => ({ finishActivity: vi.fn() }));
vi.mock("../../src/store/raw-archive.js", () => ({ setRawCapture: vi.fn() }));

import { executeTargetPlan } from "../../src/attio/target-runner.js";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.begin.mockResolvedValue(mocks.release);
});
function fixture(failRequest = false) {
  const rows = new Map(
    ["one", "two"].map((flagshipId) => [
      flagshipId,
      {
        flagshipId,
        publicIdentifier: "stale-slug",
        memberUrn: `urn:li:fsd_profile:${flagshipId}`,
        source: "connections",
      },
    ])
  );
  const cstore = {
    readConnection: async (id: string) => rows.get(id),
    enrichConnection: vi.fn(async (id: string) => {
      const row = rows.get(id);
      if (!row) throw new Error("Missing fixture row");
      Object.assign(row, { enrichedAt: "now", enrichDepth: "deep", raw: {} });
    }),
  };
  const store = {
    connectionsFor: () => cstore,
    peopleFor: () => ({ readPersonRecord: async (flagshipId: string) => ({ flagshipId }) }),
    accounts: { readConfig: async () => ({}) },
    init: vi.fn(),
    git: { scheduleCommit: vi.fn(), flush: vi.fn() },
  } as unknown as Store;
  const plan = {
    account: "account",
    targets: [...rows.keys()].map((flagshipId) => ({ flagshipId, name: flagshipId })),
  } as EnrichmentPlan;
  const request = vi.fn(async ({ url }: { url: string }) => {
    if (failRequest && !url.includes("profiles?")) throw new Error("HTTP 429");
    return { urn: `urn:li:fsd_profile:${url.split("=")[1]}` };
  });
  mocks.session.mockResolvedValue({
    apiClient: { request },
    profileId: "account",
    accountRecord: {},
  });
  mocks.enrich.mockImplementation(async ({ ids, cstore: scoped, apiClient }) => {
    expect((await scoped.readConnection(ids[0])).publicIdentifier).toBeNull();
    await apiClient.request({ url: `/identity/dash/profiles?id=${ids[0]}` });
    // Simulate the production parser swallowing subresource errors.
    for (const part of ["positions", "education", "skills"]) {
      try {
        await apiClient.request({ url: part });
      } catch {
        /* parser tolerates this; runner must not */
      }
    }
    await scoped.enrichConnection(ids[0]);
    return { enriched: 1, failed: 0, quotaExhausted: false };
  });
  return { store, plan, request, cstore, rows };
}
it("uses one preflight and one session for multiple profiles with one export refresh", async () => {
  const f = fixture(),
    finish = vi.fn();
  mocks.exports.mockResolvedValue(finish);
  const result = await executeTargetPlan(f.plan, f.store, {}, async () => {});
  expect(result).toMatchObject({
    status: "complete",
    enriched: 2,
    browserPreflights: 1,
    sessionLoads: 1,
    successfulRequests: 8,
  });
  expect(mocks.begin).toHaveBeenCalledTimes(1);
  expect(mocks.session).toHaveBeenCalledTimes(1);
  expect(mocks.pace).toHaveBeenCalledTimes(1);
  expect(finish).toHaveBeenCalledTimes(1);
  expect(mocks.release).toHaveBeenCalledTimes(1);
});
it("does not save partial subresource failures or attempt another profile", async () => {
  const f = fixture(true),
    receipts: unknown[] = [];
  await expect(
    executeTargetPlan(f.plan, f.store, {}, async (state) => {
      receipts.push({ ...state });
    })
  ).rejects.toThrow("HTTP 429");
  expect(f.request).toHaveBeenCalledTimes(2);
  expect(f.cstore.enrichConnection).not.toHaveBeenCalled();
  expect(mocks.enrich).toHaveBeenCalledTimes(1);
  expect(mocks.release).toHaveBeenCalledTimes(1);
  expect(receipts.at(-1)).toMatchObject({ status: "stopped", enriched: 0 });
});
it("saved batches make no browser, session, or quota calls", async () => {
  const f = fixture();
  for (const row of f.rows.values()) Object.assign(row, { enrichedAt: "now", enrichDepth: "deep" });
  const state = await executeTargetPlan(f.plan, f.store, {}, async () => {});
  expect(state).toMatchObject({
    status: "complete",
    skipped: 2,
    sessionLoads: 0,
    browserPreflights: 0,
  });
  expect(mocks.begin).not.toHaveBeenCalled();
  expect(mocks.session).not.toHaveBeenCalled();
});
it("blocks a provider identity mismatch before saving", async () => {
  const f = fixture();
  f.request.mockResolvedValue({ urn: "urn:li:fsd_profile:wrong" });
  await expect(executeTargetPlan(f.plan, f.store, {}, async () => {})).rejects.toThrow(
    "different profile"
  );
  expect(f.cstore.enrichConnection).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledTimes(1);
});
it("validates list membership inside the shared session before quota or profile requests", async () => {
  const f = fixture();
  const validate = vi.fn(async () => {
    throw new Error("Membership changed");
  });
  await expect(executeTargetPlan(f.plan, f.store, {}, async () => {}, validate)).rejects.toThrow(
    "Membership changed"
  );
  expect(validate).toHaveBeenCalledTimes(1);
  expect(mocks.begin).toHaveBeenCalledTimes(1);
  expect(mocks.session).toHaveBeenCalledTimes(1);
  expect(mocks.quota).not.toHaveBeenCalled();
  expect(f.request).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledTimes(1);
});

it("resolves an initially unmatched import inside the same guarded session before enrichment", async () => {
  const f = fixture();
  const originalTargets = f.plan.targets.map((t) => ({ ...t, personIds: [t.flagshipId] }));
  f.plan.snapshot = { people: [{ id: "one" }, { id: "two" }] } as EnrichmentPlan["snapshot"];
  f.plan.targets = [];
  const resolve = vi.fn(async () => ({ ...f.plan, targets: originalTargets }));
  const state = await executeTargetPlan(f.plan, f.store, {}, async () => {}, vi.fn(), resolve);
  expect(state).toMatchObject({ enriched: 2, total: 2, sessionLoads: 1, browserPreflights: 1 });
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(mocks.session).toHaveBeenCalledTimes(1);
});
it("cannot expand sealed import membership during deferred resolution", async () => {
  const f = fixture();
  f.plan.snapshot = { people: [{ id: "one" }] } as EnrichmentPlan["snapshot"];
  const resolve = async () => ({
    ...f.plan,
    targets: f.plan.targets.map((t) => ({ ...t, personIds: ["outside"] })),
  });
  await expect(
    executeTargetPlan(f.plan, f.store, {}, async () => {}, vi.fn(), resolve)
  ).rejects.toThrow("expanded");
  expect(mocks.enrich).not.toHaveBeenCalled();
});
