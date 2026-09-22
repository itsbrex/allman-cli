# Relationship workspace

The relationship workspace reads LinkedIn's file store, a private local Apple Mail copy, and optional read-only Attio identity lookups. It does not send messages, create drafts or invitations, mark remote messages read, or update CRM records. Tags, lists, cadence, snoozes, dismissals, and identity overrides are local.

## Feature scope

The local CLI now provides shared identities, observed timelines, follow-up state, composable groups, history-derived rank, versioned ICP qualification, and observed introduction paths. See the [release evidence](releases/2026-09-22-relationship-intelligence.md) and [CLI workflows](../README.md#local-tag-groups).

| Proposal | Implemented locally | Remaining boundaries |
| --- | --- | --- |
| [tarkaai/allman-cli#6](https://github.com/tarkaai/allman-cli/issues/6) | Explainable history score, latency/reciprocity, decay, pins, audited overrides | Heuristic, incomplete-history caveats; no seniority inference |
| [tarkaai/allman-cli#7](https://github.com/tarkaai/allman-cli/issues/7) | Multiple versioned definitions, deterministic rules, validated offline LLM handoff, confidence/evidence, freshness, overrides and combined filters | No automatic external model/provider calls; natural-language fit needs reviewed evidence |
| [tarkaai/allman-cli#14](https://github.com/tarkaai/allman-cli/issues/14) | Observed graph and ranked `intro-to` paths with both legs explained | Unknown peer strength stays null; no drafting, sending, ask tracking or semantic LLM search |

Relationship strength and ICP fit remain separate dimensions. Cadence-based follow-ups are independent of scores. The companion TUI exposes fit/rank evidence in view 5 and observed introduction queries in view 6, including filters, local overrides, rule qualification and private handoff export. ICP definitions and model-result imports remain CLI workflows. Use a matching current CLI build when running the TUI.

### Saved ICP context

Business-specific source material can be kept privately in `icp/<name>.reference.json` under the relationship workspace. Reference files are preserved source context. Runtime definitions now live in `icp/definitions.json` and are created with `allman icp define <id> --file <definition.json>`. The original reference is not silently treated as executable configuration.

The Cresa reference, `icp/cresa.reference.json`, retains the supplied Extrovert AI settings, source path and SHA-256, derived buyer/organization/footprint criteria, discovery preference, and messaging context. It also records requirements for separately explainable ICP fit and relationship strength, unknown evidence, and introduction paths backed by observed edges. Derived requirements are labeled as interpretations; scoring weights, numeric size thresholds, geography restrictions, and confidence cutoffs remain unspecified. Saving the reference alone changes no contacts or graph edges. A private versioned Cresa runtime definition now carries buyer-role, company-scale, footprint and buying-initiative requirements. It deliberately leaves unspecified thresholds unspecified. Natural-language requirements remain unknown without reviewed supporting evidence.

## Store boundary

LinkedIn person records remain keyed by flagship ID. Companies keep their numeric LinkedIn company IDs. The shared observation policy preserves curated fields, skips missing/empty values, rejects stale equal-priority observations, and supports explicit authoritative clearing.

Mail and relationship data live outside the Git-backed LinkedIn store:

```text
~/.local/share/allman/relationship-workspaces/<SHA256-of-absolute-store-path>/
  mail-config.json          enabled accounts and source command; no credentials
  mail-runs.json            frozen windows, cursors, errors, coverage
  mail-index.json           message keys
  mail/                    local message copies
  contacts.json            local tags, cadence, confirmed identity links
  attio-lookups.json        reduced read-only CRM lookup evidence
  rank-overrides.json       local score/pin decisions and audit history
  icp/definitions.json     versioned runtime ICP definitions
  icp/qualifications.json  results, evidence fingerprints and override history
  icp/exports/             private bounded offline LLM handoffs
  icp/*.reference.json     private ICP context; not loaded by current CLI
  relationship-settings.json
  relationship-view.json   derived TUI view
```

Directories are private (0700); records use atomic 0600 writes. A single writer lock prevents concurrent workspace changes. `ALLMAN_RELATIONSHIP_STORE` may override the location but must remain outside the LinkedIn store. A source import window is not a deletion/retention policy: existing local copies are retained.

## Read-only Apple Mail ingestion

Use the same store for CLI and TUI. The TUI defaults to `~/.allman`; select that existing CLI store once with `allman store use ~/.allman`, or pass the same explicit `--store` path throughout. CLI precedence is `--store`, `ALLMAN_STORE`, saved selection, then `./.allman`.

```bash
allman --store ~/.allman mail accounts
allman --store ~/.allman mail configure --all-accounts --days 90
allman --store ~/.allman mail sync
allman --store ~/.allman mail status
allman --store ~/.allman relationships refresh
```

The MCP source must expose `export_emails_page`. To use an unregistered checkout, add `--command /absolute/path/to/.venv/bin/apple-mail-mcp` when configuring. The adapter forces `APPLE_MAIL_READ_ONLY=1`, allows only `list_accounts` and `export_emails_page`, and never logs message bodies or server stderr. The source excludes Drafts, Junk, and Trash.

`--max-pages 1` bounds a pilot per account. Subsequent sync resumes the exact cursor. Completed windows use a two-day overlap. After the source index finishes a full refresh/backfill, use `mail sync --reconcile` to replay the whole configured window. Replays deduplicate local records while retaining account and mailbox copies.

“Indexed complete” means every page in that indexed window was processed without read errors. It does not prove a complete remote archive. The global inventory checkpoint controls staleness; watcher activity is not proof of a fresh full scan. Failed or missing files remain explicit gaps. Follow-up candidates from mail remain provisional.

## LinkedIn → Attio → email

1. Read the person's current public LinkedIn URL from the canonical allman person record.
2. Query Attio **people.linkedin**, then compare normalized exact URLs locally. Attio's LinkedIn attribute is not unique in this workspace.
3. A single fresh exact match supplies its **email_addresses**, creating a reversible view join to stored mail identities.
4. Missing, duplicate, stale (>24h), unavailable, or conflicting results keep identities separate. An API failure is never “not found.” Manual links and unlinks take precedence.

Normalization handles scheme, known LinkedIn host variants, query strings, fragments, trailing slashes, and vanity-handle case. Opaque `ACo`/`ACw` identifiers retain case. Company URLs, SalesNav URLs, redirects, name similarity, and alternate LinkedIn IDs do not establish identity. A no-match result does not prove someone lacks an Attio record under another URL.

```bash
allman --store ~/.allman attio candidates
allman --store ~/.allman attio lookup https://www.linkedin.com/in/example-person
allman --store ~/.allman attio sync
allman --store ~/.allman attio status
allman --store ~/.allman relationships review
```

The standalone adapter reads `ATTIO_API_KEY` or `ATTIO_ACCESS_TOKEN` from the environment; use a credential manager, not command-line token arguments. Its only HTTP endpoint is the read-only `POST /v2/objects/people/records/query`. It paginates before deciding uniqueness. No credentials are copied into the workspace.

The connected `attio-code-mode` integration can supply the same data without configuring a CLI credential. Run `attio candidates`; for each URL, query `people.linkedin` with `$contains` on the profile slug, collect all pages, and export only `id`, `web_url`, and active `linkedin`, `email_addresses`, and `name` values. Import this private file:

```json
{
  "lookups": [{
    "linkedinUrl": "https://www.linkedin.com/in/example-person",
    "checkedAt": "2026-09-19T23:00:00Z",
    "complete": true,
    "records": []
  }]
}
```

```bash
allman --store ~/.allman attio import /private/path/attio-lookup-export.json
```

`records` contains raw reduced Attio records, not an asserted match. Import computes exact matches itself. Use `complete:false` for truncated queries; never import a partial result as a confirmed absence. Neither workflow creates or updates Attio records. Query behavior follows [Attio's filtering documentation](https://docs.attio.com/rest-api/guides/filtering-and-sorting).

## Local views and actions

```bash
allman --store ~/.allman relationships list --geo 'San Diego' --tag VIP
allman --store ~/.allman relationships show <contact-id>
allman --store ~/.allman relationships timeline <contact-id>
allman --store ~/.allman relationships followups
allman --store ~/.allman companies --local
allman --store ~/.allman relationships tag <contact-id> VIP Tenant
allman --store ~/.allman relationships save-list 'SD tenants' --geo 'San Diego' --tag Tenant
allman --store ~/.allman relationships list --list 'SD tenants'
allman --store ~/.allman relationships link <contact-id> --account <account-id> --flagship <person-id>
allman --store ~/.allman relationships unlink <contact-id> --account <account-id> --flagship <person-id>
allman --store ~/.allman relationships cadence <contact-id> 2 5
allman --store ~/.allman relationships snooze <thread-id> --days 3
allman --store ~/.allman relationships dismiss <thread-id>
```

Default cadence: two business days for inbound, five for outbound (weekdays, America/Los_Angeles; no holiday calendar). Only a reply within the same verified thread resolves that thread. Identical message copies preserve all account references. Automated/partial messages do not create candidates. Newer messages reactivate dismissed threads. `acknowledge` records a local watermark; it does not change remote read state.

Company rollups derive current, past, and unknown affiliations, retain concurrent roles, and expose name/domain collisions for review. No company merge happens automatically.

## TUI preview

The companion TUI supports `--relationships`, which opens the local workspace without login, auto-sync, or a composer. From the normal inbox, use `:relationships`, `:people`, or `:geo San Diego`.

Keys: `1` people, `2` needs reply, `3` awaiting response, `4` companies, `5` fit/rank, `6` introductions, `j/k` selection, `r` rebuild local view, `:` commands, `?` help, `[`/`]` scroll evidence, Escape close. Commands include the existing filters/local follow-up actions plus `icp`, `fit`, `sort`, `min-rank`, `confidence`, `facts`, `any-tags`, `all-tags`, `without-tags`, `rank`, `rank-clear`, `pin`, `unpin`, `fit-set`, `fit-clear`, `qualify`, `export`, `graph`, `intro`, and `intro-fit`. TUI writes always go through CLI; introduction queries create no requests or drafts. Fit freshness is shown as of the saved snapshot.

## Verification boundaries

Unit and TUI tests use synthetic records and mocked send/network functions. Live Attio tests may query records read-only. A live mail import only reads indexed local messages and writes private local copies. Global CLI/TUI shims and browser configuration are separate from these checkout builds; installing or publishing this branch is not implied by passing tests.
