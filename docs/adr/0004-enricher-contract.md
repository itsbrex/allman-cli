# ADR-0004: One Enricher contract for every data source

- **Status:** accepted
- **Date:** 2026-08-19
- **Source:** plan #001 (store-connectors-expansion) d12 — "the alternative the history suggests
  but never names."

## Context

Three workstreams are converging on the same shape independently: the geo provenance stamp
(ADR-0001), the CompanyEnricher contract (ADR-0002), and — further out — upstream #8 (multi-channel
contacts) and #9 (auto-enrichment from public sources), each of which would invent per-field
provenance, staleness rules, and overwrite policy a third and fourth time. Today exactly one
enricher exists: the LinkedIn profile enricher behind `allman enrich`. The cheapest moment to
standardize a boundary is while it has one implementation.

## Decision

Define a single **Enricher contract** in `src/store/enricher.ts` — types only, no runtime, no
plugin framework:

- An enricher takes identity keys (flagship id / slug / domain / …) and returns **observations**:
  per-field values, each stamped `{ source, observedAt, confidence? }`.
- The **store side** (not the enricher) applies observations under one policy: better-or-equal
  provenance may overwrite, user-asserted fields are never auto-overwritten, every application is
  recorded in the record's `provenance` map (ADR-0003).
- `source` is a namespaced string (`"linkedin/enrich-core"`, `"linkedin/enrich-deep"`,
  `"linkedin/sweep"`, `"user"`, later `"email"`, `"web"`, …) with a documented ranking; `"user"`
  outranks everything.
- The existing LinkedIn enricher is the contract's first and only implementation; retrofitting its
  write path onto the store-side policy is the implementation ticket. Future sources — email,
  public web, company data — become additional implementations, not additional patterns.

Explicitly out of scope: dynamic loading, registration, configuration surface, or any runtime
machinery. One TypeScript interface plus this document.

## Alternatives considered

- **Let each source grow its own shape, unify later** — retrofit across three shipped enrichers is
  the expensive version of the same work, and the store would carry three overwrite policies in
  the meantime.
- **A plugin framework** — speculative machinery; the CLI links its enrichers at compile time and
  nothing on the roadmap needs otherwise.

## Consequences

- ADR-0001's stamp and ADR-0002's contract become instances of this one shape.
- Cost if no second source ever ships: one types file and one doc page.
- Revisit only if an enricher needs long-lived state or out-of-process execution.
