# Deep enrichment from an Attio company list

Choose any accessible Attio **company** list. Only exact LinkedIn identities already stored as connections in the invoked Allman account enter the shortlist. A run uses one guarded browser preflight and one authenticated API client for the entire batch. No Attio records are written.

## CLI

Use your usual account launcher (`allman-jp`, for example), or explicit `ALLMAN_PROFILE` / `--account` / `--store` selection. Use the same selection for every command:

```sh
allman-jp enrich-list lists --json
allman-jp enrich-list prepare <LIST_ID> --json
allman-jp enrich-list run <RUN_ID> --json
allman-jp enrich-list status <RUN_ID> --json
allman-jp enrich-list review <RUN_ID> --html --json
allman-jp enrich-list history --json
```

`prepare` returns the run ID, selected/saved/pending counts and private report path. For an Attio list it reads Attio and local connection files without starting LinkedIn. Sales Navigator preparation uses one guarded LinkedIn session for list reads and identity lookup. `review --html` returns a private self-contained HTML file with the same report. Open the returned `htmlPath` locally. The generic template is `apps/target-enrichment.html`, created through Plans/Appkit; it can also import any generated `review.json`.

Every review table cell links to its entity or local evidence. Compact icons distinguish Attio, LinkedIn and websites; multiple company domains have separate links. Green findings indicate matches, amber indicates employer review, rose indicates identity problems, blue indicates account gaps and violet indicates hints. Filters and saved decisions have subtle feedback that respects reduced-motion settings. Unknown destinations open evidence rather than a guessed external URL.

Older runs can acquire official Attio record links without changing the sealed shortlist or fetching LinkedIn profiles:

```sh
allman-jp enrich-list review <RUN_ID> --refresh-links --html --json
```

This refresh reads Attio and saves a separate private link snapshot for subsequent reviews. Ordinary `review --html` reuses that cache. Newly prepared runs already retain official record URLs.

Run the same `run <RUN_ID>` command to resume. Saved deep profiles skip without browser work when the entire batch is already complete. `--limit 10` caps newly fetched profiles for that invocation; a subsequent run continues the same shortlist. No force-refresh or account-wide fallback exists in this workflow.

Authentication uses `ATTIO_API_KEY` or `ATTIO_ACCESS_TOKEN`. To reuse this machine's configured connector without copying its credential:

```sh
allman enrich-list auth --codex-config "$HOME/.codex/config.toml" --json
```

This stores only a local file reference. It reads `mcp_servers.attio-code-mode.env.ATTIO_API_KEY` in memory. Unresolved secret-manager references are rejected; provide the resolved token through the environment instead. Connector-reference authentication requires the Bun runtime or compiled CLI.

`prepare <LIST_ID> --snapshot /private/snapshot.json` supports a previously exported complete snapshot. Pending runs still recheck live Attio membership before LinkedIn requests. A snapshot must have the typed, complete schema in `src/attio/lists.ts`; partial queries are never accepted as complete lists.

## TUI

Launch in the intended profile, then enter `:enrich-list`:

```sh
ALLMAN_PROFILE=jp ALLMAN_ACCOUNT=jp allman-tui
```

The TUI now honors the CLI's selected profile store. Explicit `ALLMAN_STORE` still takes precedence; without a profile selection, the historical `$HOME/.allman` fallback remains.

1. Type a list name or ID, use arrows, then Enter to prepare.
2. Inspect account, list, selected, saved and pending counts.
3. Press **R** to run or resume. One child process owns the whole batch.
4. Press **V** to generate and open the HTML review.
5. Esc during a run requests a graceful stop after the current profile; Esc when idle returns to the list picker.

Profile switching and concurrent LinkedIn operations remain subject to Allman's existing active-profile guard and command lock. The selected TUI account is passed explicitly for every operation.

## Scope, safety and evidence

