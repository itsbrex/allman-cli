import type { Enricher, EnrichmentTarget, ObservationSet } from "../store/enricher.js";
import { meaningful } from "../store/observations.js";
import type { LinkedInApiClient } from "./api/client.js";
import { fetchCompany } from "./api/endpoints/companies.js";

/** Company source, independent of storage and identity-merge policy. */
export class LinkedInCompanyEnricher implements Enricher {
  readonly namespace = "linkedin";
  readonly accepts = ["name", "slug"] as const;
  constructor(private client: LinkedInApiClient) {}
  async enrich(target: EnrichmentTarget): Promise<ObservationSet> {
    const result = await this.fetch(target.slug ?? target.name ?? "");
    return result?.observations ?? {};
  }
  async fetch(target: string) {
    if (!target) throw new Error("LinkedIn company enrichment requires an id, URN, or slug");
    const company = await fetchCompany(this.client, target);
    if (!company) return null;
    const observedAt = new Date().toISOString();
    let domains: string[] = [];
    if (company.website) {
      try {
        domains = [new URL(company.website).hostname.toLowerCase().replace(/^www\./, "")];
      } catch {}
    }
    const facts = { ...company, canonicalName: company.name, domains };
    const observations: ObservationSet = {};
    for (const [field, value] of Object.entries(facts)) {
      if (["id", "companyUrn"].includes(field) || !meaningful(value)) continue;
      observations[field] = { value, provenance: { source: "linkedin/company", observedAt } };
    }
    return { company, observations, observedAt };
  }
}
