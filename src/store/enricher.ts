/**
 * The Enricher contract — the one boundary every data source implements.
 *
 * Types only, on purpose (ADR-0004): enrichers are linked at compile time, and
 * the store side owns the overwrite policy. An enricher never writes records;
 * it returns observations, and the store applies them under the provenance
 * rules in ADR-0001/0003 (better-or-equal provenance may overwrite, `"user"`
 * assertions are never auto-overwritten).
 *
 * The LinkedIn profile enricher behind `allman enrich` is the first and only
 * implementation; future sources (email, public web, company data) implement
 * this same contract rather than inventing their own stamp shapes.
 */

/**
 * Where a value came from, as a namespaced string with a documented ranking.
 * Higher outranks lower when the store decides whether a write may overwrite:
 *
 *   "user" > "linkedin/enrich-deep" > "linkedin/enrich-core"
 *          > "linkedin/sweep" > everything else
 *
 * New sources add namespaces ("email/…", "web/…"); they slot below the
 * LinkedIn tiers until an ADR says otherwise.
 */
export type ProvenanceSource =
  | "user"
  | "linkedin/enrich-deep"
  | "linkedin/enrich-core"
  | "linkedin/sweep"
  | (string & Record<never, never>);

/** The stamp attached to every observed field value. */
export interface Provenance {
  source: ProvenanceSource;
  /** ISO timestamp of when the source reported the value. */
  observedAt: string;
  /** 0–1, when the source is probabilistic. Absent means asserted. */
  confidence?: number;
}

/**
 * One field's observed value plus its stamp. `value: null` is a real
 * observation ("the source says this field is empty"), distinct from the
 * field being absent from the observation set (source knows nothing).
 */
export interface Observation<T = unknown> {
  value: T | null;
  provenance: Provenance;
}

/**
 * The identity keys an enricher may be given. At least one must be present;
 * which ones a given enricher understands is part of its documented contract.
 */
export interface EnrichmentTarget {
  /** Flagship profile id (`ACo…`). */
  flagshipId?: string;
  /** LinkedIn publicIdentifier. */
  slug?: string;
  /** Company website domain (company enrichers, ADR-0002). */
  domain?: string;
  /** Canonical or display name, when nothing stronger is known. */
  name?: string;
}

/**
 * What an enricher returns: a map of record fields to stamped observations.
 * Keys are field names on the target record (person or company); the store
 * side validates them against the record shape when applying.
 */
export type ObservationSet = Record<string, Observation>;

/**
 * A single enrichment source. Implementations own fetching, pacing hooks, and
 * payload parsing; they never touch the store.
 */
export interface Enricher {
  /** Namespace all this enricher's provenance sources share, e.g. "linkedin". */
  readonly namespace: string;
  /** Which target keys this enricher can act on. */
  readonly accepts: ReadonlyArray<keyof EnrichmentTarget>;
  enrich(target: EnrichmentTarget): Promise<ObservationSet>;
}
