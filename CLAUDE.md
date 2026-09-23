# CLAUDE.md — allman-cli

LinkedIn messenger CLI. File-backed, git-versioned, designed for AI agents and humans.

## Stack

- **Bun** (latest via asdf) — runtime and build tool
- **TypeScript** (strict) — language
- **commander** — CLI framework
- **playwright** (Chromium, headed) — browser auth only
- **axios** + **tough-cookie** — HTTP client
- **tunnel** — HTTP proxy support
- **simple-git** — git auto-commit
- **vitest** — testing
- **biome** — lint + format

## Architecture summary

See `PLAN.md` for full details. Short version:

```
src/index.ts                 CLI entry (commander)
src/commands/                One file per subcommand
src/linkedin/auth/           Playwright-based interactive login
src/linkedin/api/            Axios client with LinkedIn headers + cookie management
src/linkedin/realtime/       SSE stream client with reconnect
src/activity/                Private processing journals, daily metrics and passive loopback viewer
src/relationships/           Pure rank, ICP evidence and observed graph logic
src/store/                   File store: RECORD.json files + JSONL messages + git
src/utils/                   URN helpers, slug extraction, output formatting
tests/unit/                  Unit, mocked network and real local CLI integration tests
```

## Activity accounting

Read [live activity](docs/live-activity.md) before changing activity counters. The
viewer must remain a local observer: no LinkedIn session, send, draft, invitation,
CRM write, remote asset, or extra active profile. Start processing only after the
shared session guard succeeds. Journal explicit projections outside store Git;
never copy raw API payloads, cookies, headers, URLs, or message bodies.

Unique people, company records, quota-charged attempts, HTTP dispatches, and repeated
saves are different measures. Read full journals rather than the 200-event UI tail.
Preserve retained quota history before pruning and reconcile duplicate ledger/journal
charges. Skips cost no slot; failures do. Join Sales Navigator only through unique,
consistent numeric member IDs; display unresolved identities separately. Calendar
days follow local timezone; quotas stay rolling and account-specific. Display actual
overrides and label all limits as Allman policy, never official LinkedIn allowances.
Keep historical gaps explicit; a saved Sales Navigator cookie is not a live plan check.

## Relationship intelligence

Read [docs/agents/relationship-intelligence.md](docs/agents/relationship-intelligence.md)
before changing rank, ICP, groups, or graph behavior. These commands operate on local
evidence and must not initialize LinkedIn sessions, send/draft messages, or call model
providers. Fit and relationship strength remain separate. Profile enrichment is not
connection evidence; unknown strength and missing fit evidence stay unknown.

Store Git must own its `.git` boundary and clear inherited repository-routing and
interactive executable overrides. Hooks can supply `GIT_INDEX_FILE`; never let a store
write to its parent's index. Preserve Git identity variables and normal config files.

Release packaging is a dry run by default. Publication requires `--publish --repo`
and matching origin fetch/push repositories; never hardcode upstream as a write target.

## File store layout

```
.allman/
├── .git/
├── {myProfileId}/
│   ├── AUTH.json                    # profile info, auth status (committed)
│   ├── COOKIES.json                 # cookie jar (gitignored)
│   ├── config.json                  # proxy, rate limits (committed)
│   ├── rate-state.json              # last send timestamp (gitignored)
│   ├── query-cache.json             # cached flagship search queryId (gitignored)
│   ├── {convId}/
│   │   ├── RECORD.json              # contact + conversation + sync state
│   │   └── messages/YYYY-MM.jsonl
│   ├── connections/                 # `connections`: {flagshipId}.json + {slug} symlinks
│   ├── connections-of/{targetId}/   # `connections-of`: RECORD.json + per-result files + symlinks
│   ├── {profileId} -> {convId}      # symlink: contact profile ID → conversation
│   └── {slug} -> {convId}           # symlink: LinkedIn slug → conversation
└── {accountSlug} -> {myProfileId}   # symlink: account slug → profile dir
```

Slug = the LinkedIn `publicIdentifier` (e.g. `linkedin.com/in/sarah-chen` → `sarah-chen`).

## Critical patterns

### Cookie management
Every API call must:
1. Read cookies and captured browser identity from private, gitignored `{profileId}/COOKIES.json`
2. Filter out expired cookies
3. Build `Cookie:` header string
4. Extract `csrf-token` from `JSESSIONID` value (strip surrounding quotes)
5. After response: parse `Set-Cookie` headers with `tough-cookie`, merge by name, and save back with the captured request identity

