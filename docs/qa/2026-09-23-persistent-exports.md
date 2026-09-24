# Persistent exports and closed-browser recovery QA

## Verified behavior

- Full CLI suite: 719 tests passed. Earlier failures in backend-only mocks were
  fixed to cover the new JSON persistence contract, or explicitly request no-save
  where the test is intentionally about network routing/pacing. No guard was removed.
- Latest metadata/status changes: 11 focused tests passed. Build, typecheck and
  lint passed; lint retains existing informational notices. CodeDB refreshed.
- Raw tests cover environment precedence, private permissions, distinct revisions,
  repeated identical evidence, API pagination, exclusion of request/response
  headers, and preservation through core/non-raw updates. Cache tests prove a
  single saved deep profile consumes zero fetches and no quota until force is used.
- Export tests cover account-qualified upserts, JSON/CSV generation pairing,
  spreadsheet formula escaping, malformed-source failure preserving published
  files, missing observations retained but marked absent, sender-based teammate
  attribution across workspace boundaries, and automatic unchanged-source skips.
- Live local backfill created 13,186 observations across Brian and JP, including
  conversation records and full stored LinkedIn message metadata. Both account
  pairs and the combined pair were generated from existing files only.
- File permissions: JSON/CSV 0600, export directory 0700. CSV and JSON have the
  same row IDs/counts, generation values and valid full-record references. Oversized
  nested records stay complete in JSON; CSV uses short previews and references.
- Saved email evidence maps 1,346 outbound observations to JP and 362 to Brian.
  Other email actors remain external/unknown; workspace location is not ownership.
- No legacy raw profile payloads were present to backfill. Existing normalized
  data was retained; missing historical raw responses were not reconstructed.
- Both configured CDP endpoints (Brian 9222, JP 9233) responded during inspection.
  JP's launcher starts its dedicated browser only for login; ordinary commands
  attach. Recovery instructions use its existing browser opener before activation.
  Browser-close/reopen and a live profile switch were not performed in this task.

## Operational boundaries

No live LinkedIn request, mail connector fetch, message, invitation, reaction,
CRM write or remote publication was needed for this implementation/backfill.
Tests use mocks and disposable stores. Existing unrelated working-tree changes
were preserved; implementation remains uncommitted.

Long-running viewers/listeners refresh exports only when saved sources change.
An abrupt exit can leave exports behind the durable sources; `allman exports
refresh` rebuilds locally. Multi-file readers should compare manifest generations.
Raw capture requires `--raw` or `ALLMAN_RAW=1`; VCR remains a separate recording
facility. Normalized historical fields cannot supply uncaptured raw payloads.
