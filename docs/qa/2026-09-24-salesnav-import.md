# Save Sales Navigator imports before resolving identities

Date: 2026-09-24. No new LinkedIn requests were made during this change.

## Behavior

- `prepare` fetches list/search pages, then saves all members as private JSON and CSV before reading identity caches. It matches cached account identities and numeric member IDs locally. It makes no profile-mapping calls.
- `prepare --import <import.json>` reuses a saved account/store/source-matched import offline. Failed local matching leaves the import available; history ignores folders without completed plans.
- `run` resolves only imported members with missing identities. Membership is checked first; fresh opaque profile context is copied only for sealed members. One authenticated session covers membership, identity resolution and deep enrichment.
- Each lookup consumes an enrichment quota slot. Failures stop immediately. Successful identities are saved per run before continuing; exact stored-connection matches update the shared account cache for reuse across lists. Non-connections and conflicts are not deep-enriched.
- The original sealed plan remains unchanged. Runtime targets are derived only from its imported members. Existing Attio and older Sales Navigator plans retain their behavior.

## Verification

- Full CLI suite: 787 tests across 97 files passed. Focused tests also cover the final cross-list cache update.
- Public command regression verifies preparation makes one search request and zero identity calls, retains raw rows, escapes CSV formula fields, sets private permissions, and reimports without loading a session.
- Cache failure regression confirms import survives and history remains usable. Cross-account imports are rejected before opening a session.
- Resolver tests cover cached matches, list-only lookups, partial progress followed by 429, resume without repeated successes, reuse across lists, quota denial, mismatched provider identities, invalid profile URLs, and excluding non-connections.
- Runner tests verify one session when initially no targets are matched and reject target IDs outside the imported membership.
- CLI typecheck passed; lint passed with 7 existing warnings. Native CLI and Node builds succeeded. TUI tests: 148 passed; standalone rebuilt with the updated CLI. TUI source remains unchanged.
- Required CodeDB refresh probes passed.

## Private data recovery

Replayed the four previously archived successful search responses through the production list reader with a memory-only request adapter that rejects missing pages. It recovered exactly 76 unique members; no network fallback existed. Generated an account-scoped import and passed it through the new offline preparation command.

Result: 76 imported, 53 matched locally, 1 already deep-saved, 52 matched profiles awaiting deep enrichment, and 23 identities deferred. A private HTML review was generated. Raw member records, profile context and exports remain outside the repository.

## Coverage limits

Live per-member identity resolution remains unverified while LinkedIn's observed 429 persists. Internal endpoint response changes will stop the resolver without discarding saved imports. `--limit` bounds deep profiles; required identity lookups also consume local quota and are not included in that deep-profile count. No provider cooldown was assumed and no retry loop was started.