- Full Attio pagination, with company filters chunked to 50 IDs. Missing company coverage and pagination caps fail closed.
- Match by stable flagship ID, normalized LinkedIn URL, or explicit handle. Conflicting identity evidence, departed-company flags and ad-hoc enrichment records are excluded. Names and headlines only produce review hints.
- Deduplicate multiple Attio people records referencing the same stored person.
- Private sealed plans bind list snapshot, immutable target IDs, account and canonical store path. New list members never expand a running shortlist.
- Before pending work starts, re-read the company list and verify every pending identity still qualifies. Membership changes require preparing a new shortlist.
- Keep random 2–8 second inter-person pacing and persisted account quota. No concurrency, quota override or automatic retry.
- Fetch by immutable identity. Verify provider identity and all four deep-profile requests before saving. Stop on the first failed request, including errors normally tolerated by optional subresource parsers.
- Deep/raw connection and person read-back follows each successful save. One derived-export refresh follows the batch; export failures do not erase source observations.
- Run state and review artifacts live outside the Git-backed LinkedIn store, under the account's private relationship workspace. HTML contains private CRM/profile data; the repository template contains none.

Employer checks inspect all current roles, compare numeric company IDs first, and flag conflicting IDs even when names match. Findings can reflect job changes, subsidiaries or stale company mappings; they are review prompts, not confirmed departures. Unmatched rows explain missing identity versus identity absent from this account, and expose exact-name candidates only for manual verification. Local company/headline hints are never automatically enriched.

Profile drawers display linked work and education timelines, readable date ranges, and named skills. The highlighted latest recorded job change is the newest dated role start as of the report snapshot; it may be an internal role change, and undated roles are disclosed. Education preserves year-only dates and does not infer that a missing end date means current enrollment. Company and school links use stored LinkedIn company IDs; when absent, links open the source profile.

HTML notes and Verified/Investigate/Skip decisions stay in browser local storage, scoped by account and run. Export decisions to retain or share them deliberately. They do not edit Attio. CSV values that resemble formulas are escaped.

## Optional local Plans route

```sh
ALLMAN_PROFILE=jp bun run enrichment:build
ALLMAN_PROFILE=jp bun run enrichment:serve
```

These commands select JP's newest saved review JSON/HTML. Substitute another profile
name for another account. `enrichment:build` uses saved JSON only; `enrichment:review
RUN_ID` regenerates from the local store. Neither starts enrichment. If no saved run
exists, inspect `allman-jp enrich-list history`; preparing a new list is a separate
provider operation.

Open <https://allman-enrichment.localhost/apps/target-enrichment.html>. The loopback
server serves one selected private file, rejects foreign origins/hosts, uses a
script-hash CSP and disables caching. HTML and CSP reload together on each request;
restart only to select another run. `ALLMAN_REVIEW_HTML` can point to an existing
explicit file; `/absolute/private/review.html` was a placeholder, not a real path.
See [app commands](../apps/README.md) for rendering recovered JSON into a fresh
`artifacts/local/` directory. No public deployment is involved.

## Verification

```sh
bun run test tests/unit/attio-targets.test.ts tests/unit/attio-target-runner.test.ts --maxWorkers=2
bun run enrichment:qa
bun run typecheck
```

The companion TUI has account/store forwarding, prepare-before-run and profile-store regression tests. Appkit provenance is in `.appkit/lock.json`; use `appkit diff` before future template upgrades so project customizations remain intact.

## Sales Navigator lead lists

Paste a lead list URL into the same workflow. The current account must have an authenticated Sales Navigator seat and access to that list:

```sh
allman-jp enrich-list prepare 'https://www.linkedin.com/sales/lists/people/7508689992186191872?sortCriteria=CREATED_TIME&sortOrder=DESCENDING' --json
allman-jp enrich-list review <RUN_ID> --html --json
allman-jp enrich-list run <RUN_ID> --json
```

In the TUI's `:enrich-list` picker, paste the URL and press Enter. **R** starts the prepared shortlist; **V** opens its review. Sales Navigator preparation works even when Attio credentials are unavailable. Any account launcher can use this workflow; plans and identity caches remain scoped to that account and store.

Preparation reads every list page, validates total/offset/revision and rejects duplicates or partial responses. This adapter uses the same internal read endpoint observed in Sales Navigator's current web client; provider changes may require an adapter update. Authentication, rate-limit and shape errors stop the command. It never changes lead-list membership.

Sales Navigator uses different profile IDs from ordinary LinkedIn. Preparation now
saves every imported member to private `import.json` and `import.csv` **before**
reading identity caches. JSON retains each returned row and its profile context.
It matches existing account-scoped mappings and numeric member IDs locally; it
never maps the account's entire connection store. All members remain visible in
the saved plan even if they cannot yet be matched. `identitiesDeferred` reports
unresolved members separately from selected stored connections.