`AUTH.json` is Git-tracked public account metadata. Never pass the merged `AccountRecord`
to `writeAuth`: it includes cookies. Read `readAuth()` when changing authentication status,
including logout. `allman status` is a local check; `status --check` verifies the session and
owner remotely. Login must verify Shield before cookie access or browser navigation.

### URN construction for send
```
conversationUrn in payload: urn:li:msg_conversation:(urn:li:fsd_profile:{senderUrn},{conversationUrn})
mailboxUrn: urn:li:fsd_profile:{senderUrn}
originToken: UUID v4
trackingId: UUID v4 converted to byte array (see existing message-sender.ts)
```

For **new conversations** (no existing thread), omit `conversationUrn` from the `message` object
entirely — do not set it to empty string. LinkedIn returns 400 if it is present but malformed.

### Rate limiting
Outbound message sends are rate-limited per account. Default: 3000ms between sends.

- Enforced inside `LinkedInApiClient.request()` on every `POST` to the messages endpoint
- State persisted to `rate-state.json` (`lastMessageSentAt`) — survives process restarts
- Configurable via `config.json`: `rateLimit.minMessageIntervalMs`
- **All send paths are automatically rate-limited** — no per-command opt-in needed

### Volume quotas (enrichment + invitations)
Enrichment and connection requests are the two most account-sensitive surfaces,
so they carry **persistent rolling-window volume caps** on top of the spacing
throttles. Defaults are seat-aware — a Sales Navigator seat is the signal that
an account is provisioned for higher-volume work:

| | with SalesNav seat | without |
|---|---|---|
| enrichment | 100 / hour | 25 / day |
| connection requests | 40 / day | 10 / day |

- Implemented in `utils/quota.ts` (pure rolling-window counter) +
  `utils/account-quota.ts` (store binding). Ledgers persist as timestamp arrays
  in `rate-state.json` (`enrichmentTimestamps`, `inviteTimestamps`), so **caps
  survive process restarts** — ten `enrich` runs don't each get a fresh
  allowance.
- Quotas **refuse rather than sleep** (windows are hours/days; blocking would
  hang the CLI). `enrich` stops early and reports when capacity returns;
  `connect` exits non-zero.
- A slot is claimed *before* the request and only for work actually done —
  skipped (already-enriched) records don't burn quota.
- **Counting unit differs by backend**, deliberately: flagship `enrich` charges
  **per profile** (matches the user-facing "100/hour"), while the SalesNav
  connections sweep is a bulk list operation charged per *page* of up to 100
  people — it is not billed as per-person enrichment.
- Override per account in `config.json` → `rateLimit`: `maxEnrichments`,
  `enrichmentWindowMs`, `maxInvitesPerDay`, `minInviteIntervalMs`.

### SSE parsing
Stream from `https://www.linkedin.com/realtime/connect?rc=1` with `Accept: text/event-stream`.
Lines arrive as `data: {JSON}`. Extract event type from `topic` field via:
`topic.match(/:(\w+):urn:li-realtime/)` → group 1 is the event type key.

### stdout vs stderr
`allman listen` streams NDJSON to **stdout**. All logs, errors, debug output go to **stderr**.
This separation is mandatory — agents parse stdout.

## Commands

```
allman login [--account <slug>] [--proxy host:port[:user:pass]]
allman logout [--account <slug>]
allman status [--account <slug>] [--json]
allman sync [--account <slug>] [--since 3mo|6mo|1y|YYYY-MM-DD]
allman listen [--account <slug>]
allman conversations [--account <slug>] [--json] [--limit N]
allman messages <contact-slug|url|urn> [--account <slug>] [--json] [--limit N]
allman send <contact-slug|url|urn> <text> [--account <slug>] [--json]
allman connections [--salesnav|--flagship] [--limit N] [--csv <path>] [--no-save] [--include-headline] [--enrich [--deep]] [--json]
allman connections-of <slug> [--flagship|--salesnav] [--limit N] [--csv <path>] [--no-save] [--json]
allman enrich [target] [--deep] [--force] [--limit N] [--json]
allman connect <slug|url|urn> [--note <text>] [--dry-run] [--json]
allman store path|commit|status
```

### Connections (network export)
- `connections` (your 1st-degree) uses flagship `relationships/dash/connections`; `connections-of`
  defaults to Sales Navigator (`salesApiLeadSearch`) and falls back to flagship people search
  (`voyagerSearchDashClusters`) when there's no SalesNav seat. `--flagship`/`--salesnav` force a
  backend (no fallback). IDs only — never fetch a profile page.
