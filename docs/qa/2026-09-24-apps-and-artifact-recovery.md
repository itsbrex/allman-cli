# App commands, durable artifacts, and repository refresh — 2026-09-24

## Scope and exploration

Reviewed app build/serve scripts, CLI registrations and account selection, list
preparation/execution/review boundaries, activity services, storage/exports, tests,
package scripts, docs, provenance and ignored-file inventory. Preserved existing
modified/untracked implementation. No dependency upgrade, commit, push, browser
profile change, provider call or enrichment run was performed.

CodeDB MCP initially returned stale neighborhoods missing recent files. Re-indexed
and used the current CodeDB CLI for a full tree plus activity, browser/store and
list-enrichment contexts. Scoped `rg --no-config --files --hidden --no-ignore`
covered 1,168 files including 119 source, 29 script, 92 test, 264 docs and 5 app files
at inventory time; later additions change these counts. Dependencies, Git internals,
build outputs, private artifacts and Python caches were excluded. Global ripgrep
configuration hid images, so the inventory was repeated with `--no-config`.
Historical session files were inventoried, not bulk-read as current instructions.

## Changes

- Added app/build/check/review/serve/QA, Plans, atlas and artifact package commands.
- Recovered 128 files modified September 23 and 114 related files modified September
  22, using America/Los_Angeles boundaries. Total: 25,509,921 bytes. Copies and
  originals rechecked against SHA-256 manifests; zero errors, original files retained.
- Added private, unique `artifacts/local/` directories, a recovery tool and guidance
  for future one-offs. Git ignores private captures. QA retains synthetic evidence.
- Replaced literal placeholder-path docs with selected-profile review commands.
  Enrichment serving picks the newest existing HTML within the selected account, or
  accepts an explicit existing path. Unreadable files produce actionable instructions.
- Added an offline review renderer. Selected-account mode rebuilds beside saved JSON;
  explicit JSON input writes to a fresh durable artifact directory. Neither starts
  enrichment. Live HTML and its script-hash CSP refresh together per request.
- Updated root/agent/glossary docs and added docs/scripts/apps/artifact maps. Marked
  the old redesign plan historical. Corrected Vitest invocation and JSON-save docs.
- Rebuilt activity HTML, Plans index, standalone CLI, Node CLI, contact-free share
  assets, JP's saved review and a separate copy rendered from recovered JSON.
- Restarted the existing passive activity service and old enrichment viewer. Both
  local HTTPS routes returned HTTP 200 with bytes matching the current on-disk HTML.
  Activity LaunchAgent reported running after restart. No worker was started.

## Verification

- Full Vitest suite: **91 files, 755 tests passed** (one worker).
- TypeScript check passed.
- Biome check passed with **7 existing warnings and 10 informational diagnostics**;
  no broad lint rewrite. Changed TypeScript files passed their focused check.
- Recovery tests: **2 passed**; native JP engine contract tests: **2 passed**.
- App checks: current activity source parity, four inline scripts parse, one report
  placeholder, and all **19 frozen atlas specification/artifact receipts** match.
- Synthetic enrichment browser QA passed: filters, details, safe escaping/links,
  persisted notes, CSV escaping, command bar and mobile layout. No page errors.
- Review-server tests cover account-only newest-file selection, regeneration/CSP,
  Host/Origin/cross-site rejection, route/method limits and missing-file response.
- Standalone and Node entry help commands passed after rebuild.
- Local Markdown target audit found no missing files.
- Final CodeDB refresh probe passed after the last repository edit.

Detailed contexts, inventory, suite/lint logs, compiled help and HTTPS byte comparisons:
`artifacts/local/2026-09-24T18-23-50.463Z-repo-audit-QxQUJ1/`.
Recovery manifests and policy: [artifacts README](../../artifacts/README.md).
Commands: [scripts README](../../scripts/README.md).

## Limits

Recovery selects regular files by project names/references and modification date;
already-deleted files cannot be recovered. Private archives are not in Git and need
ordinary private-disk backups. Frozen atlas receipts were verified without rewriting
historical research or re-testing external browser products. Companion TUI/plugin
builds live outside this repo and were not rebuilt. Synthetic tests and local HTTPS
checks do not establish current LinkedIn/Sales Navigator access or rate-limit reset.
