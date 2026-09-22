# Read-only command validation — 2026-09-22

Tested code: `3c2d72d`, macOS arm64, Bun 1.4.2, Playwright 1.59.1, BrowserOS Neo attached over CDP, LinkedIn Shield 3.4.0 verified before browser use.

**No live messages, invitations, reactions, drafts, message edits/deletions, or CRM writes.** Outbound commands ran only in synthetic, mocked unit tests. Their “Message sent” output is not a live receipt.

## Evidence and boundaries

- **581 tests passed in 60 files**, TypeScript check passed, Biome check passed (8 existing informational diagnostics), standalone build passed, compiled help/status smoke passed.
- [Sanitized receipts](2026-09-22-command-receipts.json) contain 89 checks. Axios observed 60 GETs and one POST: the existing realtime connectivity heartbeat. Responses: 59 HTTP 200 and two HTTP 404. No blocked mutation attempts.
- An ephemeral Axios guard allowed only LinkedIn GET/HEAD reads and the exact `sendHeartbeat` endpoint/body. `send`, `react`, and `connect` were excluded from the live command runner. The guard does not count browser-native requests or Mail MCP calls; those used the Shield-gated browser reader and the read-only Mail adapter respectively.
- Bulk reads used a private disposable Git store and separate mail/relationship workspace. The account's existing quota ledger was copied first. Nine enrichment attempts and three company lookups were retained in the main ledger after testing.
- Main contact records, conversation history, inbox watermarks, relationship settings, global launchers, and browser defaults were not changed by QA. The verified session and Sales Navigator seat were saved back to the existing account's ignored, mode-0600 cookie file. Its tracked account metadata remained byte-identical. Main-store live status and a one-row ephemeral Sales Navigator export passed afterward.
- The standalone binary was built locally. The existing `allman` development launcher already points at this checkout and runs its current source; no relinking or publication occurred.

## Coverage

| Command family | Tested behavior | Result |
| --- | --- | --- |
| `login`, `status` | Protected CDP login, default Sales Navigator capture, `--no-salesnav`, local status, owner-verified `--check`, JSON | Passed; initial missing seat recovered through normal login |
| `browser configure`, `browser doctor` | Existing Neo attachment, Shield verification, saved configuration in disposable browser workspace | Passed |
| `connections` | Flagship and Sales Navigator first-degree reads across two pages, bounded limits/page size, headline, CSV/`--no-save`, NDJSON, local geo filtering | Passed; three records per backend in initial sample |
| `connections --enrich --deep` | Real inline enrichment after quota fix; stored fields read back | Passed; 12 roles, one education entry, 26 skills in sample |
| `connections --browseros-mcp` | Loopback Neo MCP, Shield gate, offset zero, two rows, JSON | Passed; credentials remained in browser for this path |
| `connections-of` | Explicit flagship and Sales Navigator backends | Passed; two stored results per backend |
| `enrich` | Single URN, bare opaque ID, core/deep/raw, bulk core-to-deep upgrade, skip and force behavior | Accessible profiles passed; one profile returned 404 in two pre-fix bulk attempts |
| `companies` | Single canonical company URN, bulk/current-only, force, local rollup, JSON | Passed; company website and headcount data present |
| `sync` | One-conversation inbox sync, bounded single-conversation sync, from/to window, since alias, resync, JSON | Passed |
| `listen`, `start` | Real streams, controlled shutdown, keepalive | Listen: 45 seconds, connected + two heartbeats. Start: 90 seconds, connected + five heartbeats, client keepalive HTTP 200 |
| `conversations`, `messages` | Local reads, aliases, profile URL target, no-sync, stale refresh, JSON/limits | Passed; stale refresh made one GET |
| `search`, `grep`, `inbox` | Local searches, bounded output, inbox sync, no-mark and normal mark | Passed; watermark changes confined to QA store |
| `store` | `use`, `path`, `status`, `commit` | Passed; saved default confined to disposable XDG config |
| `mail` | Accounts/configure/status, four-account one-page pilot, resume, reconcile | Passed with ingestion-capable checkout; first pilot scanned 73 rows with zero read errors |
| `relationships` | List/show/timeline/status/review/followups/refresh, tag/untag, filters, saved list, cadence, snooze/dismiss/acknowledge | Passed in disposable workspace; 115 contacts in initial live-data snapshot |
| `relationships link/unlink` | Explicit identity link and unlink, persisted readback | Passed with synthetic person/email fixture only |
| `attio` | Candidates/status, synthetic MCP export import, missing-credential guards; query/pagination/correlation unit tests | Local and mocked coverage passed; no live Attio lookup in this run |
| `logout` | Command plus private-cookie and tracked-auth readback | Passed against QA store only; browser remains signed in |
| `install-browsers` | CLI dispatch with mocked `npx`; asserted `playwright install chromium` argv | Passed without download or installation; real installer not exercised |
| Help/version/invalid inputs | Global help/version, compiled help/status, invalid bounds and unsupported connection flag combinations | Passed; invalid input rejected before account/network access |
| `send`, `react`, `connect` | Synthetic unit tests only | Intentionally excluded from live execution |

