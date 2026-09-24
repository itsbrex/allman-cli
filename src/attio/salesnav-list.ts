import type { LinkedInApiClient } from "../linkedin/api/client.js";
import type { StoredConnection } from "../store/connections-store.js";
import type { TargetCompany, TargetSnapshot } from "./lists.js";

const base = "https://www.linkedin.com/sales-api";
const salesId = /^ACw[A-Za-z0-9_-]{10,}$/;
const flagshipId = /^ACo[A-Za-z0-9_-]{10,}$/;
type Client = Pick<LinkedInApiClient, "request">;
export interface LeadList {
  id: string;
  url: string;
  name: string;
  observedAt: string;
  leads: Array<{
    id: string;
    name: string;
    memberId: string;
    companies: TargetCompany[];
  }>;
}
export interface IdentityCache {
  version: 1;
  account: string;
  /** Only positive, exact provider mappings. Failed/unresolved IDs are never cached. */
  mappings: Record<string, string>;
}

/** Keep 64-bit list IDs as strings. Never send arbitrary pasted URLs to the client. */
export function parseSalesnavListUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Paste a Sales Navigator lead list URL");
  }
  const id = /^\/sales\/lists\/people\/(\d{1,30})\/?$/.exec(url.pathname)?.[1];
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.linkedin.com" ||
    url.port ||
    url.username ||
    url.password ||
    !id
  )
    throw new Error("Expected https://www.linkedin.com/sales/lists/people/<list-id>");
  return { id, url: `https://www.linkedin.com/sales/lists/people/${id}` };
}

