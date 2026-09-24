# Development commands

Use Bun 1.4.2 and Node 20.20.1 from `.tool-versions`; dependencies are pinned by
`bun.lock`. Run `bun install --frozen-lockfile` only when dependencies need installing.
Use `bun run test` (Vitest), not Bun's built-in `bun test` runner.

| Command | Purpose |
| --- | --- |
| `bun run build:all` | Refresh activity/Plans artifacts and compile standalone plus Node CLI |
| `bun run apps:build` / `apps:check` | Rebuild source-derived HTML; verify apps and immutable atlas receipts |
| `bun run activity:build` / `activity:check` | Update/check activity template regions |
| `bun run activity:share` | Rebuild contact-free PNG and draft SMS text; never send |
| `bun run activity:serve` | Local Plans/Portless observer; `ALLMAN_PROFILE` or follow-active mode |
| `bun run enrichment:build` | Re-render selected account's latest saved review; optional JSON path creates a new durable output |
| `bun run enrichment:review RUN_ID` | Regenerate a known run from the local store, including HTML |
| `bun run enrichment:serve` | Serve newest saved HTML for selected account, or `ALLMAN_REVIEW_HTML` |
| `bun run enrichment:qa` | Automated synthetic browser checks; durable evidence |
| `bun run activity:qa` | Interactive synthetic fixture; type `quit` when finished |
| `bun run plans:build` / `bun run plans` | Regenerate index / open plan and app picker |
| `bun run atlas:open` | Open frozen browser research index on macOS |
| `bun run artifacts:new LABEL` | Create and print a unique private working directory |
| `bun run artifacts:recover --date YYYY-MM-DD` | Hash-verified copy of relevant temporary files; never execute/delete originals |
| `bun run check` | Types, app consistency, recovery tests and Vitest |
| `bun run lint` | Existing Biome source/test check; does not format files |

See [app details](../apps/README.md), [artifact policy](../artifacts/README.md), and
[repository map](../docs/README.md). Individual scripts are the implementation of
these package commands. `build-rewrites.ts`, `release-options.ts`, and
`artifact-directory.ts` also expose helpers used by other scripts/tests.

`browser-smoke.ts`, `dump-message-urns.ts`, `test-react.ts`, `dev-link.ts`, release,
and `macos-profile-app/install.py` are explicit operational tools, not app builds.
Some launch browsers, inspect private data, alter local launchers, or perform provider
actions. They are excluded from `build:all` and `check`. The native JP launcher has
its own [build and isolation instructions](macos-profile-app/README.md).

Generated outputs: `dist/allman`, `dist/allman-node.mjs`, activity HTML/share assets,
and `docs/plans/index.html`. Restart existing activity viewers after changing their
loaded source/artifact. Enrichment viewer reloads its selected HTML on every GET;
regenerate that report first. No dependency upgrade, service restart, browser launch,
enrichment, or publication is hidden inside `build:all`.
