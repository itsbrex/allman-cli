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

const query =
  "(recentSearchParam:(id:999),filters:List((type:LEAD_LIST,values:List((id:7508689992186191872,text:Clients%20%2B%20Former,selectionType:INCLUDED))),(type:REGION,values:List((id:102,selectionType:INCLUDED)))))";
const searchUrl = (q = query, key = "query") => {
  const result = new URL("https://www.linkedin.com/sales/search/people");
  result.searchParams.set(key, q);
  result.searchParams.set("sessionId", "session+token==");
  return result.href;
};
it("preserves every search filter and nested escaping without mistaking recent-search ID for list ID", () => {
  for (const key of ["query", "searchQuery"]) {
    const parsed = parseSalesnavListUrl(searchUrl(query, key));
    expect(parsed.id).toBe("7508689992186191872");
    expect(parsed.query).toBe(query);
    expect(parsed.sessionId).toBe("session+token==");
    expect(parseSalesnavListUrl(parsed.url)).toEqual(parsed);
  }
});
it("rejects ambiguous, excluded, missing and malformed lead-list filters", () => {
  for (const input of [
    searchUrl(query.replace("LEAD_LIST", "SAVED_SEARCH")),
    searchUrl(query.replace("selectionType:INCLUDED", "selectionType:EXCLUDED")),
    searchUrl(query.replace("text:Clients", "id:42,text:Clients")),
    searchUrl(query.replace("type:REGION", "type:LEAD_LIST")),
    searchUrl(query.replace("%20", "%xx")),
    searchUrl(query + "&start=25"),
    searchUrl(query.slice(0, -1)),
    searchUrl() + "&query=duplicate",
    searchUrl().replace(/&sessionId=.*/, ""),
    "https://www.linkedin.com/sales/search/people?savedSearchId=123",
    searchUrl().replace("www.linkedin.com", "evil.test"),
  ])
    expect(() => parseSalesnavListUrl(input)).toThrow();
});
it("reads filtered search pages, preserves filters, and validates the saved snapshot", async () => {
  const { validateTargetSnapshot } = await import("../../src/attio/lists.js");
  const first = page(0, 26),
    last = page(25, 26);
  const request = vi
    .fn()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce({
      data: { paging: last.paging, "*elements": last.elements.map((row) => row.entityUrn) },
      included: last.elements,
    });
  const list = await readSalesnavList(client(request), searchUrl(), async () => {});
  expect(list.leads).toHaveLength(26);
  const requested = request.mock.calls[0]?.[0].url;
  expect(requested).toContain("/salesApiLeadSearch?");
  expect(requested).toContain(`query=${query}&start=0`);
  expect(requested).toContain("sessionId:session%2Btoken%3D%3D");
  const snapshot = salesnavSnapshot(list, rows(26), "jp", new Map());
  expect(() => validateTargetSnapshot(snapshot)).not.toThrow();
  expect(snapshot.source?.url).toBe(parseSalesnavListUrl(searchUrl()).url);
  snapshot.list.id = "42";
  expect(() => validateTargetSnapshot(snapshot)).toThrow();
});
it("refuses incomplete or over-cap filtered results and stops immediately on 429", async () => {
  for (const fixture of [
    { paging: { start: 0, total: 2501 }, elements: [] },
    { paging: { start: 0, total: 1 }, "*elements": ["missing"], included: [] },
    { paging: { start: 25, total: 1 }, elements: page(0, 1).elements },
  ]) {
    await expect(
      readSalesnavList(client(vi.fn().mockResolvedValue(fixture)), searchUrl(), async () => {})
    ).rejects.toThrow();
  }
  const request = vi.fn().mockRejectedValue(new Error("HTTP 429"));
  await expect(readSalesnavList(client(request), searchUrl(), async () => {})).rejects.toThrow(
    "HTTP 429"
  );
  expect(request).toHaveBeenCalledTimes(1);
});