/** Complete read-only snapshot. Changing totals, duplicate pages and malformed rows fail closed. */
export async function readSalesnavList(
  client: Client,
  input: string,
  pace: () => Promise<void>
): Promise<LeadList> {
  const list = parseSalesnavListUrl(input);
  const leads: LeadList["leads"] = [];
  const seen = new Set<string>();
  let total: number | undefined,
    name = "",
    revision: unknown;
  for (let start = 0; start < 100000; start += 25) {
    if (start) await pace();
    const query = `(doFetchSpotlights:false,doFetchHits:true,doFetchFilters:false,pivotParam:(com.linkedin.sales.search.LeadListPivotRequest:(list:urn%3Ali%3Afs_salesList%3A${list.id},sortCriteria:CREATED_TIME,sortOrder:DESCENDING)),list:(scope:LEAD,includeAll:false,excludeAll:false,includedValues:List((id:${list.id}))))`;
    const decoration = encodeURIComponent(
      "(entityUrn,objectUrn,firstName,lastName,fullName,currentPositions*(title,companyName,current,companyUrn))"
    )
      .replaceAll("(", "%28")
      .replaceAll(")", "%29");
    const raw = await client.request<{
      elements?: Array<{
        entityUrn?: string;
        objectUrn?: string;
        fullName?: string;
        firstName?: string;
        lastName?: string;
        currentPositions?: Array<{ companyUrn?: string; companyName?: string }>;
      }>;
      paging?: { start?: number; total?: number };
      metadata?: {
        pivot?: Record<string, { name?: string; totalCount?: number; lastUpdatedAt?: unknown }>;
      };
    }>({
      method: "GET",
      url: `${base}/salesApiPeopleSearch?q=peopleSearchQuery&query=${query}&start=${start}&count=25&decoration=${decoration}`,
      headers: { accept: "application/json" },
    });
    const pivot = raw.metadata?.pivot?.["com.linkedin.sales.search.ListPivotResponse"];
    const count = raw.paging?.total;
    if (
      !Array.isArray(raw.elements) ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > 100000 ||
      raw.paging?.start !== start ||
      typeof pivot?.name !== "string" ||
      !pivot.name ||
      pivot.totalCount !== count ||
      (total !== undefined &&
        (total !== count || name !== pivot.name || revision !== pivot.lastUpdatedAt))
    )
      throw new Error(
        "Sales Navigator list changed or returned incomplete metadata; prepare again"
      );
    total = count;
    name = pivot.name;
    revision = pivot.lastUpdatedAt;
    if (raw.elements.length !== Math.min(25, total - start))
      throw new Error("Incomplete Sales Navigator list page; no shortlist saved");
    for (const row of raw.elements) {
      const id = /^urn:li:fs_salesProfile:\((ACw[\w-]+),/.exec(row.entityUrn ?? "")?.[1];
      if (!id || !salesId.test(id) || seen.has(id))
        throw new Error("Invalid or duplicate Sales Navigator lead identity");
      seen.add(id);
      const companies = new Map<string, TargetCompany>();
      for (const role of row.currentPositions ?? []) {
        const companyId = /^urn:li:fs_salesCompany:(\d+)$/.exec(role.companyUrn ?? "")?.[1];
        if (companyId)
          companies.set(companyId, {
            id: companyId,
            name: role.companyName || companyId,
            linkedinIds: [companyId],
            urls: [`https://www.linkedin.com/company/${companyId}/`],
            domains: [],
          });
      }
      leads.push({
        id,
        name: row.fullName || [row.firstName, row.lastName].filter(Boolean).join(" ") || id,
        memberId: /^urn:li:member:(\d+)$/.exec(row.objectUrn ?? "")?.[1] ?? "",
        companies: [...companies.values()],
      });
    }
    if (leads.length === total)
      return { ...list, name, observedAt: new Date().toISOString(), leads };
  }
  throw new Error("Sales Navigator pagination cap reached; no shortlist saved");
}

/** Lightweight batch identity bridge, 100 IDs/request. No deep-profile calls. */
export async function mapStoredSalesnavIds(
  client: Client,
  rows: StoredConnection[],
  account: string,
  cache: IdentityCache,
  save: (cache: IdentityCache) => Promise<void>,
  pace: () => Promise<void>
) {
  if (
    cache.version !== 1 ||
    cache.account !== account ||
    !cache.mappings ||
    Object.entries(cache.mappings).some(
      ([id, sales]) => !flagshipId.test(id) || !salesId.test(sales)
    )
  )
    throw new Error("Invalid account-scoped Sales Navigator identity cache");
  const ids = [
    ...new Set(
      rows.filter((r) => (r.source ?? "connections") === "connections").map((r) => r.flagshipId)
    ),
  ];
  if (ids.some((id) => !flagshipId.test(id))) throw new Error("Invalid stored flagship identity");
  const missing = ids.filter((id) => !cache.mappings[id]);
  for (let start = 0; start < missing.length; start += 100) {
    await pace();
    const chunk = missing.slice(start, start + 100);
    const tuples = chunk
      .map((id) => `(profileId:${id},authType:undefined,authToken:undefined)`)
      .join(",");
    const raw = await client.request<{
      results?: Record<string, unknown>;
      data?: { results?: Record<string, unknown> };
    }>({ method: "GET", url: `${base}/salesApiProfiles?ids=List(${tuples})` });
    const results = raw.data?.results ?? raw.results;
    if (!results || typeof results !== "object" || Array.isArray(results))
      throw new Error("Invalid Sales Navigator identity response");
    for (const [key, value] of Object.entries(results)) {
      const id = /profileId:([^),]+)/.exec(key)?.[1];
      const sales =
        typeof value === "string"
          ? /^urn:li:fs_salesProfile:\((ACw[\w-]+),/.exec(value)?.[1]
          : undefined;
      if (!id || !chunk.includes(id) || !sales || !salesId.test(sales))
        throw new Error("Unexpected Sales Navigator identity mapping");
      cache.mappings[id] = sales;
    }
    await save(cache);
    process.stderr.write(
      `Sales Navigator identity lookup: ${Math.min(start + 100, missing.length)}/${missing.length} stored IDs; no deep profiles fetched.\n`
    );
  }
  return new Map(
    ids.flatMap((id) => (cache.mappings[id] ? [[id, cache.mappings[id]] as const] : []))
  );
}

export function salesnavSnapshot(
  list: LeadList,
  rows: StoredConnection[],
  account: string,
  mapping: Map<string, string>
): TargetSnapshot {
  const bySales = new Map<string, Set<string>>(),
    byMember = new Map<string, Set<string>>();
  for (const row of rows.filter((r) => (r.source ?? "connections") === "connections")) {
    const sales = mapping.get(row.flagshipId);
    if (sales) bySales.set(sales, new Set([...(bySales.get(sales) ?? []), row.flagshipId]));
    const member = row.memberId || /^urn:li:member:(\d+)$/.exec(row.objectUrn ?? "")?.[1];
    if (member) byMember.set(member, new Set([...(byMember.get(member) ?? []), row.flagshipId]));
  }
  const companies = new Map(list.leads.flatMap((l) => l.companies.map((c) => [c.id, c] as const)));
  return {
    version: 1,
    complete: true,
    source: { kind: "salesnav", url: list.url, account },
    observedAt: list.observedAt,
    list: { id: list.id, name: list.name },
    companies: [...companies.values()],
    people: list.leads.map((lead) => ({
      id: lead.id,
      name: lead.name,
      sourceUrl: `https://www.linkedin.com/sales/lead/${lead.id}`,
      companies: lead.companies.map((c) => c.id),
      urls: [],
      handles: [],
      left: false,
      urns: [
        ...new Set([...(bySales.get(lead.id) ?? []), ...(byMember.get(lead.memberId) ?? [])]),
      ].map((id) => `urn:li:fsd_profile:${id}`),
    })),
  };
}
