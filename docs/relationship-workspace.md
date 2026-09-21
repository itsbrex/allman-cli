# Relationship workspace

The relationship workspace reads LinkedIn's file store, a private local Apple Mail copy, and optional read-only Attio identity lookups. It does not send messages, create drafts or invitations, mark remote messages read, or update CRM records. Tags, lists, cadence, snoozes, dismissals, and identity overrides are local.

## Feature scope

This workspace provides shared identities, observed timelines, filters, and follow-up state. The broader upstream proposals remain separate work:

| Proposal | Available foundation | Not implemented here |
| --- | --- | --- |
| [Relationship rank #6](https://github.com/tarkaai/allman-cli/issues/6) | Timestamped, directional LinkedIn and email events | Composite rank, latency/reciprocity factors, decay, pinning, or rank explanations |
| [ICP qualification #7](https://github.com/tarkaai/allman-cli/issues/7) | Canonical contacts, enrichment fields, tags, company/location filters | ICP definitions, LLM qualification, confidence/reasoning, overrides, or re-qualification |
| [Introduction graph #14](https://github.com/tarkaai/allman-cli/issues/14) | Stored first-degree and connections-of edges | Graph traversal, `intro-to`, ranked mutual paths, intro drafts, or outstanding-ask tracking |

Relationship strength and ICP fit would be separate dimensions. Existing cadence-based follow-up reminders are not relationship scores, and direct connection requests are not introductions through a mutual contact.

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

Keys: `1` people, `2` needs reply, `3` awaiting response, `4` companies, `j/k` selection, `r` rebuild local view, `:` commands, Escape close. Commands include `geo`, `company`, `tag`, `channel`, `account`, `clear`, `save`, `list`, `tag-add`, `tag-remove`, `link`, `unlink`, `cadence`, `snooze`, `dismiss`, and `acknowledge`. TUI writes always go through CLI.

## Verification boundaries

Unit and TUI tests use synthetic records and mocked send/network functions. Live Attio tests may query records read-only. A live mail import only reads indexed local messages and writes private local copies. Global CLI/TUI shims and browser configuration are separate from these checkout builds; installing or publishing this branch is not implied by passing tests.