- SalesNav seat = the `li_a` cookie that `login` captures by visiting `/sales/` (best-effort,
  `--no-salesnav` to skip). The flagship search queryId rotates per deploy and is auto-discovered
  from the live bundle (headless) and cached in `query-cache.json`; `ALLMAN_SEARCH_CLUSTERS_QID`
  overrides.
- Both commands **store by default** (per-entity files + slug symlinks via `ConnectionsStore`,
  git-committed, idempotent firstSeenAt/lastSeenAt). `--csv <path>` also exports; `--no-save` skips
  the store; `--json` streams NDJSON to stdout without storing. Pages are paced with a random 2–8s
  delay (`utils/random-delay.ts`).

### Connections backends (`connections --salesnav|--flagship`)
Two backends with **different identity models** — this is the thing to understand
before touching either:

| | flagship | Sales Navigator |
|---|---|---|
| resource | `relationships/dash/connections` | `salesApiLeadSearch` + `RELATIONSHIP:F` |
| identity | flagship id (`ACo…`) + **public slug** | salesnav id (`ACw…`) + **numeric member id** |
| profile data | none (needs `enrich`, 2 req/person) | title, company, location, about **inline** |
| page size | 100 | 100 (not 25) |
| depth cap | **none** observed | **2500, hard** — `start=2500` → HTTP 400 |
| extras | `connectedAt` | `degree`, `pendingInvitation` |

- **Default: flagship, always.** SalesNav is opt-in via `--salesnav` despite
  being richer, because its 2500 wall silently truncates any larger network.
  Don't "improve" this by defaulting to the seat.
- SalesNav results live in `connections-salesnav/{memberId}.json`, not merged
  into `connections/`, because the search returns no flagship id or slug.
- **The join key exists**: `salesApiProfiles?ids=List(...)` takes *flagship* ids
  and returns salesnav ids, **100 per request** (150 → 400) —
  `resolveSalesnavIdsFromFlagshipIds`. It is a genuine batched lookup over a
  known id set.
- **There is no per-person SalesNav enrichment.** `salesApiProfiles` with a
  field projection returns 400, and without one returns empty shells; rich
  SalesNav data only comes from the search sweep. Do NOT rebuild "SalesNav
  enrichment" by scanning the sweep for particular people — that is a
  brute-force search wearing a lookup's clothes, and it reads thousands of
  profiles to find a handful. Bulk SalesNav data belongs to
  `connections --salesnav`, where enumerating IS the operation.
- Only flagship records have slugs, so only they are usable as
  `allman send <slug>` / `connect <slug>` targets without a lookup.
- Not found (guessed names, all 404): `salesApiConnections`, `salesApiMyNetwork`,
  `salesApiRelationships`, `salesApiLeadLists`, `salesApiSavedLeads`. If a
  higher-capacity SalesNav enumeration endpoint exists, find it by driving the
  SalesNav UI in a browser and watching the network tab — don't guess names.

### Enrichment (`enrich`, `connections --enrich`)
- `connections` stores IDs + name + headline only. `enrich` does the per-profile
  fetch that fills in **title, company, location, about** (and, with `--deep`,
  work history + education + skills), writing them back onto each connection
  record with an `enrichedAt` / `enrichDepth` stamp. Idempotent: skips
  already-enriched records unless `--force` (a core→deep upgrade re-fetches).
- **Split across four resources** (all `identity/dash/*` API calls, not
  profile-page scrapes, so the `no-profile-pages` guard still holds):
  `profiles?q=memberIdentity` (name/headline/location/about),
  `profilePositions?q=viewee` (title/company/history),
  `profileEducations?q=viewee`, `profileSkills?q=viewee`.
  The core resource carries **no** positions/education/skills — verified against
  live responses — so title/company *always* costs a second request. Core = 2
  requests/profile, `--deep` = 4. The `?q=viewee` sub-resources take no
  decorationId, so they're immune to decoration rotation; only the core one
  needs `ALLMAN_PROFILE_DECORATION` if LinkedIn rotates it. `memberIdentity`
  accepts a slug **or** a flagship profile id.
- **Order matters**: `included[]` is unordered — resolve `data["*elements"]` to
  get LinkedIn's display order. Someone with several concurrent roles (CTO at
  one company, venture partner at another) reports the wrong current employer
  if you trust `included[]` order. Same idiom as `parseConnectionsResponse`.
