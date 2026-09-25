# Offline LinkedIn archive imports

The archive importer reads explicitly selected local exports. It makes no LinkedIn or enrichment-provider requests. Originals remain untouched; byte-identical CSV copies, source dates, row references, and before/after hashes stay in the private relationship workspace.

Create a private manifest outside the repository:

```json
{
  "account": "ACo_SELECTED_ACCOUNT_ID",
  "ownerProfileUrl": "https://www.linkedin.com/in/account-owner",
  "sources": [
    {
      "path": "/path/to/Complete_LinkedInDataExport.zip",
      "member": "Connections.csv",
      "owner": ["Exact First Name", "Exact Last Name from Profile.csv"],
      "kind": "connections",
      "exportedAt": "2026-01-13T00:00:00.000Z",
      "dateBasis": "Official export filename date; time of day unknown"
    }
  ]
}
```

Other kinds are `messages` (`messages.csv`), `invitations` (`Invitations.csv`), and `rich-connections` (CSV containing `linkedin_id`, `linkedin_public_id`, and optionally `salesnavigator_url`). Add one source entry per CSV. ZIP entries require an exact account-owner match against `Profile.csv`. Uncertain ownership must be resolved before selection. File creation dates can be used as approximate snapshot dates, with that limitation in `dateBasis`.

```sh
python3 scripts/prepare-linkedin-archive.py /private/manifest.json /private/archive-sources
ALLMAN_PROFILE=jp bun scripts/import-linkedin-archive.ts /private/archive-sources/bundle.json RUN_ID
ALLMAN_PROFILE=jp bun scripts/import-linkedin-archive.ts /private/archive-sources/bundle.json RUN_ID --apply
allman-jp --json enrich-list review RUN_ID --html
allman-jp --json relationships refresh
allman-jp --json exports refresh
```

The first importer call previews changes. `--apply` performs these stages in order:

1. Add only unresolved members of the selected Sales Navigator run to its account-scoped identity cache. Paired flagship/Sales Navigator IDs must be one-to-one, agree with the current public slug, and belong to a stored connection. Names never establish identity.
2. Fill empty person fields and connection mirrors from the newest available archive value. Preserve existing values, explicit provenance-owned blanks, live observation dates, and enrichment depth. Same-date conflicts are skipped. Each filled field has `linkedin/archive` provenance and a raw CSV row reference. Original source rows retain all fields, including duplicated CSV column names.
3. Upsert archived messages and invitations into `linkedin-archives/ACCOUNT.json`, separate from live conversation synchronization and invitation guards. Relationship views and team JSON/CSV exports include the history. Drafts remain drafts; invitation acceptance is unknown. Invitation dates lacking timezone retain their original text and use day precision. Historical events do not create follow-up tasks or affect message-based relationship ranks. Historical emails remain dated evidence, not automatic identity merges.

Repeated imports are idempotent. Identical repeated messages within one export retain their multiplicity; copies across exports retain source references. Archived messages lack reliable live message IDs, so archive history and live conversation copies are not automatically deduplicated against one another.

Each application writes `linkedin-imports/backups/RUN/journal.json` before changing source records, with exact original bytes in adjacent `*.before.json` files. Concurrent target changes abort the import. For recovery, compare current files against journal `afterHash` before restoring `beforeFile`; a null `beforeFile` means the record was newly created. Never overwrite subsequent user or sync edits during recovery. Interrupted imports can be rerun safely; the original partial journal remains available.

Archive source files and backups contain personal data. They stay outside the repository and team exports reference their local paths. This import does not claim a complete or current LinkedIn archive, and historical fills do not count as completed deep enrichment.
