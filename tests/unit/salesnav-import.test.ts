import { expect, it, vi } from "vitest";
import {
  cachedSalesnavPlan,
  resolveSalesnavMembers,
  type SalesnavResolutions,
} from "../../src/attio/salesnav-import.js";
import { type LeadList, salesnavSnapshot } from "../../src/attio/salesnav-list.js";
import { type EnrichmentPlan, matchTargets } from "../../src/attio/target-matches.js";
import type { StoredConnection } from "../../src/store/connections-store.js";

const fid = (n: number) => `ACo${String(n).padStart(12, "0")}`;
const sid = (n: number) => `ACw${String(n).padStart(12, "0")}`;
function fixture() {
  const rows = [0, 1, 2, 3].map((n) => ({
    flagshipId: fid(n),
    memberUrn: `urn:li:fsd_profile:${fid(n)}`,
    publicIdentifier: `person-${n}`,
    source: "connections",
  })) as StoredConnection[];
  const list: LeadList = {
    id: "123",
    url: "https://www.linkedin.com/sales/lists/people/123",
    name: "List",
    observedAt: "2026-09-24T00:00:00Z",
    leads: [0, 1, 2].map((n) => ({
      id: sid(n),
      name: `Person ${n}`,
      memberId: "",
      companies: [],
      profileTuple: `(${sid(n)},NAME_SEARCH,opaque)`,
    })),
  };
  const snapshot = salesnavSnapshot(list, rows, "jp", new Map());
  const plan: EnrichmentPlan = {
    version: 1,
    id: "run",
    preparedAt: list.observedAt,
    account: "jp",
    accountName: "JP",
    store: "/store",
    salesnavImport: list,
    snapshot,
    ...matchTargets(snapshot, rows),
  };
  const cache = { version: 1 as const, account: "jp", mappings: { [fid(0)]: sid(0) } };
  const resolved: SalesnavResolutions = { version: 1, account: "jp", runId: "run", identities: {} };
  return { rows, plan, cache, resolved };
}
it("matches cached identities without requests and keeps all imported people", () => {
  const f = fixture();
  const p = cachedSalesnavPlan(f.plan, f.rows, f.cache, f.resolved);
  expect(p.snapshot.people).toHaveLength(3);
  expect(p.targets.map((t) => t.flagshipId)).toEqual([fid(0)]);
  expect(p.matches.filter((m) => m.outcome === "missing-identity")).toHaveLength(2);
  expect(() =>
    cachedSalesnavPlan(f.plan, f.rows, { ...f.cache, account: "brian" }, f.resolved)
  ).toThrow("account-scoped");
});
it("looks up only unresolved list members, saves each success and resumes without repeating it", async () => {
  const f = fixture();
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      entityUrn: `urn:li:fs_salesProfile:(${sid(1)},x,y)`,
      flagshipProfileUrl: "https://www.linkedin.com/in/person-1/",
    })
    .mockRejectedValueOnce(new Error("HTTP 429"));
  const save = vi.fn(),
    beforeRequest = vi.fn(),
    pace = vi.fn();
  await expect(
    resolveSalesnavMembers(f.plan, f.rows, f.cache, f.resolved, { request } as never, {
      save,
      beforeRequest,
      pace,
    })
  ).rejects.toThrow("HTTP 429");
  expect(save).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0]?.[0].url).toContain(`profileId:${sid(1)}`);
  expect(request.mock.calls[1]?.[0].url).toContain(`profileId:${sid(2)}`);
  expect(JSON.stringify(request.mock.calls)).not.toContain(fid(3));
  request.mockReset().mockResolvedValue({
    entityUrn: `urn:li:fs_salesProfile:(${sid(2)},x,y)`,
    flagshipProfileUrl: `https://www.linkedin.com/in/${fid(2)}/`,
  });
  const p = await resolveSalesnavMembers(
    f.plan,
    f.rows,
    f.cache,
    f.resolved,
    { request } as never,
    { save, beforeRequest, pace }
  );
  expect(request).toHaveBeenCalledTimes(1);
  expect(p.targets).toHaveLength(3);
  const freshRun = { ...f.resolved, runId: "another", identities: {} };
  expect(
    cachedSalesnavPlan({ ...f.plan, id: "another" }, f.rows, f.cache, freshRun).targets
  ).toHaveLength(3);
});
it("rejects wrong identities, stops before quota-denied requests, and never selects non-connections", async () => {
  for (const mismatch of [true, false]) {
    const f = fixture();
    const request = vi.fn().mockResolvedValue({
      entityUrn: `urn:li:fs_salesProfile:(${sid(mismatch ? 99 : 1)},x,y)`,
      flagshipProfileUrl: "https://evil.test/in/name/",
    });
    const save = vi.fn();
    await expect(
      resolveSalesnavMembers(f.plan, f.rows, f.cache, f.resolved, { request } as never, {
        save,
        pace: vi.fn(),
        beforeRequest: vi.fn(),
      })
    ).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  }
  const f = fixture(),
    request = vi.fn();
  await expect(
    resolveSalesnavMembers(f.plan, f.rows, f.cache, f.resolved, { request } as never, {
      save: vi.fn(),
      pace: vi.fn(),
      beforeRequest: async () => {
        throw new Error("quota");
      },
    })
  ).rejects.toThrow("quota");
  expect(request).not.toHaveBeenCalled();
  f.resolved.identities[sid(1)] = { urns: [`urn:li:fsd_profile:${fid(99)}`], urls: [] };
  expect(cachedSalesnavPlan(f.plan, f.rows, f.cache, f.resolved).matches[1]?.outcome).toBe(
    "not-in-account"
  );
});