- Location lives at `profile.geoLocation["*geo"]` → resolve into `included`.
  Never fall back to "any Geo in the graph": the graph also carries a
  country-level Geo, which silently downgrades a metro area to "United States".
- The legacy `identity/profiles/{slug}/profileView` aggregate (one call for
  everything) now returns **HTTP 410 Gone**.
- Fetches are paced with the same random 2–8s page delay. `enrich <slug>`
  enriches one person (adding them to the store if new).

### Connection requests (`connect`)
- `POST voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2`
  with `{ invitee: { inviteeUnion: { memberProfile } }, customMessage? }`; success =
  an `invitationUrn` in the response. Sent invites are stored under
  `{profileId}/invitations/{inviteeId}.json` (+ slug symlink).
- **Conservative by default**: refuses to re-invite anyone already in
  `connections/` or already recorded in `invitations/`; caps the note at 300
  chars (`MAX_NOTE_LENGTH`); rate-limits invites on their **own** slow throttle
  (`rateLimit.minInviteIntervalMs`, default 60s, persisted as
  `rate-state.json:lastInviteSentAt`). A 403 is surfaced as a likely
  invitation-quota hit. `--dry-run` previews without sending.
- The pre-check is **local by necessity**: LinkedIn's `memberRelationships`
  REST resource returns HTTP 400 for every documented URL form (verified live
  2026-08-08; the `MemberRelationshipV2` decoration still exists in the bundle,
  so the data moved behind GraphQL). See `endpoints/relationships.ts`. A store
  miss means "not known locally", not "definitely not connected" — LinkedIn
  still rejects true duplicates server-side.

## Environment variables

```
ALLMAN_STORE        Override saved `allman store use` selection (fallback: ./.allman)
ALLMAN_ACCOUNT      Default account slug
ALLMAN_PROFILE      Named configuration under ~/.config/allman/<name> (shared session lock)
ALLMAN_SEARCH_CLUSTERS_QID  Override the flagship people-search queryId (else auto-discovered)
ALLMAN_PROFILE_DECORATION   Override the `enrich` profile decoration (else FullProfile default)
ALLMAN_BROWSER              Browser for login/capture: browseros-neo | browseros | chromium | Playwright channel
ALLMAN_BROWSER_WORKSPACE    Persistent browser config and profiles (default: ~/.allman/browser-workspace)
ALLMAN_RELATIONSHIP_STORE   Private mail/ICP workspace override; must remain outside the Git store
ALLMAN_SHIELD_PATH          Mandatory LinkedIn Shield runtime build (or set with browser configure)
ALLMAN_BROWSER_PROFILE      Persistent browser profile dir (login --profile)
ALLMAN_CDP_URL              Attach to a running browser over CDP (login --cdp); Chrome 136+ needs a non-default --user-data-dir
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH  Explicit browser executable (wins over channels)
```

## Development

```bash
bun install
bun run dev          # runs src/index.ts directly
bun run test         # vitest (bun test invokes a different runner)
bun run typecheck    # tsc --noEmit
bun run build        # guarded, atomic Playwright-aware compile → dist/allman
```

Never install packages without using `bun add <package>` (or `bun add -d <package>`
for dev deps). Always install to get the latest version — don't assume a version exists.

### Running the local dev version

`bun run link` symlinks `~/.local/bin/allman` at `bin/allman`, a shim that execs
`bun src/index.ts`. So `allman` on PATH is the working tree — no rebuild between an edit and the
next run, and no `dist/allman` to go stale.

```bash
bun run link           # ~/.local/bin/allman -> ./bin/allman
bun run link --force   # ...moving an installed allman aside first
bun run unlink         # remove it, restore whatever was displaced
```

An `allman` already installed by `install.sh` is never silently overwritten: `--force` moves it to
`allman.pre-dev-link` and `unlink` puts it back. Override the target directory with `--dir` or
`ALLMAN_LINK_DIR`.

`allman-tui`'s own dev shim looks for `bin/allman` in a sibling checkout of this repo, so linking
both means the dev TUI drives the dev CLI.

### Pre-commit

husky + lint-staged run on every commit: biome over staged `src`/`tests` files, then
`bun run typecheck`, then `bun run test`. Don't reach for `--no-verify`; fix the failure.

## Testing

Unit tests: `tests/unit/` — no network, no filesystem side effects (use temp dirs).
Command integration tests also live in `tests/unit/` — mock network responses and assert store behavior. Live checks require a separate private store and explicit read-only scope.

