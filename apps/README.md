# Local apps

| App | Source | Command | Data |
| --- | --- | --- | --- |
| Live activity | `src/activity/view.ts`, `design.ts`, `table-view.ts`; project shell `activity.html` | `bun run activity:build`, then `ALLMAN_PROFILE=jp bun run activity:serve` | Passive selected-account journals; follow mode available |
| Target enrichment | Project-owned `target-enrichment.html`; `src/attio/review-html.ts` | `ALLMAN_PROFILE=jp bun run enrichment:build`, then `ALLMAN_PROFILE=jp bun run enrichment:serve` | Saved review JSON from an already prepared account-scoped run |
| Browser atlas | `docs/browser-atlas/index.html` and frozen evidence/specs | `bun run atlas:open` (macOS) | Static research snapshot, no account access |
| Plans | `docs/plans/*.html`, `scripts/plans.mjs` | `bun run plans:build`, then `bun run plans` | Existing decision pages and app picker |

Activity route: <https://allman-activity.localhost/apps/activity.html>.
Enrichment route: <https://allman-enrichment.localhost/apps/target-enrichment.html>.
Both are Mac-local. Running a viewer does not start enrichment or activate profiles.

The enrichment HTML in this folder is a template, not a populated report. Its
`ALLMAN_REPORT` placeholder is filled only into a private output. `enrichment:build`
without arguments renders the selected account's newest saved review JSON beside
that JSON; it does not refresh provider data or rescan the store. For a fresh local
store projection use `enrichment:review RUN_ID`. `enrichment:serve` picks the newest
existing HTML for the selected account once at startup; its contents reload on each
request. Restart to select another run. `ALLMAN_REVIEW_HTML` selects an existing
explicit file instead. Never use `/absolute/private/review.html` literally.

To render recovered JSON without changing the account's report:

```sh
bun run enrichment:build artifacts/local/recovered-2026-09-23-o5m2jqj1/files/allman-review-result.json
```

This prints a new durable private `review.html` path. Set `ALLMAN_REVIEW_HTML` to
that printed path when serving it. Recovered JSON is a dated snapshot, not live data.

`bun run apps:build` rebuilds activity and the Plans index; `bun run build:all` also
compiles standalone and Node CLI entries. It deliberately does not choose a private
account or regenerate frozen atlas diagrams. `bun run apps:check` verifies activity
source parity, inline JavaScript syntax, report placeholder and atlas receipt hashes.
`bun run activity:share` rebuilds contact-free preview art and draft text; sends nothing.

QA: `bun run activity:qa` starts an interactive synthetic fixture (`append`, `new`,
`quit`); `bun run enrichment:qa` runs automated synthetic browser checks. Both retain
artifacts under `artifacts/local/`. `.appkit/lock.json` records original scaffold
provenance, not current customized HTML hashes. Do not re-scaffold existing apps.
