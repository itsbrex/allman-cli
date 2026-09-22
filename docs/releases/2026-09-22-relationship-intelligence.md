# Relationship intelligence release candidate

This document owns the ten-task batch authorized on 2026-09-22. The release adds local intelligence to existing stored evidence. Live messaging, invitations, reactions, drafts, and CRM writes remain outside scope. No external qualification provider is contacted automatically.

## Upstream audit — task 1 complete

Fetched upstream and fork refs on 2026-09-22. Upstream `main` is `d19fb681c0b33116f8e9f8dad1ab23e900fb9d4f`; starting local commit `e07d45e` contains it, with 20 additional commits and no missing upstream commits. Upstream has no open PRs. Checked issue bodies, maintainer scope comments, and merged PR descriptions before selecting work.

| Source | Already available locally | Remaining work selected |
| --- | --- | --- |
| [tarkaai/allman-cli#35](https://github.com/tarkaai/allman-cli/issues/35#issuecomment-5335356697), [tarkaai/allman-cli#33](https://github.com/tarkaai/allman-cli/pull/33) | Upstream CLI 0.3.2 includes company slug resolution, quota docs and raw capture. Fork additionally preserves sparse company arrays and Sales Navigator fields. | Reuse; do not rebuild |
| [tarkaai/allman-cli#36](https://github.com/tarkaai/allman-cli/issues/36), [tarkaai/allman-cli#37](https://github.com/tarkaai/allman-cli/issues/37) | Fork `preSendSync` persists conversation metadata first and uses fresh read state plus explicit local acknowledgement. Existing regression tests cover both reports. | Reuse; mocked tests only |
| [tarkaai/allman-cli#34](https://github.com/tarkaai/allman-cli/issues/34), [tarkaai/allman-cli#32](https://github.com/tarkaai/allman-cli/pull/32) | Original package lookup rewrite and portable fixture | Namespaced build configuration, failed-artifact cleanup, hermetic browser-path handling and broader asset guards |
| [tarkaai/allman-cli#1](https://github.com/tarkaai/allman-cli/issues/1) | Contact tags and single-predicate saved lists | Composable tag groups and CLI workflows |
| [tarkaai/allman-cli#6](https://github.com/tarkaai/allman-cli/issues/6) | Directional, timestamped mail/LinkedIn timeline with duplicate and automation handling | Explainable score, decay, override, pinning and sorting |
| [tarkaai/allman-cli#7](https://github.com/tarkaai/allman-cli/issues/7) | Person/company facts, provenance and a private ICP reference | Versioned definitions, rules and offline LLM evidence handoff, freshness, overrides, filters |
| [tarkaai/allman-cli#14](https://github.com/tarkaai/allman-cli/issues/14#issuecomment-5235751185), [tarkaai/allman-cli#26](https://github.com/tarkaai/allman-cli/pull/26) | Stored first-degree and connections-of observations | Local graph traversal and explained introduction candidates; no drafted or sent requests |
| [tarkaai/allman-cli#2](https://github.com/tarkaai/allman-cli/issues/2), [tarkaai/allman-cli#8](https://github.com/tarkaai/allman-cli/issues/8), [tarkaai/allman-cli#9](https://github.com/tarkaai/allman-cli/issues/9), [tarkaai/allman-cli#10](https://github.com/tarkaai/allman-cli/issues/10) | Structured geo, canonical people, mail/Attio joins, provider-neutral observations and company rollups | Build on existing contracts; do not infer identity or relationships from names/employers |

Open upstream issues are not proof of missing local code. In particular, some comments describe an earlier upstream state. Broad issues remain open even after their data-layer prerequisites landed.

## Ten deliverables

1. **Complete:** upstream issue/PR/comment audit above.
2. **Complete:** Portable-build hardening against ambient configuration, builder paths and failed artifacts.
3. **Complete:** Composable tag groups with local CLI commands.
4. **Complete:** Explainable, history-derived relationship scoring; no fit/seniority blending.
5. **Complete:** Auditable manual score overrides and pinning.
6. **Complete:** Multiple private, versioned natural-language/structured ICP definitions.
7. **Complete:** Evidence-backed rule qualification plus bounded offline LLM export/import, unknown results and stale-result handling.
8. **Complete:** Composable ICP/rank/tag/company/location filtering and sorting.
9. **Complete:** Observed graph construction and ranked `intro-to` results with evidence on both legs.
10. **Complete:** End-to-end verification, docs/agent docs, local release packaging and remaining-gap report below.

Each implementation deliverable receives a focused commit and regression coverage. Private business context, contacts, cookies and qualification results stay outside the source repository. Existing user WIP is preserved.

## Verification and candidate packaging

Source candidate version: `0.4.0-rc.1`. Final integration fixes also isolate store Git
from parent repositories/hook environments, preserve unknown field observation times,
and reject unsupported ICP flags. A recently touched person/company record is not
proof that every field was re-observed.

- CLI suite: **617 tests across 71 files passed**; typecheck passed. Lint passed
  with eight existing informational suggestions.
- Real subprocess integration exercises groups, ranking overrides, ICP definitions,
  local rules, offline export/import, changed-evidence rejection, sticky overrides,
  combined filtering and two-step introductions against synthetic stores.
- Rejected stale imports leave the qualification file byte-identical. Private-file
  permissions and preservation of parent Git history/index are covered.
- Existing no-send QA remains at [command validation](../qa/2026-09-22-command-validation.md).
  Its authenticated Sales Navigator, deep-enrichment and first-degree checks are
  earlier-run evidence; this feature batch does not repeat outbound-capable live tests.
- A clean checkout of `0e2afc3b327942789fbc7799900d94146c9f1dcf`, installed with
  `bun install --frozen-lockfile`, passed typecheck, lint and the complete 617-test suite.
  `bun run release 2026-09-22.1-beta --dry-run` produced four binaries, four SHA-256
  files and a manifest. It created no Git tag or public release.
- The packaged macOS ARM64 binary reports `0.4.0-rc.1`; its help and real subprocess
  integration passed. The integration runs the complete local group/rank/ICP/intro
  lifecycle against a synthetic store using `ALLMAN_TEST_BINARY`. The other three
  targets were cross-compiled, not executed on their target systems.

### Local artifacts

Candidate binaries and [release manifest](../../dist/relationship-intelligence-0.4.0-rc.1/release-manifest.json)
are retained in ignored `dist/relationship-intelligence-0.4.0-rc.1/`. All copied
artifact checksums were verified. They correspond to the source commit above;
this later evidence-only documentation commit does not change their code.

| Binary | SHA-256 | Runtime coverage |
| --- | --- | --- |
| `allman-linux-x64` | `b5d1f56fe5f1834f354a3a61ff2f2eb019e7e45b096061bce81f133d3625ac82` | Cross-compiled only |
| `allman-linux-arm64` | `87bba255854c50ef06f7fae0d01a4a0003ab6d44d4a22bc332ce8a19218fc404` | Cross-compiled only |
| `allman-darwin-x64` | `2dd85d576d3091cef107bdcc989da937a22edebe88e8f37a1ac0ed3eb337fd92` | Cross-compiled only |
| `allman-darwin-arm64` | `d8045701fe09d3f9fc96450ed84edb82cfb8825c09d139e8a58f4fbff38ff682` | Version/help, synthetic CLI lifecycle, stored-data graph reads |

The existing development launcher already points to this source checkout. No launcher
or browser configuration was changed. The packaging worktree remains available at
`~/.codex/worktrees/allman-relationship-release/allman-cli`. Unrelated `.tool-versions`
and `docs/browser-atlas/` work was preserved.

### Private workspace verification

These counts describe local stored records, not a fresh LinkedIn or Attio API check:

- All **1,502 contacts** received a history-derived rank; **49** have person/company
  facts. Missing history or facts do not imply a weak real-world relationship or poor fit.
- The private Cresa runtime definition was applied to all 1,502 contacts. Every result
  is **unknown**, with no positive/negative assertion: its natural-language role, scale,
  footprint and buying-initiative requirements need reviewed supporting evidence.
  No arbitrary employee threshold, confidence cutoff or geography was added.
- Private `cresa-review` and `cresa-fit` groups were created. Bounded offline handoffs
  were saved with mode 0600; no model provider was called and no model result imported.
- Both source and compiled graph commands returned **1,507 nodes and 168 edges**, with
  zero graph warnings. The stored graph currently has no connected two-step introduction
  path. A compiled `intro-to` query correctly returned no paths; positive paths with
  evidence on both legs were verified in synthetic unit and CLI integration tests.
- No live sends, invitations, reactions, drafts, CRM writes, remote read-state changes,
  browser interactions or credential changes occurred in this intelligence batch.
  Build dependency downloads are separate from these local data operations.

At the end of the original ten-task batch, remaining scope included TUI controls
(completed in the follow-up below), automatic paid/model-provider integration,
observed third-party relationship-strength evidence, semantic natural-language graph
search, and introduction ask/draft tracking. No public release, push, or upstream
issue mutation was performed.

## Follow-up: contact review, observed paths and TUI controls

The user authorized continuing the three suggested follow-ups on 2026-09-22. All three
are complete within the boundaries below.

1. **Private evidence review:** Exported and reviewed all 49 contacts with stored facts.
   Each had only a headline; 25 headlines lacked an observation timestamp. Two fresh
   CFO headlines supported the buyer-role criterion. Company scale, real estate
   footprint and an active buying initiative remained unknown, so all 49 overall
   qualifications stayed unknown. Imported all 49 per-criterion reviews through the
   CLI's validation boundary as `llm-import`, with zero manual overrides replaced.
   No additional model-provider API was called. Private exports, review inputs and
   receipts remain in the relationship workspace; no contact details enter this report.
2. **Bounded network collection:** Shield 3.4.0 and authenticated owner identity passed
   fresh checks. Three distinct flagship `connections-of` reads used `--limit 5`.
   One target returned no visible results; two stored five rows each. The graph now has
   **1,517 nodes, 178 edges and ten observed two-step paths**. Its two warnings correctly
   describe partial exports: 5/861 and 5/166 results. A real stored-data `intro-to` query
   returned a path with evidence on both legs; peer strength and composite weight stayed
   null when unmeasured. This does not prove introduction willingness or full network coverage.
3. **TUI controls:** Views 5 and 6 now expose separate fit/rank evidence, combined
   filters, saved groups, audited rank/fit overrides, local rule qualification, private
   handoff export, and observed introduction queries. Navigation is local; explicit
   operations use the CLI. Small terminals retain scrollable evidence. No compose,
   send, invitation or CRM action was added to relationship mode.

### Follow-up fixes and verification

- CLI `1d5c26d` adds `icp export --list <group>` so a bounded review group needs one
  snapshot rather than one rebuild per contact. A per-contact run exceeded its local
  40-second deadline during extreme host load; completed exports were preserved and
  the stopped process's writer lock was removed only after verifying its PID was gone.
  Group export and import then completed. This is not a controlled speed benchmark.
- CLI **617 tests in 71 files passed**, with one Vitest worker to avoid host contention.
  TUI **138 tests in 12 files passed**. Both typechecks and lints passed; existing
  informational/warning diagnostics remain. Real Git/shell fixture deadlines were
  increased without changing their assertions. Detail scrolling also has regression
  coverage for moving back after reaching the end.
- TUI code commit: `f6bac6f`. Its QA gallery has **15 actual Ink screenshots**, each
  **3200 × 2120**, verified by PNG headers and SHA-256. Synthetic data only; the isolated
  Shield-protected capture profile recorded zero page network requests. Fit/rank,
  observed introductions and narrow stale-evidence views were visually inspected.
- A compiled TUI test ran in a real PTY against a private synthetic store with no
  credentials and no `allman` on PATH. Fit/rank rendering, ICP filtering, embedded CLI
  graph/intro queries, embedded binary hash equality, and clean Escape exit passed.
  The initial exit check stalled because the harness waited without draining terminal
  output; draining the PTY resolved it without an application change. Sanitized receipt:
  companion TUI `docs/qa/relationships/compiled-smoke.json`.
- Current local binaries: CLI `dist/allman-intelligence-dev`; companion TUI
  `dist/allman-tui`. The TUI embeds the current CLI. Source launches must explicitly
  select the current CLI if their sibling worktree is older. Global launchers remain
  unchanged; the TUI worktree is `~/.codex/worktrees/allman-relationships/allman-tui`.
- **Zero live sends, drafts, invitations, reactions, CRM writes, or remote read-state
  changes.** No public release, push, upstream mutation, or automatic provider call.

Remaining gaps: the 49 reviewed contacts still need company/footprint/initiative
evidence for full ICP fit; network collection is intentionally partial; peer strength
is unmeasured; automatic model providers, semantic graph search, and introduction
request tracking remain outside this continuation.