Only `enrich-list run` resolves remaining missing identities. It validates current
membership, refreshes opaque profile context for sealed members, then requests
individual `salesApiProfiles` records for those members only. Exact returned
Sales Navigator IDs must match; flagship URLs are matched against this account's
stored connections. Names never substitute for identities. Non-connections and
identity conflicts stay excluded from deep enrichment.

Each successful resolution is saved immediately to run-scoped `identities.json`;
review/status and subsequent runs reuse it locally. Exact positive stored-connection matches also update the account identity cache for reuse across lists. A 429 or malformed response
stops the run without losing the import or earlier resolutions. Resolution and
deep enrichment share one guarded browser session. Each live identity lookup
consumes a local enrichment quota slot, in addition to any later deep profile
fetch. `--limit` bounds deep profiles, not identity lookup requests.

To reuse a saved import without requesting list pages again:

```sh
allman-jp --json enrich-list prepare 'ORIGINAL_LIST_OR_SEARCH_URL' --import /absolute/path/to/import.json
```

The import must belong to the same account, store and canonical source URL.
This deliberately uses the saved membership snapshot; `run` still rechecks live
membership. Imports retained after a cache error can be recovered the same way.

A pending run rechecks live lead-list membership inside its single authenticated session before fetching any deep profiles. New list members cannot expand the sealed queue. Fully resolved, deep-saved batches skip without opening a browser. Sales Navigator source links appear beside ordinary LinkedIn links. `--refresh-links` applies only to Attio; prepare again to refresh a Sales Navigator list snapshot.

## Career review

The review offers 30/90/180/365-day change windows, relative to the saved list snapshot date, plus filters for same-employer role changes, employer moves, overlapping roles, or uncertain evidence. Date windows include a partial date only when its entire possible range fits. Year-only dates never imply a precise month.

Classification compares the latest and previous dated roles using exact company IDs. A different title at the same employer indicates an internal role change; it does not prove promotion. Missing IDs, ambiguous dates, and concurrent roles remain explicit. Employer moves are inferences from saved history, not independently verified departures.

Each person's detail drawer constructs a linked career summary directly from saved current roles, transition evidence, and education. No model call or summary export is needed. The drawer retains full readable work/education timelines and highlights the latest recorded role start.

## Filtered Sales Navigator search URLs and diagnostics

`enrich-list prepare` also accepts `/sales/search/people` URLs whose `query` (or
legacy `searchQuery`) explicitly includes exactly one `LEAD_LIST` with one
`INCLUDED` list ID, plus `sessionId`. Copy the full URL from Sales Navigator,
quote it once in the shell, and do not add Markdown brackets or backslash-escape
characters inside single quotes. A `savedSearchId` or `recentSearchId` alone
cannot identify list membership and is rejected.

The adapter preserves the entire query, including region, title and other
filters; it does not replace the search with the full underlying list. Saved
snapshots retain that canonical search URL so run-time membership checks use the
same filters. Multiple/excluded lists, malformed filters, missing sessions,
partial pages and results above 2,500 are rejected. A new session URL may be
needed when the provider expires the original search session.

Parsing follows the local Cleanlist.ai implementation in
`src/background/linkedin.ts` (`checkUrl` / `buildLeadSearchUrlFromQuery`):
one URL decode, preserve nested escaped labels, and pass the original query to
`salesApiLeadSearch`. Nested recent-search IDs are not list IDs. This is an
internal provider endpoint; fixture coverage does not guarantee its live shape.

For request visibility, run `allman-jp logs --follow --source http` in another
terminal. `--debug --raw --json` on preparation also prints endpoint/status to
stderr and persists successful and failed response payloads privately. No auth
headers are archived. A 429 now reports the failing endpoint and the provider's
usable Retry-After, or explicitly says reset time is unknown. Retry-After is a
minimum delay, not proof that restrictions will clear; there is no automatic
retry or invented 60-second cooldown.

Four successful `salesApiPeopleSearch` pages followed by a `salesApiProfiles` 429
means list retrieval succeeded and stored-connection ID mapping was throttled.
That older preparation path has been removed. Positive mappings remain reusable; new preparation saves the import and matches locally. Fresh preparation still rereads list membership; explicit `--import` enables offline reuse. Stop on the provider error and do not run a retry loop.
