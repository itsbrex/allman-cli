# Live processing and daily accounting

`allman start` opens a loopback-only activity dashboard automatically, then performs
its normal sync/listen flow. `allman start --no-dashboard` keeps terminal-only output.
The viewer observes private local journals; it never starts a LinkedIn session or
performs a send, invitation, reaction, draft, or CRM write.

```bash
allman-jp activity --no-open --port 8767  # persistent passive viewer; prints its URL
allman-jp connections --limit 5         # another terminal, one processing command
allman-jp enrich --deep --limit 10
allman-jp companies --limit 5
allman-jp start --no-dashboard
allman-jp enrich --deep --limit 10 --dashboard --dashboard-port 8767
```

Use the selected profile's launcher or `ALLMAN_PROFILE`. The viewer remains scoped
to that store/account; viewing Brian's stored history does not activate Brian's
LinkedIn session. The shared single-profile guard and command lock still run before
any processing command. Keep a standalone `activity` process running to retain the
same URL between jobs. An embedded viewer ends with its owning command; a reused
standalone viewer does not. A port occupied by another account/app causes selection
of a free port; the CLI prints that actual URL.

The dashboard follows `start`, `sync`, `listen`, `messages` when syncing,
`connections`, `connections-of`, `enrich`, and non-local `companies` commands.
Other commands do not create activity runs. Local operations remain local.
BrowserOS MCP imports can change store totals, but their internal browser requests
are not counted by the CLI HTTP observer.

## Plans / Appkit artifact

The full dashboard is also a project-owned single-file app at `apps/activity.html`.
It was scaffolded with the actual Plans pipeline:

```bash
bun run plans app activity --recipe workspace --title 'Allman · Live contact processing' --badge ACTIVITY
```

That scaffold already exists: do not overwrite it. `.appkit/lock.json` retains its
Appkit 1.1.0 generation baseline. The project adds the BD Stack design, existing
activity source, command bar, keyboard help, themes, and a reduced-motion setting.

```bash
bun run activity:build                        # refresh dashboard regions from src/activity
bun run activity:share                        # render contact-free OG image and SMS copy
ALLMAN_PROFILE=jp bun run activity:serve       # keep this observer running
bun run plans activity                       # open the app via the plans picker
```

The serve script runs `bun run plans serve --local --name allman-activity bun
scripts/serve-activity.ts`. Live URL:
<https://allman-activity.localhost/apps/activity.html>. The dedicated local route
preserves the existing `allman-cli.localhost` plans-hub alias. Opening the app via
that local hub redirects to the live route. Opening a file or remote static copy
shows “Local viewer required”; it does not fetch the private feed.

