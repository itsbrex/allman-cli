# ADR-0001: Structured geo — fields, query surface, migration, staleness

- **Status:** accepted
- **Date:** 2026-08-19
- **Source:** itsbrex/allman-cli#1; grill #001 (2026-08-14, docs/plans/) Rounds 1–2 as decided in
  plan #001 (allman-tui, store-connectors-expansion) d01–d04.

## Context

Enrichment already writes `location` (freeform label), `country` (ISO-3166 alpha-2) and `geoUrn`
(`urn:li:fsd_geo:<id>`) onto `StoredConnection`, and per-position `geoUrn`s in work history — the
grill-era gap ("geoUrn fetched but discarded") was closed by the full-payload work (#33). What is
still missing is granularity, provenance, an index, and any way to ask questions of the data.

## Decision

Four decisions, made together:

**Fields (Q2).** Capture what the graph returns, nothing invented:
`geoUrn` + `geoName` (LinkedIn's label for the geo entity, distinct from the freeform profile
`location` string) + `countryCode` (existing `country`) + `geoGranularity: "metro" | "country" |
"unknown"`. The freeform `location` stays for back-compat. Per ADR-0003 these land on the person
record and are mirrored to `StoredConnection` during the back-compat window.

**No geocoder (Q3).** No lat/lng, no third-party dependency; equality/set-membership on `geoUrn` is
the query primitive. Downstream geocoding happens via `--json` piped to whatever the caller wants.
If timezone is ever needed, ship a tiny static metro→tz map rather than coordinates.

**Query surface (Round 2).** No new top-level command. `allman connections` gains
`--geo <name|urn>` (repeatable, OR-ed) and `--geo-granularity <metro|country|unknown>`, answered
from a **local geo index** — `geoUrn → { name, count }` built from records already on disk,
reporting coverage (`n structured / m total`) so sparse data is visible, not silent. The TUI
exposes the same filter through the `:` palette.

**Migration + staleness (Round 2).** No one-shot backfill: the next `enrich` of a profile writes
structured geo; coverage grows where work is already happening (an optional `enrich --stale-geo`
batch can come later as its own ticket). Every geo write carries a provenance stamp
`{ source, observedAt }`; a re-enrich only overwrites a value of equal-or-worse provenance, and
user-edited values are never auto-overwritten. A store test pins the rule: a re-enrich preserves a
better-provenance location.

## Alternatives considered

- **Parse city/region/country out of the freeform string** — invents precision LinkedIn never
  asserted; killed in the grill.
- **New `allman where` command / extending `search`** — duplicates listing logic / conflates
  message search with people filtering.
- **Eager backfill** — burns enrichment quota on records a future re-enrich rewrites anyway, and
  produces one giant commit in a git-versioned store.

## Consequences

- Deferred to their own tickets: lat/lng + timezone, multi-location-per-person (until a second
  location source exists), contact-level geo for people without connection records.
- The provenance stamp shape here is the seed of the general enricher contract (ADR-0004).
- Revisit the no-geocoder stance only when a real distance/radius use case shows up with an owner.
