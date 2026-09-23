# Live activity and daily accounting QA — 2026-09-22

Scope: passive loopback dashboard, processing journals, store-backed daily totals,
and existing local quota policy. No live sends, drafts, invitations, reactions,
CRM writes, or mark-read actions were performed. Real contact details and cookies
are excluded from this report.

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
