# ADR-0002: Company records + the CompanyEnricher boundary

- **Status:** accepted (design); implementation deferred behind ADR-0001's provenance pattern
- **Date:** 2026-08-19
- **Source:** upstream tarkaai/allman-cli#10 and its comment thread (provider-neutral enricher
  contract proposal); plan #001 (store-connectors-expansion) d10.

## Context

Work history from `enrich --deep` already stores `companyUrn`s on positions, and `allman companies`
resolves org pages — raw material for company records exists on disk with no company entity to hang
it on. Upstream #10 proposes company records plus a `CompanyEnricher` contract; the open question
posed there — which layer owns the boundary, the enrichment command or a future company service —
is a design negotiation the upstream thread cannot settle. The fork can.

## Decision

Commit to the contract's invariants now, ahead of any implementation:

- Contract shape: `{ name?, domain? } → { canonicalName, domains[], size?, industry?, funding?,
  provenanceByField, observedAt, confidenceByField }`.
- Enrichment **never silently overwrites** asserted or user-edited fields.
- Every field carries provenance + observation time (the ADR-0001 stamp, extended with confidence).
- A person's concurrent roles produce **multiple affiliation edges**; current and past affiliations
  are separately queryable.
- Domain/name collisions enter **merge review** — never auto-merge.
- Ownership: the boundary is owned by the **enrichment layer** (the same seam ADR-0004 defines),
  not by a company service; company records are a store concern, fetching is an enricher concern.
  This is the fork's answer to the question upstream left open.

Implementation is deferred until the structured-geo provenance stamp (ADR-0001) has shipped and
been exercised — company records become the second consumer of a proven pattern, not the first
consumer of an unproven one.

## Alternatives considered

- **Implement company records now** — puts the first provenance implementation on the harder
  entity (merge review, multi-affiliation) instead of the simple one (a geo field).
- **A company service owning the boundary** — adds a layer the CLI's flat store architecture has
  no precedent for; the enrichment seam already exists.

## Consequences

- Fork ticket adopted with the `Upstream: tarkaai/allman-cli#10` join key; this ADR is also the
  substantive reply the upstream design thread is waiting on, if we ever choose to engage.
- Revisit ownership if a long-running company sync ever needs state no command-scoped enricher can
  hold.
