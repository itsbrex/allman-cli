# Durable raw evidence and team exports

Keep Brian and JP's stores separate. They remain the sources of truth, with their
own connection edges, invitations, messages and private email workspaces. Team
CSV/JSON files are rebuildable views, not a second writable contact database.
No merge uses a person's name. Repeated observations retain their profile and
account; matching identity keys permit joins without overwriting teammate history.

## Raw capture and request reuse

```sh
allman-jp connections --flagship --include-headline --raw --json
ALLMAN_RAW=1 allman-jp enrich --deep
allman-jp enrich some-person              # returns saved adequate enrichment
allman-jp enrich some-person --force      # explicitly spend requests to refresh
```

`--raw` or `ALLMAN_RAW=1` archives successful account-session API JSON responses
before returning them to the caller. This includes response data, method, URL,
query variables, account and observation time. Request/response headers, cookies
and request bodies are excluded. Login/browser automation and realtime byte
streams are not captured by this REST JSON archive. Normal message storage still
persists processed messages. Raw profile enrichment retains its latest mirror and
preserves previous/new revisions in the archive. Identical evidence shares a
content-addressed file; distinct responses, pages and profile revisions survive.

Files live below each private relationship workspace's `raw/<account hash>/`,
normally `~/.config/allman/<profile>/relationships/raw/`. Permissions are 0700 for
directories and 0600 for files, outside the Git-backed LinkedIn store. They can
contain private profile/message content: they are local evidence, not share assets.
Archive failures produce warnings. A remote write is never retried to repair a
local archive failure.

Environment accepts true/false, 1/0, yes/no, on/off. An explicit CLI raw flag wins.
Existing `ALLMAN_VCR=record` retains its latest fixture and now also preserves
content-addressed revisions below `ALLMAN_VCR_DIR/raw/`; it remains a separate test
recording facility, not the team export directory.

Single-target enrichment now honors the same saved depth check as batch enrichment.
`--force` bypasses it. Request-time API archives are evidence, not transparent HTTP
replay: no cached response is substituted for a send, invitation or fresh paging
request. Already-stored normalized fields cannot reconstruct raw responses that
were never captured. Adding `--raw` does not silently re-fetch already-enriched
profiles; use `--force` only when the missing raw evidence is worth the requests.

## Configure and refresh

```sh
allman exports configure --profiles brian,jp \
  --owner brian=brian@example.com,brian@other.example \
  --owner jp=jp@example.com,jp@other.example \
  --enabled true
allman exports refresh
allman exports status --json
allman exports configure --enabled false
```

Replace the example addresses with actual owners. This Mac uses the supplied
Cresa addresses, with automatic refresh enabled. Configuration
is private `~/.config/allman/team-export.json` (or the equivalent XDG config root).
`refresh` reads existing local stores only: it needs no active browser, login, mail
connector or LinkedIn request. It also archives any legacy raw profile mirror it
finds. Owner mapping uses actual sender/recipient email addresses, not which
profile's workspace happened to contain a copy. Unmapped senders remain unknown.

The output folder is `~/.config/allman/team-exports/`:

- `brian.json` and `brian.csv`
- `jp.json` and `jp.csv`
- `team.json` and `team.csv` (combined observations)
- `manifest.json` (publication generation and row counts)

Normal completion of data commands refreshes configured exports, including
connection imports, enrichment, messages, sends, reactions, invitations, local
relationship changes and mail imports. `listen`/`start` also refresh every minute.
Automatic checks skip publication when source files are unchanged. Files changing
during a scan defer publication until a stable refresh. An interrupted process
may leave exports behind the saved store; `exports refresh`
recovers locally. A failed refresh never causes a provider operation to repeat.
Concurrent refreshes use a workspace lock; a busy/error warning leaves source data
intact and gives the refresh command. A stale lock is not forcibly removed.

Connection `--json` output now saves records, just like normal output. Use explicit
`--no-save` for ephemeral output. `--csv <path>` remains the requested one-run CSV;
the separate automatic files provide the durable upsert. Explicit `--no-save`
skips store writes and automatic export refresh; separately requested raw capture
still archives API evidence. Existing `--enrich --json` incompatibility is retained;
run enrichment separately when streaming connections as JSON.

## Reading the files

JSON contains a `rows` array with complete structured data. CSV has the same row
IDs and a spreadsheet-friendly projection: company/title/subject, 240-character
body previews and `fullRecord` references back to JSON. Full bodies and nested
facts are preserved in JSON, not crammed into oversized CSV cells. Primary columns
include profile, name,
kind, source key, relationship-from identity, account, person keys, actor profile,
team members, channel, direction, status,
observation time and raw references. Raw payloads remain in their archive files.
No AUTH, COOKIES, account config or runtime-secret files enter exports.

Kinds distinguish contacts, LinkedIn/email activity, full saved LinkedIn messages
(including stored attachment/reaction metadata), conversation records, follow-up candidates,
connections, Sales Navigator connections, observed connections-of, companies and
sent invitations. Profile/account-qualified stable row IDs make refresh idempotent.
Team rows intentionally retain separate observations from Brian and JP. Source
mail metadata/copies and LinkedIn references remain available inside each activity's data; the common mail body is stored once on the event.

`connection-observed` means an observed first-degree edge, not proof it still
exists now. `invitation-sent; acceptance-unknown` means exactly that: no acceptance
is invented. An observed connections-of result does not prove either teammate
personally knows that person. Existing coverage warnings and provisional follow-up
states remain visible. No stored archive is presented as complete remote history.

Upsert retains previously exported observations. Missing rows become
`presentInLatestSnapshot: false`; absence is not interpreted as an unfollow,
disconnection, deletion or invitation rejection. Filter on that field for current
local observations while preserving historical reference data.

Each file is replaced atomically with private permissions. All six files carry the
same generation; the manifest is published last. Readers needing a consistent
multi-file snapshot must compare generations. If publication was interrupted,
rerun `exports refresh`. CSV formula-like scalar values are escaped; JSON retains
original values. No export sends messages, changes CRM, switches profiles or
publishes data externally.
