import type { Enricher, EnrichmentTarget, ObservationSet } from "../store/enricher.js";
import { observationsFrom } from "../store/people.js";
import type { LinkedInApiClient } from "./api/client.js";
import { fetchProfileDetail, type ProfileDetail } from "./api/endpoints/profile-detail.js";

export interface ProfileObservationResult {
  detail: ProfileDetail;
  observations: ObservationSet;
}

/** Fetching and parsing only. The caller owns quota/pacing and the store owns merging. */
export class LinkedInProfileEnricher implements Enricher {
  readonly namespace = "linkedin";
  readonly accepts = ["flagshipId", "slug"] as const;
  constructor(
    private client: LinkedInApiClient,
    private depth: "core" | "deep",
    private raw = false
  ) {}
  async enrich(target: EnrichmentTarget): Promise<ObservationSet> {
    const identity = target.flagshipId ?? target.slug;
    if (!identity) throw new Error("LinkedIn enrichment requires a flagshipId or slug");
    return (await this.fetch(identity))?.observations ?? {};
  }
  async fetch(identity: string): Promise<ProfileObservationResult | null> {
    const detail = await fetchProfileDetail(this.client, identity, {
      deep: this.depth === "deep",
      raw: this.raw,
    });
    if (!detail) return null;
    return {
      detail,
      observations: observationsFrom(personFactsFrom(detail, this.depth), {
        source: this.depth === "deep" ? "linkedin/enrich-deep" : "linkedin/enrich-core",
        observedAt: new Date().toISOString(),
      }),
    };
  }
}

/** The person-fact projection of a fetched profile — what `people/` owns. */
function personFactsFrom(d: ProfileDetail, depth: "core" | "deep") {
  const base = {
    memberUrn: d.urn,
    objectUrn: d.objectUrn,
    memberId: d.memberId,
    publicIdentifier: d.publicIdentifier,
    firstName: d.firstName,
    lastName: d.lastName,
    headline: d.headline,
    title: d.title,
    company: d.company,
    companyUrn: d.companyUrn,
    location: d.location,
    country: d.country,
    geoUrn: d.geoUrn,
    geoName: d.geoName,
    geoGranularity: d.geoUrn ? d.geoGranularity : null,
    about: d.about,
    industry: d.industry,
    industryUrn: d.industryUrn,
    address: d.address,
    pronoun: d.pronoun,
    premium: d.premium,
    memorialized: d.memorialized,
    profilePictureUrl: d.profilePictureUrl,
    primaryLocale: d.primaryLocale,
  };
  if (depth !== "deep") return base;
  return {
    ...base,
    positions: d.positions.length > 0 ? d.positions : null,
    education: d.education.length > 0 ? d.education : null,
    skills: d.skills.length > 0 ? d.skills : null,
  };
}
