# HTTP evidence, unified logs, and filtered Sales Navigator URLs

Date: 2026-09-24. No live LinkedIn requests were made during verification.

## Changes

- Capture successful and failed JSON API responses before throwing, when raw capture is enabled. Include normalized Retry-After but exclude auth headers. Capture failure does not replace the original HTTP error.
- Report the failing endpoint and provider Retry-After, or an unknown reset time; no hard-coded 60-second delay or automatic retry.
- Add daily private HTTP metadata journals and `logs --follow`, with profile selection, source filters, JSON lines, path inspection, bounded tails and creation/rotation handling. Logs are local operations and remain accessible for inactive profiles.
- Accept explicit single included LEAD_LIST search filters with a session ID. Preserve the full query in API reads and saved snapshot membership checks. Reject ambiguous, excluded, malformed or incomplete inputs/results.

## Evidence

- 779 CLI tests across 95 files passed against the fresh standalone binary (one worker).
- 148 TUI tests passed. TUI standalone rebuilt with the new CLI embedded; TUI repository remains clean.
- CLI typecheck passed. Lint passed with 7 existing warnings. App checks and 2 artifact-recovery tests passed. `git diff --check` passed.
- Native CLI and Node bundle rebuilt; both `logs --paths --source http` smoke checks passed.
- `allman-jp`, `allman-brian`, and `allman` source launchers passed log-path checks. Current selectors resolve to JP, Brian, and Brian respectively. No HTTP journal existed yet: journals start with subsequent requests and do not fabricate past events.
- Public CLI follow test verifies new log discovery, JSON output, and clean SIGINT exit. Reader tests cover partial lines, truncation and inode replacement.
- Failed-response tests cover 302/401/403/429/500, immutable raw revisions, private file permissions, absent/malformed/numeric Retry-After and HTTP-date parsing. Metadata tests exclude headers, query secrets and bodies.
- Search fixtures cover encoded labels, additional filters, nested recent-search IDs, legacy searchQuery, exact session encoding, inline/normalized pages, snapshot validation, 429 stop behavior and incomplete/over-cap results.
- Inspected the user's real archived 429 locally: endpoint `/sales-api/salesApiProfiles`, JSON object body, private 0600 file, no usable Retry-After. No payload contents copied into repository artifacts.
- Latest required CodeDB refresh probe passed.

## Cleanlist source reference and limitations

Read `/Users/hack/github/crx-downloads/Cleanlist.ai/src/background/linkedin.ts`, especially `checkUrl` and `buildLeadSearchUrlFromQuery`, and `src/lib/sales-nav-export.ts`. Cleanlist's explicit query preservation informed this adapter; no extension files changed. CodeDB MCP retained the Allman project despite a supplied project path, so explicit-root CodeDB CLI supplied Cleanlist context instead.

Live filtered-search response shape remains unverified because the user's requests encountered a provider 429. Fixture coverage does not clear that restriction. Browser MCP 404/406 and generic TLS/GCM messages do not establish the cause of the LinkedIn response. List preparation still refreshes membership; the raw archive does not automatically replay stale membership. Identifier-only saved/recent searches and multiple/excluded lead lists remain unsupported.