## Fixed defects

1. **Logout copied private cookies into tracked `AUTH.json`.** It read the merged account record, then spread it into metadata. It now reads auth-only metadata. A real-Git regression test verifies no synthetic token appears in the commit. The user's current tracked auth and history were checked and contained no copied cookie field.
2. **Inline connection enrichment bypassed the persisted quota.** It now loads the same seat-aware quota as `enrich` and reports exhaustion.
3. **Enrichment limit counted successes instead of attempts.** A failed profile could cause `--limit 1` to fetch a second person. Failed network attempts now consume the run limit; already-enriched skips do not.
4. **Enrichment timestamps could differ between facts and stored metadata.** One timestamp captured by the fetch now serves both. A clock-advancing regression test reproduces the original mismatch.
5. **Several flags were silently ignored.** Conflicting backends, standalone `--deep`, Sales Navigator plus enrichment flags, and ephemeral inline enrichment now produce explicit errors. Help correctly identifies flagship as the default first-degree backend.
6. **Invalid bounds reached command execution.** Limits and page sizes now require safe positive integers before store/network access.
7. **Opaque IDs were lowercased.** Bare and URL-embedded `ACo`/`ACw` identifiers now retain case while vanity slugs still normalize. A live bare-ID enrichment passed.

Auth/realtime fixes from the preceding investigation were also committed and revalidated here: browser-derived request identity, verified cookie export, live status, one-time protected auth recovery in `start`, and compatible SSE/keepalive metadata.

## Known gaps

- One observed connection returned HTTP 404 from profile detail. That is an explicit inaccessible result, not a successful enrichment. The run does not establish why LinkedIn withheld it, nor prove every contact can be enriched.
- Current `attio-code-mode` server is disabled in local configuration and unavailable to this task. Live lookup/sync remains unverified; the ordinary Attio integration was not substituted.
- The global Apple Mail MCP can list accounts but lacks `export_emails_page`. Explicitly selecting the ingestion-capable checkout passed. The user's existing main mail configuration already selects that checkout for four accounts; it required no change.
- The one-page mail pilot is bounded. One account had a remaining cursor. Resume/reconcile passed, but remote archive completeness remains unverified.
- These are small authenticated samples. Full-network pagination, all profile variants, alternate browsers/proxies, renewed interactive authentication, and long-duration streaming were not exhaustively exercised.

## Repeating checks

Use `bun run test`, `bun run typecheck`, `bun run lint`, and `bun run build`. Do not use `bun test`: this repository's test script invokes Vitest.

For another live pilot, verify Shield with `allman browser doctor`, create a private isolated store/workspace, copy current quota accounting, and use explicit small limits. Retain consumed quota after the run. Keep all real credentials, raw responses, mail, and contact exports outside this repository. The receipt file deliberately omits arguments, identities, message bodies, request headers, and cookie values.
