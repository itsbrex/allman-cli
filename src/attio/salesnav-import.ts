import type { LinkedInApiClient } from "../linkedin/api/client.js";
import type { StoredConnection } from "../store/connections-store.js";
import type { IdentityCache } from "./salesnav-list.js";
import { salesnavSnapshot } from "./salesnav-list.js";
import { type EnrichmentPlan, matchTargets } from "./target-matches.js";

export interface SalesnavResolutions {
  version: 1;
  account: string;
  runId: string;
  identities: Record<string, { urns: string[]; urls: string[] }>;
}
export function cachedSalesnavPlan(
  plan: EnrichmentPlan,
  rows: StoredConnection[],
  cache: IdentityCache,
  resolved: SalesnavResolutions
): EnrichmentPlan {
  const list = plan.salesnavImport;
  if (!list) return plan;
  if (
    cache.version !== 1 ||
    cache.account !== plan.account ||
    !cache.mappings ||
    Object.entries(cache.mappings).some(
      ([f, s]) => !/^ACo[\w-]{10,}$/.test(f) || !/^ACw[\w-]{10,}$/.test(s)
    )
  )
    throw new Error("Invalid account-scoped Sales Navigator identity cache");
  if (
    resolved.version !== 1 ||
    resolved.account !== plan.account ||
    resolved.runId !== plan.id ||
    !resolved.identities ||
    Object.keys(resolved.identities).some((id) => !list.leads.some((lead) => lead.id === id))
  )
    throw new Error("Invalid run-scoped Sales Navigator identities");
  const snapshot = salesnavSnapshot(
    list,
    rows,
    plan.account,
    new Map(Object.entries(cache.mappings))
  );
  for (const person of snapshot.people) {
    const identity = resolved.identities[person.id];
    if (!identity) continue;
    if (
      !Array.isArray(identity.urns) ||
      !Array.isArray(identity.urls) ||
      identity.urns.some((urn) => !/^urn:li:fsd_profile:ACo[\w-]{10,}$/.test(urn)) ||
      identity.urls.some(
        (url) => !/^https:\/\/www\.linkedin\.com\/in\/[A-Za-z0-9_%~-]+\/$/.test(url)
      )
    )
      throw new Error("Invalid resolved Sales Navigator identity");
    person.urns = [...new Set([...person.urns, ...identity.urns])];
    person.urls = identity.urls;
  }
  return { ...plan, snapshot, ...matchTargets(snapshot, rows) };
}

/** Resolve only sealed, unmatched list members. Save each success before the next request. */
export async function resolveSalesnavMembers(
  plan: EnrichmentPlan,
  rows: StoredConnection[],
  cache: IdentityCache,
  resolved: SalesnavResolutions,
  client: Pick<LinkedInApiClient, "request">,
  deps: {
    save: (value: SalesnavResolutions) => Promise<void>;
    pace: () => Promise<void>;
    beforeRequest: () => Promise<void>;
  }
): Promise<EnrichmentPlan> {
  let current = cachedSalesnavPlan(plan, rows, cache, resolved);
  const missing = current.matches.filter((m) => m.outcome === "missing-identity");
  for (const match of missing) {
    const lead = plan.salesnavImport?.leads.find((l) => l.id === match.personId);
    if (!lead || !/^ACw[\w-]{10,}$/.test(lead.id))
      throw new Error("Missing imported Sales Navigator identity");
    // Opaque tuple parts are encoded separately; never turn provider data into URL structure.
    const tuple = /^\(([^,()]+),([^,()]*),([^,()]*)\)$/.exec(lead.profileTuple ?? "");
    if (!tuple || tuple[1] !== lead.id)
      throw new Error("Missing Sales Navigator profile context; prepare again");
    await deps.pace();
    await deps.beforeRequest();
    const url = `https://www.linkedin.com/sales-api/salesApiProfiles/(profileId:${encodeURIComponent(lead.id)},authType:${encodeURIComponent(tuple[2] ?? "")},authToken:${encodeURIComponent(tuple[3] ?? "")})?decoration=%28entityUrn%2CflagshipProfileUrl%29`;
    const raw = await client.request<{
      entityUrn?: string;
      flagshipProfileUrl?: string;
      data?: { entityUrn?: string; flagshipProfileUrl?: string };
    }>({ method: "GET", url });
    const data = raw.data ?? raw;
    if (data.entityUrn?.match(/^urn:li:fs_salesProfile:\((ACw[\w-]+),/)?.[1] !== lead.id)
      throw new Error("Provider returned a different Sales Navigator identity");
    let profile: URL;
    try {
      profile = new URL(data.flagshipProfileUrl ?? "");
    } catch {
      throw new Error("Sales Navigator returned no flagship profile URL");
    }
    const slug = /^\/in\/([A-Za-z0-9_%~-]+)\/?$/.exec(profile.pathname)?.[1];
    if (
      profile.protocol !== "https:" ||
      !["linkedin.com", "www.linkedin.com"].includes(profile.hostname) ||
      profile.username ||
      profile.password ||
      profile.port ||
      !slug
    )
      throw new Error("Invalid flagship profile URL");
    const identity = {
      urns: /^ACo[\w-]{10,}$/.test(slug) ? [`urn:li:fsd_profile:${slug}`] : [],
      urls: [`https://www.linkedin.com/in/${slug}/`],
    };
    resolved.identities[lead.id] = identity;
    current = cachedSalesnavPlan(plan, rows, cache, resolved);
    const matched = current.matches.find((m) => m.personId === lead.id && m.outcome === "matched");
    if (matched?.flagshipId && !cache.mappings[matched.flagshipId])
      cache.mappings[matched.flagshipId] = lead.id;
    await deps.save(resolved);
    process.stderr.write(
      `Sales Navigator list identity: ${Object.keys(resolved.identities).length} saved; ${current.matches.filter((m) => m.outcome === "missing-identity").length} unresolved.\n`
    );
  }
  return current;
}
