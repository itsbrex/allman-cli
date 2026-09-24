# Local integration and command freshness — 2026-09-24

## Scope and evidence reviewed

Reviewed registered worktrees, all local branch ancestry, stashes, working-tree diffs,
recent commits, repository `.remember` history, and available Codex session finals
for the dashboard, browser repair and targeted enrichment work. This is a local
integration audit, not a claim that every historical session or remote branch was
replayed. No remote push or new enrichment was performed.

CLI feature line already contained dashboard/configuration, profile guards,
relationship releases, raw preservation, team exports, targeted enrichment,
browser atlas and JP backend isolation (`ca065d8`, `a634ee5`, `24f3bd1`,
`e79e933`, `5fac0b3`, `6ab1583`). Preserved and committed the later target-review
usability work and its existing QA evidence rather than replacing it.

TUI root had lagged the relationship worktree. Preserved worktree date controls
in `459155a`, root profile/store/enrichment work in `17716ab`, and merged both
into `main` through `9b09cc8`. Integration retained the decomposed app, six
relationship views, fit/rank/introductions, QA reviewer, Attio list picker,
profile-specific store resolution, and compact/relative date controls.
Runtime/build safeguards are in `42008a7`; TUI main finishes at `0124087`.
CLI feature integration is `f11e1db`; the remaining merge records the already
applied shim branch without replacing newer behavior.

Both `feat/upstream-dev-shims` branches carried independently committed copies
of already-present changes. Integration retains the newer scripts, manifest
entries, documentation and pinned runtime behavior. Old registered worktrees
remain available; global commands do not execute them.

| Repository | Registered secondary checkout | Integrated source |
| --- | --- | --- |
| CLI | `~/.codex/worktrees/allman-relationship-release/allman-cli` | `0e2afc3`, ancestor of current feature line |
| CLI | `~/.codex/worktrees/allman-relationships/allman-cli` | `f94d404`, ancestor of current feature line |
| TUI | `~/.codex/worktrees/allman-relationships/allman-tui` | `459155a`, merged into root main |

## Runtime and builds

- `~/.local/bin/allman` resolves to `~/github/allman-cli/bin/allman`.
- `~/.local/bin/allman-tui` resolves to `~/github/allman-tui/bin/allman-tui`.
- Brian/JP CLI wrappers both delegate to the root CLI source shim.
- Shims resolve Bun using `mise --cd <checkout> which bun`; both repositories pin
  Bun 1.4.2. Caller cwd and quoted arguments remain intact. Runtime-resolution
  failure does not silently choose a different Bun.
- TUI source defaults to its sibling CLI source unless `ALLMAN_BIN` is explicitly
  provided. Standalone TUI was rebuilt with the freshly built CLI executable.
- TUI build rejects source scripts even when they exceed the old 1 KB stub check.
- Existing long-running CLI/TUI processes keep their loaded code until restarted.
  Activity LaunchAgent was restarted and its current endpoint verified.

## Account controls

Installed `/Applications/BrowserOS Brian.app` with blue BR icon and updated
`/Applications/BrowserOS JP.app`. Staged signature validation precedes atomic
replacement; previous owned helpers are backed up privately. Browser processes,
profiles, cookies and JP's private backend adapter were preserved.

Brian's helper reused PID 76379 at CDP 9222, verified Shield and activated Brian.
JP's helper reused PID 45638 at CDP 9223, verified Shield and activated JP.
Receipts were refreshed at 19:48:20Z and 19:51:07Z respectively. Actual browsers
retain vendor Neo / purple JP Dock identities; launcher accessories add no
second Dock icon. Both fixed remote-debugging and BrowserOS CDP flags are checked.
Cold browser startup was not exercised because both saved browsers were open.

Live dashboard account selection switched Brian to JP through the existing
session guard. UI returned Connected and `jp active · other LinkedIn accounts
paused`. Guard errors remain visible; old account data hides during switching.
Only the active-profile viewer enables controls. POST requires exact origin,
JSON content type and a random per-viewer token. Passive viewers remain read-only.
No LinkedIn HTTP fetch, CRM write, invitation or message was requested by these checks.

## Verification

- CLI: 760 tests passed across 93 files in the commit gate, including the
  source-shim regression. Initial baseline concurrency timeouts passed against the
  rebuilt binary; final serialized run used one worker and the fresh executable. The commit
  runner now honors `VITEST_MAX_WORKERS=1`; a later duplicate-branch merge hook
  hit a 5-second subprocess timeout under the default two workers, so its
  verification was rerun with that supported single-worker setting.
- TUI: 148 tests passed, including merged command/date/profile behavior and new
  runtime-shim regression. Typecheck passed in both repositories.
- Lint passed with existing warnings; no claim of warning-free output.
- CLI native build, Node bundle, generated dashboard and TUI native build passed.
- App integrity and generated dashboard parity checks passed.
- Four Python launcher/engine tests passed; native helper compilation,
  self-tests, code signatures and live reuse receipts passed.
- Outside-repository global CLI/version/statusline smoke passed. Global TUI
  opened its six-view relationship interface and date-mode hint in a PTY.
- CodeDB refresh probes passed. The existing 19 MB TUI QA gallery exceeds
  CodeDB's indexing size cap and remains available only via direct read.

Private logs, exports, raw records, browser profiles and compiled artifacts remain
outside versioned source. Actual logout/login, cold browser start and a future
vendor upgrade were not replayed. Earlier LinkedIn HTTP 429 remains unresolved;
this local integration made no retry and does not claim provider readiness.
