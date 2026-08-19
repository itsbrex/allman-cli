# ADR-0003: Person records — one owner for person facts

- **Status:** accepted
- **Date:** 2026-08-19
- **Source:** plan #001 (allman-tui, store-connectors-expansion) decision d01 as edited ("we want a
  person entity now so figure that out first") + d11; grill #001 (structured location) Q1 option B.

## Context

Person facts currently live in two places that drift independently:

- `ConversationRecord` (`src/store/types.ts`) caches contact display fields (name, headline,
  pronoun, premium/verified, pictures) inside each conversation directory, keyed by `profileId`
  (flagship `ACo…`).
- `StoredConnection` (`src/store/connections-store.ts`) carries the relationship record plus every
  enrichment field — title, company, `location`/`country`/`geoUrn`, about, industry, positions,
  education, skills — keyed by `flagshipId`.

The same human enriched via `enrich` and messaged via `send` therefore has two copies of the same
facts with no rule about which wins. The grill for itsbrex/allman-cli#1 called promoting a person
entity "a store redesign wearing a location feature's clothes" and deferred it behind an ADR; the
plan-#001 review reversed that: person facts keep growing (geo now, company links next, multi-source
enrichment after that), so the entity lands **before** the next fact does.

Both stores already share the join key: `ConversationRecord.profileId` and
`StoredConnection.flagshipId` are the same flagship id. Only flagship-identified people can be
joined; salesnav-only rows from `connections-of` sweeps have no flagship id until
`resolveSalesnavIdsFromFlagshipIds` bridges them.

## Decision

Introduce a **person record** as the single owner of person facts, added incrementally in three
phases. The existing stores are not rewritten.

**Record.** `{account}/people/{flagshipId}.json` plus a `{slug} -> {flagshipId}.json` symlink when
the slug is known (same index convention as `connections/`). Shape:

```
interface StoredPerson {
  flagshipId: string;                  // ACo… — the filename key and the join key
  memberUrn: string;                   // urn:li:fsd_profile:{flagshipId}
  objectUrn?: string | null;           // urn:li:member:{n} — the SalesNav bridge
  publicIdentifier: string | null;     // slug
  // person facts (the fields enrich fills today on StoredConnection):
  firstName, lastName, headline, title, company, companyUrn,
  location, country, geoUrn, geoName, geoGranularity,   // see ADR-0001
  about, industry, industryUrn, pronoun, premium, memorialized,
  positions, education, skills, …
  provenance: { [field: string]: { source: string; observedAt: string } };
  firstSeenAt: string;
  lastSeenAt: string;
}
```

Facts that are about the *relationship* or the *conversation* stay where they are:
`connectedAt`/`source` on the connection record, sync state/read state/unread counts on the
conversation record. Cached display fields on `ConversationRecord` become exactly that — a cache,
refreshed from the person record when both exist.

**Phase 0 — read-only join view (no disk change).** A `readPerson(flagshipId | slug)` store reader
that merges connection record + conversation record at read time, newest `lastSeenAt`/`fetchedAt`
wins per field. This ships first and is the surface the TUI and `connections --geo` build against,
so later phases change no callers.

**Phase 1 — enrich writes person records.** `enrich` writes person facts to `people/` (creating the
record) **and keeps mirroring them onto `StoredConnection`** unchanged, so every existing reader —
including the TUI, which parses the store directly — keeps working. The mirror is declared a
back-compat shim from day one.

**Phase 2 — readers prefer the person record.** `readPerson` prefers `people/` over the mirrors;
the mirror fields on new writes stop being extended (existing ones are never deleted — the store is
git-versioned history).

**Materialization rule.** A person record exists only when a flagship id is known. Salesnav-only
`connections-of` results stay in their search directories until resolved; resolution is the
existing `resolveSalesnavIdsFromFlagshipIds` join, not a new mechanism.

**Writes stay CLI-owned.** Nothing changes about the TUI contract: reads from disk, writes through
the binary.

## Alternatives considered

- **Keep facts on `StoredConnection` (grill Q1 option A).** Was the standing decision; reversed by
  the plan-#001 review because a third and fourth fact family (company links, multi-source
  enrichment per ADR-0004) would each deepen the duplication.
- **Person entity as a rewrite** — migrate both stores to reference `people/` immediately. Killed
  by risk: a git-versioned store rewrite touches every record for zero new capability, and the TUI
  reads these files directly; a phased mirror keeps every existing reader green.
- **Key by slug.** Slugs are mutable and absent on salesnav-only rows; flagship id is the stable
  key the stores already share.

## Consequences

- ADR-0001 (structured geo) lands its fields on the person record in Phase 1, mirrored to the
  connection record — the location feature becomes the person entity's first paying tenant.
- The TUI gains one new read surface (`people/`) in Phase 2; until then it needs no change.
- Contacts you are not connected to and connections you never messaged both join cleanly — the two
  stores stop being the implicit person model.
- Tickets: Phase 0 reader; Phase 1 enrich dual-write + provenance; Phase 2 reader preference;
  TUI follow-up to read `people/`.
- Revisit if LinkedIn ever changes flagship id stability, or if person records need to represent
  people with no LinkedIn identity (out of scope today).
