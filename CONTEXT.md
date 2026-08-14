# CONTEXT

The shared vocabulary for allman-cli. Read this before exploring the codebase; use these terms in
issue titles, test names, refactor proposals, and hypotheses. `CLAUDE.md` holds the operational
rules (stack, commands, endpoint quirks) — this file holds the language.

This is a **seed glossary**, derived from terms already resolved in `CLAUDE.md` and the code.
`/grill-with-docs` and `/domain-modeling` sharpen it as new terms come up. When the two files
disagree about a fact, `CLAUDE.md` wins and this file gets corrected.

## Identity

LinkedIn hands out several IDs for the same human. They are never interchangeable, so **never write
"profile ID" unqualified** — always say which one.

| Term | Shape | Where it comes from |
| --- | --- | --- |
| **flagship id** | `ACo…` | flagship `relationships/dash/connections`, `identity/dash/*` |
| **salesnav id** | `ACw…` | `salesApiLeadSearch` |
| **member id** | numeric | SalesNav results; `urn:li:member:{n}` |
| **slug** | `sarah-chen` | LinkedIn `publicIdentifier`; the URL segment after `/in/` |
| **URN** | `urn:li:fsd_profile:{id}` | any API payload |

Only flagship records carry a slug, so **only they are directly usable as `send <slug>` /
`connect <slug>` targets**. `resolveSalesnavIdsFromFlagshipIds` is the one genuine join between the
two id spaces (batched, 100 per request).

**Account** = the logged-in LinkedIn identity this CLI acts as. Its own id is the
**myProfileId**, which names the top-level store directory; the **account slug** is a symlink
pointing at it. Never call the account a "user" — a user is the human at the terminal.

## Backends

**flagship** and **Sales Navigator** are the two API surfaces, and the distinction is load-bearing —
they differ in identity model, page size, available fields, and depth cap. Say which one you mean.
Never say "the LinkedIn API" when the answer differs between them.

**SalesNav seat** = the `li_a` cookie captured at login. Its presence is the signal that an account
is provisioned for higher-volume work, and it selects the seat-aware quota tier.

## People and relationships

| Term | Means | Don't say |
| --- | --- | --- |
| **contact** | a person on the other side of a **conversation** | "lead" |
| **connection** | a 1st-degree relationship record from `connections` | "friend", "contact" |
| **invitation** | an outbound connection request sent by `connect` | "invite request", "add" |
| **connections-of** | a sweep of *someone else's* connections (network graph) | "2nd degree scrape" |

Contacts and connections live in **separate stores** and are not the same set — someone can be a
connection you have never messaged, or a contact you are not connected to. The LinkedIn/SalesNav
API says "lead"; our domain says **connection**.

## Storage

The **store** is `.allman/` — file-backed, git-versioned, one directory per account. A
**conversation** directory is named by its **convId** and holds a `RECORD.json` (contact +
conversation + sync state) plus month-partitioned JSONL under `messages/`. **Symlinks** (slug →
convId, profile id → convId, account slug → myProfileId) are the lookup index; there is no database.

**Sweep** = a bulk paged enumeration (`connections`, `connections-of`) where enumerating *is* the
operation. Contrast **enrich**, which is a per-person fetch. Do not implement a lookup as a sweep.

## Pacing

Three distinct mechanisms — do not use one word for all of them.

| Term | Mechanism | On limit |
| --- | --- | --- |
| **throttle** | minimum spacing between two calls (`minMessageIntervalMs`, `minInviteIntervalMs`) | **sleeps** |
| **quota** | rolling-window volume cap (`maxEnrichments`, `maxInvitesPerDay`) | **refuses** |
| **page delay** | random 2–8s between pages of a sweep | sleeps |

A quota **slot** is claimed before the request and only for work actually done — a skipped
already-enriched record does not burn one. Ledgers persist in `rate-state.json`, so caps survive
process restarts.

## Enrichment

**Enrich** fills in title, company, location, and about on a connection record that the sweep only
gave IDs and a headline for.

- **core** = 2 requests/profile (`profiles`, `profilePositions`)
- **deep** = 4 (adds `profileEducations`, `profileSkills`)

`enrichedAt` / `enrichDepth` stamp the record and make the operation idempotent. There is **no
per-person SalesNav enrichment** — rich SalesNav data only comes from the sweep.

## LinkedIn's moving parts

**queryId** and **decoration** are opaque identifiers LinkedIn rotates per deploy. They are
discovered at runtime and cached (`query-cache.json`), never hardcoded. When something returns 400
for no apparent reason, a rotated queryId or decoration is the first hypothesis.

## Output contract

`allman listen` streams **NDJSON to stdout**; every log, error, and debug line goes to **stderr**.
This split is a contract, not a convention — agents parse stdout.