Use `vitest`'s `vi.mock` for axios. Use real temp directories (via `os.tmpdir()`) for
store tests — don't mock the filesystem.

Recorded LinkedIn API fixtures go in `tests/fixtures/`.

## Agent skills

### Issue tracker

All ticket writes go to the fork, `itsbrex/allman-cli`; upstream `tarkaai/allman-cli` is a
read-only source (no push access). Never write a bare `#N` — always `owner/repo#N`.
See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, label string equal to role name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root plus ADRs in `docs/adr/`. See `docs/agents/domain.md`.

### Persistent browser protection

`allman browser configure --browser browseros-neo --shield /path/to/linkedin-shield/dist` verifies and saves browser defaults. `allman browser doctor --json` checks the running extension. Every login/capture uses a persistent profile and must verify Shield before LinkedIn navigation; no unprotected fallback or ephemeral context is allowed. Capture profiles are separate per account. CDP uses the existing default context, never injects cookies, and capture requires a matching LinkedIn session. See `docs/browser-support.md`.

For another LinkedIn account, isolate the store, `ALLMAN_BROWSER_WORKSPACE`, and browser profile together. Clear inherited CDP/browser overrides in its dedicated launcher; never copy the original account's cookies or change the user's global store selection. Use the same verified Shield build and require manual sign-in to the new identity. See [isolated accounts](docs/browser-support.md#isolated-accounts).

Keep only one LinkedIn profile active across this user's Allman launchers. Use
`session register`, `session activate <name>`, and `session status`; do not switch
stores to bypass the active selection. `session-control.ts` owns the shared
process lock and CLI network-command classification. An empty `connections --geo`
array is the network default, not a local query. `status --check` resolves exactly
one account. New commands that can reach LinkedIn must remain guarded; local-only
commands must not initialize a session. Browser overrides and Neo MCP routing
cannot bypass a registered CDP binding. Direct library consumers must go through
the CLI guard or explicitly acquire/check session control themselves.

Named configuration uses `ALLMAN_PROFILE` or shared `default-profile.json`.
Keep `allmanConfigRoot()` separate from `profileConfigRoot()`: the shared command
lock and session registry must never follow a per-profile configuration directory.
The selected store, browser workspace, private mail/ICP data, and dedicated browser
data can live under `~/.config/allman/<name>/`; ordinary user browser data stays put.
Preserve path aliases and hashed-workspace access during relocation. See
[profile folders](docs/profile-folders.md).

`profile-pause.ts` adds only its reserved dynamic Shield rule to inactive
registered browsers, closes their LinkedIn tabs, and preserves other tabs and
privacy rules. Switches block inactive browsers before enabling the selected one;
failed verification leaves CLI access paused. Never disable Shield or remove the
pause rule to work around an inactive-account error. See
[single-profile control](docs/single-active-profile.md).

For a full connection baseline, enumerate flagship connections first, optionally export Sales Navigator's separate capped namespace, then run bounded `enrich --deep` batches. Report stored counts, failures, and quota exhaustion explicitly; Sales Navigator is not the deep-profile backend. Keep one enrichment process per account and retain the quota ledger. See [connection baseline](docs/connection-baseline.md).


### Read-only command QA

- Never run `send`, `react`, or `connect` against live accounts during a read-only QA run. Their unit tests use synthetic identities and mocked network clients; success text from those tests is not a live receipt.
- Use a private disposable store/workspace and copy the current quota ledger before bounded live reads. Preserve accounting for consumed quota; do not advance the user's history or inbox watermarks.
- `connections --enrich` must use the same persisted `AccountQuota` as standalone `enrich`. Failed profile fetches count toward `--limit`; skipped stored records do not.
- Use one observation timestamp for fetched person facts and their stored enrichment metadata. Do not take a second clock reading while applying the same fetch.
- Sales Navigator exports core fields inline into their own namespace. Full `--deep` enrichment requires flagship identities; reject flags that would otherwise silently skip requested work.
- Apple Mail ingestion requires the server's `export_emails_page` tool. An older global launcher can list accounts but cannot ingest; select the capable checkout with `mail configure --command` before testing.

- Latest bounded live command coverage and limitations: [2026-09-22 validation](docs/qa/2026-09-22-command-validation.md). Receipts contain counts only, not credentials or contact data.
- Preserve case in opaque LinkedIn IDs; only vanity handles may be lowercased. CLI limits/page sizes must fail before store or network access when not positive safe integers.
