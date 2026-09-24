# Repository map and documentation

Start with [README](../README.md) for CLI use, [CONTEXT](../CONTEXT.md) for vocabulary,
and [development commands](../scripts/README.md) for app/build/verification scripts.
[PLAN.md](../PLAN.md) is historical design, not a current backlog or completion claim.

| Area | Implementation / tests | Documentation |
| --- | --- | --- |
| CLI and profile selection | `src/index.ts`, `commands/`, `store/config.ts`; CLI/profile tests | [Profile folders](profile-folders.md), [single active profile](single-active-profile.md) |
| Browser custody and API sessions | `src/linkedin/auth/`, `api/`, `session-control.ts`; Shield, CDP, Neo, identity and session tests | [Browser support](browser-support.md), [JP launcher](../scripts/macos-profile-app/README.md) |
| Network records and deep enrichment | `src/store/`, `linkedin/api/endpoints/`, `commands/enrich.ts`; connection/profile/enrichment tests | [Connection baseline](connection-baseline.md) |
| Attio and Sales Navigator list selection | `src/attio/`, `commands/enrich-list.ts`; target, SalesNav, presentation and review-server tests | [List workflow](attio-list-enrichment.md) |
| Private mail, identity, rank and ICP | `src/mail/`, `relationships/`, `store/private-workspace.ts`; relationship/qualification/graph tests | [Workspace](relationship-workspace.md), [agent contract](agents/relationship-intelligence.md) |
| Raw evidence and team exports | `src/store/raw-archive.ts`, `src/exports/`; raw/archive/export tests | [Persistent exports](persistent-exports.md) |
| Passive activity and service controls | `src/activity/`, `commands/activity.ts`, `statusline.ts`; activity/viewer/statusline tests | [Live activity](live-activity.md) |
| HTML apps, plans and research | `apps/`, `scripts/*app*`, `plans.mjs`; presentation tests and browser QA | [Apps](../apps/README.md), [Plans](plans/README.md), [browser atlas](browser-atlas/README.md) |
| Local recovery and working evidence | `scripts/preserve-temp.py`, `artifact-directory.ts`; recovery tests | [Durable artifacts](../artifacts/README.md) |

`tests/unit/` includes pure unit tests, mocked provider contracts and subprocess/local
HTTP integration tests; its name does not imply every test is a pure unit test.
`tests/setup.ts` suppresses observer side effects. Browser QA commands use synthetic
data and do not prove LinkedIn access. Full-suite output can contain mocked send
messages; running the normal test suite does not authorize live sends.

`docs/adr/` records design decisions. `docs/qa/` and `docs/releases/` are dated evidence,
not promises about current host state. Browser atlas specs/diagrams/receipts are a
frozen research snapshot; preserve hashes and historical benchmark versions. Use
fresh checks before claiming live authentication, quota recovery, or provider support.
The companion TUI and BrowserOS JP plugin live in separate repositories/directories;
this repo's build does not rebuild or reinstall them.

CodeDB provides indexed navigation. For untracked/ignored files, use scoped `rg
--no-config --files --hidden --no-ignore` excluding `.git`, `node_modules`, `dist`, private
artifacts and browser caches. Never dump credentials while auditing ignored files.
Refresh CodeDB after repository edits. Store audit logs under `artifacts/local/`.