The viewer captures the selected profile when started. Restart it to change the
observed profile or load a rebuilt artifact. It never activates that profile or
starts a LinkedIn session. Its listener binds to `127.0.0.1`, permits only the
configured origin (including Portless's exact forwarded authority), rejects
cross-site API requests, and serves a fixed allowlist of routes. Static page/card
navigation is allowed so links from the plans hub work. It never serves the
repository or account directory as a static file tree.

Share assets: `apps/activity-og.png` (1200 × 630, product copy only) and
`apps/activity-sms.txt` (draft text, never sent by the build). The PNG is served at
`/apps/activity-og.png` and referenced by the app's Open Graph metadata. The
`.localhost` link works on this Mac while the viewer runs; it is not a phone or
public share link. No remote hosting, notification, or tunnel is enabled by these
commands.

The table combines search, outcome, entity type, processing step, company and
location filters. Sort any visible column; show/hide/reorder columns; change row
density and page size; select all filtered events across pages; review selected
events; export selected events (including those hidden by current filters) or all
filtered events to CSV. CSV values that could be spreadsheet formulas are escaped.
Only column layout, sort, density and page-size preferences persist in browser
storage. Contact rows, filters and selections do not. New events keep the current
page and selection; a new run clears selection. “Pause view” freezes the display
while processing continues.

For repeatable UI checks, `bun scripts/qa-activity-app.ts` starts a disposable
45-event synthetic fixture with the exact built app. Enter `append`, `new`, or
`quit` in that terminal to test arrivals, run changes, and cleanup. No real account
is read. `bun scripts/build-activity-app.ts --check` detects stale embedded regions.

## What the numbers mean

| Value | Source and counting rule |
| --- | --- |
| Unique people observed today | Distinct flagship identities with a stored observation timestamp today or a successful result in today's full journals. Person/connection/conversation mirrors count once. |
| Unmatched Sales Navigator identities | Shown separately. Join only through a unique, consistent numeric member ID; never add all Sales Navigator rows to flagship people or match names/employers. |
| Companies resolved today | Distinct company IDs with a fetch timestamp today or successful company result. Employer URNs referenced in profiles are a separate inventory count, not completed company lookups. |
| Profile/company attempts | Persisted quota charges, including failures and repeated fetches. Already-enriched skips consume no charge. A crash after charging can leave an attempt without a dispatched request. |
| HTTP reads | Actual GET dispatches through the API client, with separate Sales Navigator counts, network failures, and HTTP errors. Every retry counts. A deep fetch can issue several requests; no guessed multiplier is used. |
| Recorded saves / repeat saves | Successful processing events from full journals. A second save of the same identity counts as repeat work, not a new person. Found and saved events do not double the unique count. |
| Run counts | Outcomes for the selected run, including each processing step. These are separate from daily totals across all recorded runs. |

“Today” uses the server's local calendar day and displayed IANA timezone. Quotas use
rolling windows and can recover capacity during the same day. Changing the selected
run or reconnecting the browser does not add events or reset daily totals.

Existing record timestamps prove that an identity was observed, not how many earlier
fetches occurred. Before each tracked command, retained quota timestamps are copied
into its private journal before the rolling ledger can prune them. Journal charges
and retained ledger entries are reconciled as timestamp multisets, so baseline
snapshots and reloads do not double-count the same charge. This preserves known
history going forward; it cannot recover timestamps already pruned before tracking.

Coverage starts at the first available journal. Historical totals are explicitly
incomplete. Browser navigation, realtime transport/heartbeat traffic, other tools,
and uninstrumented commands are not counted as HTTP reads. No subscription check or
live authentication test is performed by opening the viewer. A malformed quota input
hides quota bars instead of displaying a false full allowance.

## Limits and warnings

These values are **Allman's local enforced defaults**, not official LinkedIn
allowances or a guarantee against restrictions. Both the CLI and dashboard use
`resolveQuotaWindow` and `Quota`, including per-account `rateLimit` overrides.

| Stored credential | Profile enrichment | Company lookups |
| --- | --- | --- |
| Unexpired Sales Navigator `li_a` | 100 / rolling hour | 500 / rolling hour |
| No such credential | 25 / rolling 24 hours | 100 / rolling 24 hours |

At 80% use, the dashboard displays an advisory warning. At exhaustion it displays
the CLI's enforced stop and next slot time. HTTP 429 responses receive a separate
provider warning. No limits are raised, reset, or bypassed by the viewer. Search and
connection-list reads currently have no Allman volume quota; they are not “free”
provider activity merely because they lack a local quota bar.

LinkedIn says exact remaining [profile-view limits](https://www.linkedin.com/help/linkedin/answer/a569331/data-security-limits-on-profile-views?lang=en)
and [commercial-search allowances](https://www.linkedin.com/help/linkedin/answer/a564226/commercial-use-limit?lang=en)
are not exposed. The dashboard therefore does not invent LinkedIn-wide remaining
capacity, infer the paid plan from a contact's Premium badge, or equate a saved
Sales Navigator cookie with a verified current subscription.

## Privacy, storage and refresh

Journals live outside the Git-backed LinkedIn store:
`<private relationship workspace>/activity/<account hash>/run-*.jsonl` (0600).
Atomic run snapshots retain the latest 200 events for fast display; full JSONL
history drives daily accounting. The run selector shows 20 recent runs. Daily
metrics scan at most once every five seconds; live run events refresh over SSE.

Only projected identity/name/title/company/location fields and numeric request
outcomes enter journals. No cookies, request URLs/headers, response bodies, message
bodies, email addresses, or remote profile photos are copied into the viewer.
Only GET requests to the loopback viewer are accepted, with exact Host/Origin
checks and a restricted content security policy. Assets are embedded; no CDN or
additional browser connection is needed. Pause view freezes display only.

An unavailable observer prints a warning and leaves CLI processing unchanged.
Unreadable data or oversized journals are disclosed as incomplete coverage. A
stopped worker is shown as interrupted; a missing heartbeat leaves status uncertain.
