import { expect, it, vi } from "vitest";
import {
  mapStoredSalesnavIds,
  parseSalesnavListUrl,
  readSalesnavList,
  salesnavSnapshot,
} from "../../src/attio/salesnav-list.js";
import { matchTargets } from "../../src/attio/target-matches.js";
import type { LinkedInApiClient } from "../../src/linkedin/api/client.js";
import type { StoredConnection } from "../../src/store/connections-store.js";

const url = "https://www.linkedin.com/sales/lists/people/7508689992186191872";
const fid = (n: number) => `ACo${String(n).padStart(12, "0")}`;
const sid = (n: number) => `ACw${String(n).padStart(12, "0")}`;
const client = (request: ReturnType<typeof vi.fn>) => ({ request }) as unknown as LinkedInApiClient;
const rows = (count: number) =>
  Array.from({ length: count }, (_, n) => ({
    flagshipId: fid(n),
    memberUrn: `urn:li:fsd_profile:${fid(n)}`,
    source: "connections",
  })) as StoredConnection[];
function page(start: number, total: number) {
  return {
    paging: { start, total },
    metadata: {
      pivot: {
        "com.linkedin.sales.search.ListPivotResponse": {
          name: "Clients",
          totalCount: total,
          lastUpdatedAt: 5,
        },
      },
    },
    elements: Array.from({ length: Math.min(25, total - start) }, (_, n) => ({
      entityUrn: `urn:li:fs_salesProfile:(${sid(start + n)},NAME_SEARCH,token)`,
      objectUrn: `urn:li:member:${start + n + 1}`,
      fullName: `Person ${start + n}`,
      currentPositions: [],
    })),
  };
}
it("validates host, protocol and lead-list path without rounding IDs", () => {
  expect(parseSalesnavListUrl(url + "?sortCriteria=CREATED_TIME")).toEqual({
    id: "7508689992186191872",
    url,
  });
  for (const input of [
    url.replace("https:", "http:"),
    url.replace("linkedin.com", "linkedin.com.evil.test"),
    url.replace("people/", "companies/"),
    url.replace("www.", "me@www."),
    url + "/extra",
  ])
    expect(() => parseSalesnavListUrl(input)).toThrow();
});
it("collects every lead over paced pages, using encoded decoration", async () => {
  const request = vi.fn().mockResolvedValueOnce(page(0, 26)).mockResolvedValueOnce(page(25, 26));
  const pace = vi.fn();
  const result = await readSalesnavList(client(request), url, pace);
  expect(result.leads).toHaveLength(26);
  expect(pace).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]?.[0].url).toContain("decoration=%28");
  expect(result.leads[25]?.id).toBe(sid(25));
});
it("fails closed on partial pages, duplicates, changing totals, and provider errors", async () => {
  const short = page(0, 26);
  short.elements.pop();
  const duplicate = page(25, 26);
  duplicate.elements[0]!.entityUrn = page(0, 26).elements[0]!.entityUrn;
  for (const pages of [[short], [page(0, 26), duplicate], [page(0, 26), page(25, 27)]]) {
    const request = vi.fn();
    for (const p of pages) request.mockResolvedValueOnce(p);
    await expect(readSalesnavList(client(request), url, async () => {})).rejects.toThrow();
  }
  await expect(
    readSalesnavList(client(vi.fn().mockRejectedValue(new Error("HTTP 403"))), url, async () => {})
  ).rejects.toThrow("HTTP 403");
  expect(
    (await readSalesnavList(client(vi.fn().mockResolvedValue(page(0, 0))), url, async () => {}))
      .leads
  ).toEqual([]);
});
it("batches lightweight identities, caches exact positives and enforces account isolation", async () => {
  const request = vi.fn(async ({ url }: { url: string }) => ({
    results: Object.fromEntries(
      [...url.matchAll(/profileId:(ACo[\w-]+)/g)].map((m) => [
        `*(profileId:${m[1]})`,
        `urn:li:fs_salesProfile:(${sid(Number(m[1]!.slice(3)))},undefined,undefined)`,
      ])
    ),
  }));
  const cache = { version: 1 as const, account: "jp", mappings: {} },
    save = vi.fn(),
    pace = vi.fn();
  const first = await mapStoredSalesnavIds(client(request), rows(101), "jp", cache, save, pace);
  expect(first.size).toBe(101);
  expect(request).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenCalledTimes(2);
  await mapStoredSalesnavIds(client(request), rows(101), "jp", cache, save, pace);
  expect(request).toHaveBeenCalledTimes(2);
  await expect(
    mapStoredSalesnavIds(client(request), rows(1), "other", cache, save, pace)
  ).rejects.toThrow("account-scoped");
});
it("stops identity resolution on error and never persists a malformed mapping", async () => {
  for (const request of [
    vi.fn().mockRejectedValue(new Error("HTTP 429")),
    vi.fn().mockResolvedValue({}),
    vi.fn().mockResolvedValue({
      results: { [`*(profileId:${fid(999)})`]: `urn:li:fs_salesProfile:(${sid(9)},x,y)` },
    }),
  ]) {
    const save = vi.fn();
    await expect(
      mapStoredSalesnavIds(
        client(request),
        rows(101),
        "jp",
        { version: 1, account: "jp", mappings: {} },
        save,
        async () => {}
      )
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  }
});
it("matches exact account identities, includes leads without employers, excludes collisions and fetched non-connections", async () => {
  const list = await readSalesnavList(
    client(vi.fn().mockResolvedValue(page(0, 3))),
    url,
    async () => {}
  );
  const stored = rows(4);
  stored[3]!.source = "enrich";
  const mapping = new Map([
    [fid(0), sid(0)],
    [fid(1), sid(1)],
    [fid(2), sid(1)],
    [fid(3), sid(2)],
  ]);
  const snapshot = salesnavSnapshot(list, stored, "jp", mapping);
  const result = matchTargets(snapshot, stored);
  expect(result.targets.map((t) => t.flagshipId)).toEqual([fid(0)]);
  expect(result.matches.map((m) => m.outcome)).toEqual([
    "matched",
    "identity-conflict",
    "missing-identity",
  ]);
  expect(snapshot.people[0]!.sourceUrl).toContain("/sales/lead/");
});
