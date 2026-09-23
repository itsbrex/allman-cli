# Live activity and daily accounting QA — 2026-09-22

Scope: passive loopback dashboard, processing journals, store-backed daily totals,
and existing local quota policy. No live sends, drafts, invitations, reactions,
CRM writes, or mark-read actions were performed. Real contact details and cookies
are excluded from this report.

## Plans artifact port

Completed the `bun run plans app activity --recipe workspace` scaffold rather than
substituting a separate page generator. Appkit provenance is intact and reports
the app as current, project-modified. The generated dashboard regions use the same
styles, body, table model/controller, and event renderer as the CLI. The exact
served inline scripts are authorized by CSP hashes; no external scripts or fonts
are fetched.

Deliverables:

- `apps/activity.html`: full dashboard with BD Stack design and Appkit command bar.
- `https://allman-activity.localhost/apps/activity.html`: Plans/Portless local route.
- `apps/activity-og.png`: inspected 1200 × 630 card with product text only.
- `apps/activity-sms.txt`: unsent, Mac-local share copy.
- `scripts/qa-activity-app.ts`: disposable fixture for repeating the UI checks.

Verification on the ported artifact:

- Live JP UI and API agree: 5 known people, 1 deep profile, 6 recorded saves, 1
  repeat save, 0 resolved companies. Opening it performs no LinkedIn request.
- Opening the hub's `allman-cli.localhost/apps/activity.html` redirects to the live
  route and shows Connected with 5 people. Cross-site navigation may read the
  contact-free static shell/card; cross-site API reads remain rejected.
- Synthetic 45-event run: sort by name, select all 45, navigate to page 2; all 20
  visible rows remain selected, range is 26–45.
- Combining Person + Deep enrichment + Meridian + San Diego yields exactly two
  events, with 43 selections outside the active filters.
- Hide Time, show Location, move Company first, and set Compact; reload retains
  layout/density and clears transient selections.
- An arriving event changes 45 to 46 while keeping page 2 and the original 45
  selections. Pause holds 46 while another event arrives; resume displays 47.
- Selected-only mode still shows the original 45. A fresh run clears selection;
  switching back to the older run replays all 47 events.
- Chromium downloaded the selected 47-row CSV successfully: header plus 47 rows,
  including synthetic arrival records, with no download failure. Codex's in-app
  download event did not fire; native in-app download completion remains unverified.
- Appkit command bar opens Column settings; dashboard uses the reference's system
  serif/mono fonts and charcoal background. At 390 × 844, document width is 390px;
  the event table scrolls inside its 354px container. Desktop and mobile viewport
  screenshots were visually inspected. No page console warnings or errors.
- Host, Origin, cross-site, path traversal, POST, proxy protocol, and occupied-port
  regressions pass. Portless's `changeOrigin` behavior is handled only for the
  configured loopback listener and exact `.localhost` forwarded authority.
- Canonical `bun run test --maxWorkers=2`: **689 passed**. Typecheck and lint pass
  (lint retains eight existing informational notices). Artifact freshness check and
  CodeDB refresh pass. Unrestricted concurrency first timed out two session CLI
  tests; their isolated run passed. A separate experiment running Vitest under Bun
  directly exposed an unrelated existing CDP mock failure; the canonical runner
  above is the verified suite.

The user browser exposed as Chrome reported Comet `ERR_BLOCKED_BY_CLIENT` for local
navigation. No browser protection was changed. Live UI was verified in Codex's
in-app browser; CSV file output was verified with disposable Chromium.

## Store reconciliation

Read-only local inspection found:

| Stored evidence | Brian | JP |
| --- | ---: | ---: |
| Distinct flagship people across namespaces | 1,430 | 5 |
| First-degree connection records | 1,427 | 5 |
| Sales Navigator records | 1,382 | 0 |
| Unmatched Sales Navigator identities, kept separate | 1,296 | 0 |
| Connections carrying deep enrichment | 98 | 1 |
| Resolved company records | 0 | 0 |
| Distinct employer IDs referenced in profiles | 1,447 | 4 |
| Retained enrichment charges dated today | 100 | 1 |
| Retained company lookup charges dated today | 3 | 0 |

These are stored observations, not proof of complete remote archives or current
connection counts. Historical request totals cannot be recovered from these files.
Failed company attempts do not count as resolved companies. Brian's retained charges
were outside the current rolling hour; JP had one charge within it at inspection.

## Verification

- Bounded live reads earlier in this implementation: JP `connections --limit 5
  --page-size 5 --include-headline`, then `enrich --deep --limit 1`. Five connection
  saves plus one enrichment save reconciled to five unique people and one repeat save.
- The real in-app page at `127.0.0.1:8767` displayed those values, local Sales Navigator
  quota defaults, retained-history coverage, and zero resolved companies. The viewer
  itself made no LinkedIn connection. Current controls passed history selection,
  search with no matches, pause/resume, and coverage expansion.
- A separate synthetic local server exercised 80/100 enrichment warning, 500/500
  exhausted company quota, next-slot time, HTTP 429 warning, company success/failure
  rows, and the Issues filter. Browser console returned no warnings or errors.
- Regression tests cover immutable identity deduplication, conflicts, repeated saves,
  failed/skipped attempts, full journals beyond 200 events, ledger/journal reconciliation,
  quota persistence across restart, local midnight, expired seat credentials, overrides,
  unreadable quota inputs, real mocked HTTP dispatch/error seams, automatic opening with
  `start`, opt-out, Host/Origin rejection, read-only methods, and SSE replay.
- Embedded assets are compiled into the standalone CLI. Test data uses disposable
  local stores; no synthetic records were added to Brian or JP's stores.
- The default test pool produced resource-contention timeouts in unrelated CLI,
  installer and file tests on a heavily loaded desktop. The same full suite passed
  with two workers. The runner now caps workers at two; assertion deadlines and
  behavioral checks are unchanged.

The daily counter is intentionally labeled incomplete for historical requests.
Only actual API-client GET dispatches in tracked commands are counted going forward;
browser and realtime transport traffic remain outside that metric. See
[counting and privacy contract](../live-activity.md).
