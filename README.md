# allman

LinkedIn messenger from the CLI. File-backed, git-versioned, designed for AI agents and humans.

Messages are stored locally as JSONL files in a git repository. All reads come from disk. Network calls go to LinkedIn's private APIs using cookies captured via a headed Playwright browser session.

> **Want a terminal inbox UI on top of this?** See the companion repo, [`tarkaai/allman-tui`](https://github.com/tarkaai/allman-tui). It bundles the `allman` binary, so installing the TUI gets you both.

---

## Relationship workspace (development branch)

Read-only Apple Mail ingestion, Attio LinkedIn-URL matching, local relationship timelines, tags, saved lists, follow-up review, and company affiliations are documented in [Relationship workspace](docs/relationship-workspace.md). Mail and CRM evidence stay outside the Git-backed LinkedIn store.

## Installation

### From GitHub Releases (Linux and macOS, x64 and arm64)

```bash
curl -fsSL https://raw.githubusercontent.com/tarkaai/allman-cli/main/install.sh | bash
```

Pin a version or change the install prefix:

```bash
curl -fsSL .../install.sh | VERSION=2026-04-20.1-alpha bash
curl -fsSL .../install.sh | PREFIX=$HOME/.local bash
```

Or grab a binary directly from the [releases page](https://github.com/tarkaai/allman-cli/releases).

### From source

Requires [Bun](https://bun.sh) (latest, via asdf or direct install).

```bash
git clone git@github.com:tarkaai/allman-cli.git
cd allman-cli
bun install
bun run build          # atomic Playwright-aware compile to dist/allman
```

Add `dist/allman` to your `$PATH`, or run directly with:

```bash
bun run dev -- <command> [options]
```

For day-to-day development, `bun run link` puts the working tree on your PATH instead — it
symlinks `~/.local/bin/allman` at `bin/allman`, a shim that execs `bun src/index.ts`, so `allman`
always runs your current source with no build step:

```bash
bun run link           # ~/.local/bin/allman -> ./bin/allman
bun run link --force   # ...moving an installed allman aside first
bun run unlink         # remove it, restore whatever was displaced
```

An `allman` installed by `install.sh` is kept at `allman.pre-dev-link` and restored by `unlink`.
[`allman-tui`](https://github.com/tarkaai/allman-tui) has the same `link` script, and its shim
prefers a sibling checkout of this repo — link both and the dev TUI drives the dev CLI.

Browser sessions require LinkedIn Shield and use a persistent workspace. Configure once with your runtime-only Shield build:

```bash
allman browser configure --browser browseros-neo --shield /path/to/linkedin-shield/dist
allman browser doctor --json
# Without BrowserOS neo: install the bundled browser, then configure it.
allman install-browsers
allman browser configure --browser chromium --shield /path/to/linkedin-shield/dist
```

---

## Quick start

```bash
allman login                       # opens browser, saves session
allman sync                        # pull conversation history (default: since last sync)
allman conversations               # list conversations
allman messages sarah-chen         # show messages with sarah-chen
allman send sarah-chen "Hey!"      # send a message
allman listen                      # stream real-time events to stdout as NDJSON
```

---

## Commands

### Global flags

All commands accept these flags:

| Flag | Description |
|------|-------------|
| `-a, --account <slug>` | Account to use (default: `$ALLMAN_ACCOUNT`, or the only account if there is one) |
| `-s, --store <path>` | Store directory (default: `$ALLMAN_STORE`, then saved `allman store use` selection, then `./.allman`) |
| `--json` | Output as machine-readable JSON (stdout) |
| `--debug` | Verbose debug output to stderr |

---

### `allman login`

Authenticate with LinkedIn in the configured persistent browser. LinkedIn Shield must pass verification before the CLI opens LinkedIn. Complete login in the headed window; LinkedIn cookies are captured automatically. See [browser support and setup](docs/browser-support.md).

```bash
allman login
allman login --account your-account
allman login --proxy host:port
allman login --proxy host:port:username:password
allman login --profile ~/.allman/dedicated-login  # optional explicit persistent profile
allman login --cdp 9222                    # attach to a browser you already have running (see below)
allman login --browser browseros-neo       # override the saved browser
```

On success, writes `AUTH.json` and `COOKIES.json` to the store and creates a slug symlink for the account.

**Reusing an existing browser session (`--cdp`).** Start a browser yourself with remote debugging, log in (or already be logged in), install the configured Shield build in that profile, then attach. The CLI verifies Shield, uses its own tabs, reads the live LinkedIn cookies, and disconnects without closing your browser or injecting cookies:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.allman/chrome-debug"
allman login --cdp 9222
```

On Bun 1.3.14, use the [Node entry for CDP](docs/browser-support.md#existing-browsers-and-cdp); its Playwright WebSocket transport fails in Bun. Chrome 136+ refuses remote debugging on its *default* profile (and a running Chrome locks it), so the `--user-data-dir` override is required — you can't point at your daily profile directly. Log into LinkedIn once in that side profile and it stays a known device from then on. `--profile` is the simpler managed version of the same idea.

**Options:**

| Flag | Description |
|------|-------------|
| `--account <slug>` | Account name to create or re-authenticate |
| `--proxy <host:port[:user:pass]>` | HTTP proxy for this account (saved to `config.json`) |
| `--browser <channel>` | `browseros-neo` \| `browseros` \| `chromium` or a Playwright channel; explicit choices never fall back |
| `--profile <dir>` | Override the dedicated persistent login profile |
| `--shield <dir>` | Override the saved LinkedIn Shield runtime build |
| `--cdp <url\|port>` | Attach to an already-running browser with `--remote-debugging-port`; never closes it |

---

### `allman logout`

Clear session cookies for an account. Does not delete message history.

```bash
allman logout
allman logout --account your-account
```

---

### `allman status`

Show authentication status for one or all accounts.

```bash
allman status
allman status --account your-account
allman status --json
```

Output includes: profile slug, name, auth status, local cookie presence, last sync time, proxy, and store path. This is a local check; a successful API read proves the remote session still works.

Browser sign-in and CLI login are separate. A Neo MCP import can create an account without saving cookies; `allman login` authorizes direct CLI access and stores LinkedIn-only cookies in a Git-ignored `0600` file. Every browser login or cookie reuse verifies the exact Shield build, active blocking rules, site access, and background worker first. An attached browser uses its own session and never receives saved-cookie injection.

To use one existing store from any directory:

```sh
allman store use /absolute/path/to/.allman
allman status
```

The selected absolute path is saved in `$XDG_CONFIG_HOME/allman/default-store.json` (normally `~/.config/allman/default-store.json`). Explicit `--store` and `ALLMAN_STORE` settings still take precedence. Without a selection, the upstream `./.allman` default remains.

---

### `allman start`

Verify auth (login if needed), sync from the last sync date, then run `listen` indefinitely. Designed as a single entrypoint for daemon use.

```bash
allman start
allman start --account your-account
```

---

### `allman sync`

Pull conversation history from LinkedIn into the local store.

```bash
allman sync                         # sync all conversations since last sync
allman sync --since 3mo             # sync all conversations from 3 months ago
allman sync --since 2025-01-01      # sync from a specific date
allman sync sarah-chen              # sync only this conversation
```

**Behavior:**
- Default window: since `lastSyncAt` in `AUTH.json`. Falls back to 90 days if no prior sync.
- Fetches conversation list, then messages for each conversation.
- Resolves the contact's LinkedIn `publicIdentifier` (slug) via the profile API, with exponential backoff on rate limits.
- Writes `RECORD.json` and `messages/YYYY-MM.jsonl` files for each conversation.
- Auto-commits the store on completion.

**Options:**

| Flag | Description |
|------|-------------|
| `[conversation]` | Sync a single conversation (slug, profileId, or convId) |
| `--since <duration\|date>` | Duration (`1h`, `3d`, `1w`, `3mo`, `1y`) or ISO date (`YYYY-MM-DD`) |

---

### `allman listen`

Stream real-time LinkedIn events to **stdout** as NDJSON. All logs go to stderr.

```bash
allman listen
allman listen --account your-account

# Pipe to a handler
allman listen | while read -r event; do
  echo "Event: $event"
done
```

**Event types emitted:**

| Event | Description |
|-------|-------------|
| `connected` | SSE connection established |
| `heartbeat` | Keep-alive (every 60s) |
| `message.received` | Inbound message from a contact |
| `message.sent` | Outbound message echo (confirming delivery) |
| `typing` | Contact is typing |
| `read_receipt` | Contact read a message |
| `reaction` | Reaction added or removed |

Each event is a JSON object on a single line. Example:

```json
{"event":"message.received","account":"ACoAA...","timestamp":1704067200000,"conversation":{"urn":"urn:li:messagingThread:...","convId":"2-abc123","name":"Sarah Chen","slug":"sarah-chen"},"from":{"urn":"urn:li:fsd_profile:...","name":"Sarah Chen"},"message":{"urn":"urn:li:messagingMessage:...","body":"Hey, got a minute?","isFromMe":false}}
```

**Behavior:**
- Reconnects automatically with exponential backoff (1s → 2s → 4s → ... → 60s).
- Sends a heartbeat POST to LinkedIn every 60s to keep the connection alive.
- Persists received messages to the local store (JSONL files).
- Appends inbound messages to `INBOX.jsonl` (gitignored) for hook-based integrations.
- Schedules a debounced git commit after each new message (5s debounce).
- Fetches missing message body from the API when SSE delivers an empty body.
- Fetches and upserts conversation metadata for unknown conversations on first contact.

---

### `allman conversations` (alias: `convs`)

List conversations from the local store, sorted by most recent activity.

```bash
allman conversations
allman conversations --limit 20
allman conversations --json
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `-n, --limit <n>` | 50 | Max conversations to show |

---

### `allman messages <conversation>`  (alias: `msgs`)

Show messages for a conversation. Auto-syncs if the conversation is not found locally or if the last sync was more than 1 minute ago.

```bash
allman messages sarah-chen
allman messages sarah-chen --limit 100
allman messages sarah-chen --since 2025-01-01
allman messages "https://www.linkedin.com/in/sarah-chen"
allman messages "urn:li:messagingThread:2-abc123"
allman messages sarah-chen --no-sync   # skip auto-sync
```

The `<conversation>` argument accepts:
- LinkedIn profile slug (e.g. `sarah-chen`)
- LinkedIn profile URL (e.g. `https://www.linkedin.com/in/sarah-chen`)
- Conversation URN (e.g. `urn:li:messagingThread:2-abc123`)

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `-n, --limit <n>` | 50 | Max messages to show |
| `--since <date>` | — | ISO date filter |
| `--no-sync` | — | Skip auto-sync |

---

### `allman send <to> <text>`

Send a message to a LinkedIn contact.

```bash
allman send sarah-chen "Hey, how are you?"
allman send "https://www.linkedin.com/in/sarah-chen" "Hello!"
allman send "urn:li:messagingThread:2-abc123" "Following up"
```

The `<to>` argument accepts a slug, profile URL, or conversation URN.

**Behavior:**
- **Pre-send sync**: fetches the 10 most recent messages before sending. If there are new inbound messages since the last sync that arrived after your last reply, the send is **aborted** and the new messages are shown. Re-run after reading them.
- **New conversations**: if no existing thread is found (in local store or via LinkedIn API), starts a new conversation.
- **Rate limiting**: minimum 3000ms between sends (configurable). State persisted to `rate-state.json` across process restarts.
- Stores the sent message locally and commits the store.

---

### `allman search <query>`

Search contacts and conversations by name, slug, or profile ID. Fuzzy matching with confidence scores.

```bash
allman search "sarah"
allman search "ali smi"    # matches "Alice Smith"
allman search sarah-chen
allman search --limit 5 "sarah"
allman search --json "sarah"
```

**Confidence scoring:**

| Score | Match type |
|-------|-----------|
| 100 | Exact slug or profile ID |
| 95 | Exact name (case-insensitive) |
| 80 | Name starts with query |
| 70 | Every query word matches a word start in name (`"ali smi"` → `"Alice Smith"`) |
| 60 | Name or slug contains query as substring |
| 40 | Any query word found in name or slug |

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `-n, --limit <n>` | 10 | Max results |

---

### `allman inbox`

Show new messages since the last time `inbox` was run (watermark-based). Syncs first, then scans all conversations for inbound messages newer than the watermark.

```bash
allman inbox
allman inbox --since 1h        # override watermark
allman inbox --no-mark         # don't advance the watermark
allman inbox --limit 10
allman inbox --json
```

The watermark is stored in `inbox-state.json` (gitignored). On first run, defaults to 24 hours ago.

Per-conversation read tracking: if you sent a message to a conversation, that conversation is considered read up to the time of your send, so it won't appear in `inbox` unless a reply arrives after that.

**Options:**

| Flag | Description |
|------|-------------|
| `--since <duration\|date>` | Override watermark (`1h`, `3d`, `1w`, or ISO date) |
| `--no-mark` | Don't advance the watermark after viewing |
| `-n, --limit <n>` | Max conversations to show |

---

### `allman grep <query>`

Full-text search across all locally stored message bodies. Scans JSONL files directly.

```bash
allman grep "project proposal"
allman grep "contract" --since 3mo
allman grep "meeting" --limit 100
allman grep "invoice" --json
```

Results are sorted newest-first.

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--since <duration\|date>` | — | Only search messages after this date |
| `-n, --limit <n>` | 50 | Max results |

---

### `allman connections`

Export your 1st-degree LinkedIn connections into the store. Random 2–8s delay between pages, no profile-page scraping.

**Two backends.** The flagship API is the default; `--salesnav` opts into Sales Navigator, which returns profile data inline but **cannot see past 2,500 connections**.

| | flagship (default) | Sales Navigator (`--salesnav`) |
|---|---|---|
| Identifies people by | flagship ID + **public slug** | SalesNav ID + **numeric member ID** |
| Profile data included | no — run `allman enrich` | **yes** — title, company, location, about |
| Result ceiling | **none** — your whole network | **2,500, hard** (`start=2500` → HTTP 400) |
| Also gives you | `connectedAt` | `degree`, `pendingInvitation` |
| Stored in | `connections/` | `connections-salesnav/` |

> **Why flagship is the default even with a seat:** Sales Navigator refuses to paginate past 2,500 results, so on any network larger than that it would silently return only part of it — hence opt-in. The flagship resource has no such cap.

> **The two stores don't merge automatically.** SalesNav search returns no public slug, so its records live separately and only flagship records can be passed straight to `allman send` / `allman connect`.

```bash
allman connections                       # store all connections (per-file + symlinks), git-committed
allman connections --limit 500           # cap the number fetched
allman connections --csv ./conns.csv     # also export a CSV
allman connections --no-save --csv x.csv # CSV only, don't write the store
allman connections --json                # stream NDJSON to stdout (ephemeral; no store write)
allman connections --include-headline    # also store the headline
allman connections --enrich              # also fetch each connection's full profile
allman connections --enrich --deep       # ...including work history, education, skills
allman connections --salesnav            # Sales Navigator (core fields inline, no slugs)
allman connections --flagship            # force flagship (slugs, needs `enrich`)
allman connections --geo "austin"        # LOCAL query: stored records whose geo name matches (no network)
allman connections --geo urn:li:fsd_geo:90000064 --json   # exact geo urn, as NDJSON
allman connections --geo-granularity metro                # only metro-precision geo records
```

Writes `{myProfileId}/connections/{flagshipId}.json` per connection plus a `{slug} -> {flagshipId}.json` symlink. Re-running is idempotent: `firstSeenAt` is preserved and `lastSeenAt` is refreshed.

Inline `connections --enrich` shares the persisted quota with `enrich`. It requires stored flagship records: `--json`, `--no-save`, and `--salesnav` cannot be combined with it. `--deep` requires `--enrich`; Sales Navigator exports do not include the full education/skills pass. Use `connections` followed by `enrich --deep` for that workflow.

**Local geo query.** `--geo` / `--geo-granularity` switch the command into a pure local query over records already on disk — no session, no network. A `urn:li:fsd_geo:<id>` filter matches `geoUrn` exactly; anything else is a case-insensitive substring of the structured geo name; repeat `--geo` to OR filters. Every run reports coverage (`n structured / m total`) because structured geo only exists on records enriched since the geo fields landed — coverage grows as you enrich, there is no backfill.

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `-n, --limit <n>` | all | Max connections to fetch |
| `--page-size <n>` | 100 | Results per request (max 500) |
| `--csv <path>` | — | Also export a CSV to this path |
| `--no-save` | — | Don't write to the store (use with `--csv`) |
| `--include-headline` | — | Include the LinkedIn headline |
| `--enrich` | — | After storing, fetch each connection's full profile (see `allman enrich`) |
| `--deep` | — | With `--enrich`: also fetch work history, education, and skills |
| `--salesnav` | auto | Force Sales Navigator (errors without a seat) |
| `--flagship` | auto | Force the flagship backend |
| `--geo <name\|urn>` | — | Local query: filter stored records by geo (repeatable, OR-ed; no network) |
| `--geo-granularity <level>` | — | Local query: keep only `metro`, `country`, or `unknown` precision |
| `--json` | — | Stream NDJSON to stdout (no store write) |

---

### `allman connections-of <slug>`

List the 1st-degree connections of another person (`<slug>` = a LinkedIn slug or profile URL). Results are stored under `connections-of/{targetId}/`.

Two backends, chosen automatically:
- **Sales Navigator** (default when the account has a seat): `salesApiLeadSearch` with a `CONNECTION_OF` filter. Returns SalesNav id + numeric member id. ~2,500-result cap.
- **Flagship** (fallback, or `--flagship`): `voyagerSearchDashClusters` people search with `connectionOf` + `network=[S]`. Returns flagship id + numeric member id + slug. ~1,000-result cap. The (rotating) queryId is discovered from the live bundle and cached in `query-cache.json`.

```bash
allman connections-of jane-doe                 # auto: SalesNav if a seat exists, else flagship
allman connections-of jane-doe --flagship      # force flagship (no fallback)
allman connections-of jane-doe --salesnav      # force SalesNav (errors without a seat)
allman connections-of jane-doe --csv ./x.csv   # also export a CSV
allman connections-of jane-doe --json          # stream NDJSON (no store write)
```

> Only works for people whose network LinkedIn exposes to you (generally your own 1st-degree connections). If a search returns nothing, the command stops before paginating further.

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `-n, --limit <n>` | backend cap | Max results to fetch |
| `--flagship` | — | Force flagship (no fallback) |
| `--salesnav` | — | Force Sales Navigator (no fallback; errors without a seat) |
| `--csv <path>` | — | Also export a CSV to this path |
| `--no-save` | — | Don't write to the store (use with `--csv`) |
| `--json` | — | Stream NDJSON to stdout (no store write) |

The SalesNav seat is captured automatically by `allman login` (it visits Sales Navigator once and saves the `li_a` cookie); `allman login --no-salesnav` skips that step.

---

### `allman enrich [target]`

Turn stored connections (IDs + name) into full **profiles**: current title, company, location, and About — plus, with `--deep`, full work history, education, and skills. Results are written back onto each connection record with an `enrichedAt` stamp, so re-runs skip already-enriched people (unless `--force`). Fetches use the flagship profile **API** (no profile-page scraping) and are paced with the same 2–8s delay as `connections`.

`--limit` and `--page-size` accept positive integers only; malformed, fractional, zero, and negative bounds fail before account or network access. Opaque `ACo` profile IDs retain their case whether passed directly or inside a profile URL.

Every enrichment also writes a **person record** — `people/{flagshipId}.json` (+ slug symlink) — the single owner of person facts, with per-field provenance `{source, observedAt}`. A re-enrich only overwrites a field whose provenance is equal-or-worse (`user` edits are never auto-overwritten), and readers prefer the person record over the connection-record mirror. Structured geo (`geoUrn`, `geoName`, `geoGranularity`) lands here; query it with `allman connections --geo`.

LinkedIn serves this across several resources, so enriching one person costs **2 requests** (4 with `--deep`). Budget accordingly on large networks — that's why `--limit` exists.

```bash
allman connections                 # first, pull the connection list
allman enrich                      # then fill in profiles (core fields)
allman enrich --deep               # include work history, education, skills
allman enrich --limit 200          # at most 200 profile attempts, including failed reads
allman enrich --force              # re-fetch even already-enriched records
allman enrich sarah-chen           # enrich a single person (adds them if new)
allman enrich --json               # stream enriched records as NDJSON
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `[target]` | — | A slug, URL, or profile URN to enrich one person (omit to enrich all stored connections) |
| `--deep` | — | Also fetch work history, education, and skills |
| `--raw` | — | Also store LinkedIn's untouched payloads on each record — see below |
| `--force` | — | Re-fetch even connections already enriched |
| `-n, --limit <n>` | all | Max profiles to fetch this run |
| `--json` | — | Stream enriched records to stdout as NDJSON |

> Enriching reads only what your own LinkedIn session already shows you. `ALLMAN_PROFILE_DECORATION` overrides the profile decoration if LinkedIn rotates it.

`--raw` keeps LinkedIn's untouched entity payloads on each record under `raw`, so you can see what the parsers dropped. They are roughly 10x the size of the parsed record — at ~9,000 connections that is a third of a gigabyte in a git-versioned store, rewritten on every pass — so turn it on for a sample when you suspect a field is missing, not for a bulk run.

#### Rate limits

Profile enrichment and connection requests are the two endpoints most likely to get an account restricted, so both carry a **volume cap that persists across runs** — closing the CLI and re-running does not hand you a fresh allowance. Defaults depend on whether you have a Sales Navigator seat:

| | With a SalesNav seat | Without |
|---|---|---|
| **Enrichment** | 100 / hour | 25 / day |
| **Company lookups** | 500 / hour | 100 / day |
| **Connection requests** | 40 / day | 10 / day |

Company lookups keep their own ledger rather than sharing the enrichment one: they read org pages on a different LinkedIn resource, so resolving employers never eats the budget for enriching people. When a cap is hit, `enrich` and `companies` stop early and tell you when capacity returns; `connect` refuses. Already-enriched records that get skipped don't consume quota. The Sales Navigator connections sweep is a bulk list operation and is *not* billed per person.

Override per account in `config.json`:

```json
{
  "rateLimit": {
    "maxEnrichments": 100,
    "enrichmentWindowMs": 3600000,
    "maxCompanyLookups": 500,
    "companyWindowMs": 3600000,
    "maxInvitesPerDay": 40,
    "minInviteIntervalMs": 60000
  }
}
```

> These limits exist to protect your account. Raising them is your call and your risk — LinkedIn enforces its own limits server-side regardless.

---

### `allman companies [target]`

Resolve the companies behind stored work history. Every position carries a `companyUrn`, so the employer can be looked up directly instead of guessing a domain from the company name.

```bash
allman companies                   # resolve every employer referenced by stored connections
allman companies --current-only    # only people's current employers
allman companies --limit 200       # cap how many to fetch this run
allman companies --force           # re-fetch companies already stored
allman companies urn:li:fsd_company:11850   # resolve one company
allman companies marketbridge      # ...by slug or numeric id too
```

A URN or numeric id is fetched directly. A vanity slug costs one extra request first, to resolve it to an id.

Records land in `{myProfileId}/companies/{id}.json`, shared by everyone who works there, with a `{universalName} -> {id}.json` symlink. Re-running is idempotent and merges: a later, sparser response never downgrades a known value to null.

| Field | Notes |
|---|---|
| `website` | The company's own site (`companyPageUrl`) — not the LinkedIn page |
| `staffCount`, `staffCountRange` | Exact headcount when exposed, plus the band (e.g. `{start: 2, end: 10}`) |
| `industries` | Standardized industry names |
| `foundedYear`, `companyType`, `specialties`, `headquarters` | From the company profile |
| `followerCount`, `logoUrl` | `logoUrl` is a signed CDN URL and expires — a cache, not a permalink |
| `autoGenerated` | True for LinkedIn's machine-created stub pages — weak evidence about the firm |

| Option | Default | Description |
|---|---|---|
| `[target]` | — | A company URN, numeric id, or LinkedIn company slug to resolve one company |
| `--current-only` | — | Only resolve employers of people's current roles |
| `--force` | — | Re-fetch companies already stored |
| `-n, --limit <n>` | all | Max companies to fetch this run |
| `--json` | — | Stream resolved companies as NDJSON |

Paced with the same random 2–8s delay as the other bulk readers, and metered on **its own quota** — 500/hour with a Sales Navigator seat, 100/day without — rather than the enrichment one, since it reads org pages on a different LinkedIn resource. A company that can't be fetched (restricted, deleted, 403) is skipped rather than ending the run.

---

### `allman connect <target>`

Send a connection request, optionally with a personalized note. `<target>` = a LinkedIn slug, URL, or profile URN.

**Conservative by design** (allman is not a cold-outbound tool — see `RESPONSIBLE_USE.md`): it won't re-invite anyone already in your stored connections or anyone allman has already invited; the note is capped at LinkedIn's 300-char limit; and invitations run on their own slow rate limit (default one per minute, persisted across runs).

> The "already connected?" check reads your **local** store, so run `allman connections` first for it to be meaningful — LinkedIn's server-side relationship endpoint no longer works. If someone isn't in your store, allman will attempt the invite and surface LinkedIn's own response.

```bash
allman connect sarah-chen                              # bare connection request
allman connect sarah-chen --note "Hi Sarah — loved your talk on X."
allman connect https://www.linkedin.com/in/sarah-chen --note "..." --dry-run  # preview, don't send
```

Sent invitations are stored under `{myProfileId}/invitations/{inviteeId}.json`.

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--note <text>` | — | Personalized note (max 300 chars) |
| `--dry-run` | — | Preview the request without sending |
| `--json` | — | Output as JSON |

allman also caps invitations locally — **40/day** with a Sales Navigator seat, **10/day** without — persisted across runs. See [Rate limits](#rate-limits).

> LinkedIn caps invitations server-side too — free accounts limit invitations *with a note* (~5/month) and have weekly invite caps. A 403 from this command usually means you've hit one of those limits.

---

### `allman store`

Manage the local file store.

```bash
allman store path              # print the store path
allman store status            # show account and conversation counts
allman store commit "message"  # manually trigger a git commit
```

---

### `allman install-browsers`

Install Playwright's bundled Chromium. Optional: `allman login` uses your installed Google Chrome or Microsoft Edge automatically and only falls back to the bundled build when neither exists.

```bash
allman install-browsers
```

---

## Local store layout

The store is a git repository. All message history is committed; session-sensitive files are gitignored.

```
.allman/
├── .git/
├── .gitignore
├── {myProfileId}/                    # one directory per logged-in account
│   ├── AUTH.json                     # profile info, auth status (committed)
│   ├── COOKIES.json                  # cookie jar (gitignored)
│   ├── config.json                   # proxy, rate limit config (committed)
│   ├── rate-state.json               # last send timestamp (gitignored)
│   ├── inbox-state.json              # inbox watermark (gitignored)
│   ├── INBOX.jsonl                   # new message log (gitignored)
│   ├── listen.log                    # SSE debug log (gitignored)
│   ├── query-cache.json              # cached flagship search queryId (gitignored)
│   ├── {convId}/                     # one directory per conversation
│   │   ├── RECORD.json               # contact + conversation + sync metadata
│   │   └── messages/
│   │       ├── 2024-11.jsonl
│   │       └── 2025-01.jsonl
│   ├── connections/                  # `allman connections` output (+ `enrich` fields)
│   │   ├── {flagshipId}.json         # one record per 1st-degree connection
│   │   └── {slug} -> {flagshipId}.json   # symlink: slug → connection record
│   ├── people/                       # person records — one owner of person facts (ADR-0003)
│   │   ├── {flagshipId}.json         # written by `enrich`, per-field provenance
│   │   └── {slug} -> {flagshipId}.json   # symlink: slug → person record
│   ├── companies/                    # `allman companies` output (+ slug symlinks)
│   ├── connections-salesnav/         # `allman connections --salesnav` output
│   │   └── {memberId}.json           # includes title, company, location, about
│   ├── invitations/                  # `allman connect` output (sent requests)
│   │   ├── {inviteeId}.json          # one record per sent invitation
│   │   └── {slug} -> {inviteeId}.json    # symlink: slug → invitation record
│   ├── connections-of/               # `allman connections-of` output
│   │   ├── {targetId}/
│   │   │   ├── RECORD.json           # target, backend, total, timestamps
│   │   │   ├── {resultId}.json       # one record per result
│   │   │   └── {slug} -> {resultId}.json  # symlink (flagship results have slugs)
│   │   └── {targetSlug} -> {targetId}     # symlink: target slug → search dir
│   ├── {profileId} -> {convId}       # symlink: contact profile ID → conversation
│   └── {slug} -> {convId}           # symlink: LinkedIn slug → conversation
└── {accountSlug} -> {myProfileId}   # symlink: account slug → profile directory
```

**Gitignored:** `COOKIES.json`, `rate-state.json`, `inbox-state.json`, `query-cache.json`, `INBOX.jsonl`, `listen.log`

### Committed to git

| File | Contents |
|------|----------|
| `AUTH.json` | Profile URN, slug, name, headline, `status`, `lastSyncAt` |
| `config.json` | Proxy config, rate limit settings, optional git remote |
| `{convId}/RECORD.json` | Contact info, conversation metadata, sync state |
| `{convId}/messages/YYYY-MM.jsonl` | Message history (one JSON object per line) |

### RECORD.json fields

| Field | Description |
|-------|-------------|
| `convId` | LinkedIn conversation ID (matches directory name) |
| `profileId` | Contact's LinkedIn profile ID |
| `slug` | Contact's LinkedIn `publicIdentifier`, or `null` if unresolved |
| `convUrn` | `urn:li:msg_conversation:...` |
| `backendUrn` | `urn:li:messagingThread:...` |
| `firstName`, `lastName`, `name` | Contact name |
| `headline` | Contact's LinkedIn headline |
| `unreadCount` | Unread message count (from last sync) |
| `lastActivityAt` | ISO timestamp of last conversation activity |
| `lastReadAt` | ISO timestamp of last read (used by `inbox`) |
| `syncState` | `oldestMessageAt`, `newestMessageAt`, `lastSyncAt`, `totalSynced` |

### Message JSONL format

Each line in a `YYYY-MM.jsonl` file is one message:

```json
{
  "urn": "urn:li:messagingMessage:...",
  "timestamp": 1704067200000,
  "fromUrn": "urn:li:fsd_profile:...",
  "fromName": "Jamie Rivera",
  "isFromMe": false,
  "body": "Hey, got a minute?",
  "reactions": [],
  "attachments": [],
  "originToken": null
}
```

Attachment types: `image`, `video`, `file`, `gif`, `link_preview`, `voice`, `other`.

### Git commit strategy

| Operation | Commit timing |
|-----------|--------------|
| `send` | Immediate on send |
| `sync` | One commit at end of sync |
| `listen` | Debounced — 5s after last write |
| `store commit` | Immediate (manual) |

---

## Key concepts

### Slug resolution

Slugs are the LinkedIn `publicIdentifier` (e.g. `sarah-chen` from `linkedin.com/in/sarah-chen`). They are never guessed from names — always fetched from the LinkedIn profile API.

During `sync`, each new contact's slug is resolved via the profile API with exponential backoff:
- Success: 1s base delay
- HTTP 429 or 5xx: delay doubles (1s → 2s → 4s → ... → 60s cap), then retry
- HTTP 401: abort sync, prompt user to re-login
- Unresolvable: `slug: null` stored in `RECORD.json`, symlink skipped

Once resolved, slugs are cached in `RECORD.json` and used for all subsequent lookups. Three O(1) lookups:
- `convId` → direct directory
- `profileId` → symlink → `convId`
- `slug` → symlink → `convId`

### Rate limiting

Outbound messages are rate-limited per account. Default: 3000ms minimum between sends.

- Enforced automatically on every message send
- State persisted to `rate-state.json` — survives process restarts
- Configurable in `config.json`: `rateLimit.minMessageIntervalMs`

To change the interval:

```json
// .allman/{profileId}/config.json
{
  "rateLimit": {
    "minMessageIntervalMs": 5000
  }
}
```

### Pre-send abort

Before sending, `allman send` fetches the 10 most recent messages from LinkedIn. If new inbound messages arrived since your last reply, the send is aborted and the new messages are printed to stderr. This prevents sending without reading context.

### SSE streaming

`allman listen` connects to `https://www.linkedin.com/realtime/connect?rc=1` with `Accept: text/event-stream`. The stream delivers `data: {JSON}` lines. Event type is extracted from the `topic` field.

The stream reconnects automatically on disconnect. A heartbeat POST is sent every 60s to keep the connection alive.

### stdout vs stderr

`allman listen` writes NDJSON events to **stdout**. All informational output, warnings, errors, and debug messages go to **stderr**. This separation is intentional — agents and pipes read stdout without log noise.

All other commands write human-readable output to stdout, and errors to stderr.

### Inbox watermark

`allman inbox` uses a per-account watermark (`inbox-state.json`) to track what has been seen. Each run:
1. Syncs from LinkedIn
2. Scans all conversations for inbound messages newer than the watermark
3. Advances the watermark to now (unless `--no-mark`)

Per-conversation: if you sent a message in a conversation, that conversation's read position is the time of your last send. A reply only appears in `inbox` if it arrives after your last send.

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `ALLMAN_STORE` | Override the saved store selection (fallback: `./.allman`) |
| `ALLMAN_ACCOUNT` | Default account slug (used when `--account` is not specified) |
| `ALLMAN_SEARCH_CLUSTERS_QID` | Override the flagship people-search queryId (otherwise auto-discovered + cached) |
| `ALLMAN_BROWSER` | Browser for login/capture, overriding saved settings (auto: installed Neo on macOS, else bundled Chromium) |
| `ALLMAN_BROWSER_WORKSPACE` | Persistent browser workspace (default: `~/.allman/browser-workspace`) |
| `ALLMAN_SHIELD_PATH` | Required runtime-only LinkedIn Shield build, overriding the saved path |
| `ALLMAN_BROWSER_PROFILE` | Persistent browser profile directory (same as `login --profile`) |
| `ALLMAN_CDP_URL` | CDP endpoint/port of an already-running browser (same as `login --cdp`) |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Use an explicit browser executable (wins over channels) |

---

## Architecture

```
src/index.ts                     CLI entry (commander), registers all commands
src/commands/                    One file per subcommand
src/linkedin/auth/
  playwright-auth.ts             Headed Chromium login, captures cookies
src/linkedin/api/
  client.ts                      Axios client with LinkedIn headers + cookie management
  cookies.ts                     Cookie jar loading, CSRF token extraction
  session.ts                     Session loading (reads account + initializes client)
  flagship-queryid.ts            Resolve+cache the rotating people-search queryId
  endpoints/
    conversations.ts             List conversations, find by recipient
    messages.ts                  Fetch messages, send message, send first message
    profiles.ts                  Resolve profile slug and URN by ID
    connections.ts               List 1st-degree connections (relationships/dash)
    people-search.ts             Flagship connectionOf people search (voyagerSearchDashClusters)
    salesnav.ts                  Sales Navigator lead search + id resolution
src/linkedin/auth/
  queryid-capture.ts             Headless capture of the flagship search queryId
src/linkedin/realtime/
  sse-client.ts                  SSE stream with reconnect + heartbeat
src/store/
  index.ts                       Store class (init, git, accounts, conversations)
  types.ts                       TypeScript types for all stored data
  accounts.ts                    AccountStore: AUTH.json, COOKIES.json, config, state
  conversations.ts               ConversationStore: RECORD.json, JSONL messages, symlinks
  connections-store.ts           ConnectionsStore: connection records + slug symlinks
  git.ts                         Debounced git auto-commit
  alias.ts                       Symlink helpers (create, resolve)
  search.ts                      Fuzzy name search with confidence scoring
src/utils/
  output.ts                      stdout/stderr helpers, JSON mode, relativeTime
  rate-limiter.ts                Per-account message rate limiter
  slug.ts                        Extract slug from LinkedIn URL
  time.ts                        parseSince: duration/ISO string → Unix ms
  urn.ts                         URN parsing and construction helpers
```

### HTTP client

Every API request uses the stored cookie jar. After each response, `Set-Cookie` headers are merged by name and written back to `COOKIES.json`. The CSRF token is extracted from the `JSESSIONID` cookie value.

### Proxy support

Configured per account via `config.json`. Applied to all API calls for that account (not to the Playwright login browser, which uses system settings).

---

## Development

```bash
bun install
bun run dev -- <command>        # run without building
bun test                        # vitest (unit + integration)
bun run build                   # compile to dist/allman (standalone binary)
bun run lint                    # biome check
bun run lint:fix                # biome check --write
```

Tests are in `tests/unit/` (no network, temp dirs) and `tests/integration/` (mock axios).

Never install packages with `npm` or `yarn` — use `bun add <package>`.

---

## Contributing

Issues and pull requests welcome. For non-trivial changes, open an issue first so we can align on approach.

Before sending a PR:

```bash
bun test
bun run lint
```

## License

MIT — see [LICENSE](./LICENSE).

`allman` is named in tribute to [Eric Allman](https://en.wikipedia.org/wiki/Eric_Allman), author of sendmail.


## Read-only validation

See the [2026-09-22 command coverage report](docs/qa/2026-09-22-command-validation.md) for bounded live tests, fixed defects, synthetic-only outbound tests, and remaining coverage gaps. No live communications or CRM writes were performed.

### Portable build configuration

Build overrides use `ALLMAN_BUILD_ENTRYPOINT`, `ALLMAN_BUILD_OUTFILE`, and
`ALLMAN_BUILD_TARGET`. Generic `ENTRYPOINT`, `OUTFILE`, and `BUN_TARGET` variables
are ignored. Failed compilation or dependency-layout checks preserve the previous
executable and remove the pending artifact. The bundled Playwright application
icon is embedded. `PLAYWRIGHT_BROWSERS_PATH=0` resolves to
`playwright-core/.local-browsers` beside the executable; normal shared-cache and
explicit browser paths keep Playwright semantics. Browser binaries are separate
installations. Playwright trace-viewer/report UI assets are not allman features
and are not packaged.

### Local tag groups

Tags remain contact annotations (`allman relationships tag <contact-id> buyer west`).
Groups are saved filters, reevaluated against the current local workspace:

```bash
allman group set prospects --any-tag buyer investor --all-tags west --without-tags paused
allman group list
allman group show prospects
allman relationships list --list prospects
allman group delete prospects
```

`--any-tag` is OR, `--all-tags` is AND, and `--without-tags` is NOT. These predicates
compose with employer, location, channel, account, and the original `--tag`.
Deleting a group does not remove contacts or their tags.

### Relationship rank

`allman rank [contact-id]` explains a local 0–100 history score. `relationships show`
also includes it. Model `history-v1` uses message volume, reciprocity, thread depth,
observed initiation balance, and response latency, then applies a 90-day inactivity
half-life. It excludes automation, group mail, unknown direction, future timestamps,
and duplicate messages. Evidence IDs and coverage accompany every score. Incomplete
history can distort initiation and response measurements. This heuristic is neither
a probability nor a measure of seniority, ICP fit, or personal importance.

Score overrides and pins require a reason and retain the original derived score,
factors, and evidence. Changes are journaled privately:

```bash
allman rank CONTACT_ID --set 80 --pin --reason 'Known relationship; local history incomplete'
allman rank CONTACT_ID --clear --reason 'Return to history score'
allman rank CONTACT_ID --unpin --reason 'No longer prioritized'
```

Clearing the score leaves pin state unchanged. Pinning affects display order, not
relationship evidence or ICP fit.

### Versioned ICP definitions

`allman icp define sales --file /private/path/sales.json` creates or updates a private
ICP. `icp list`, `icp show sales`, and `icp history sales` read current definitions
and immutable revisions. Identical updates do not create a revision. Minimal input:

```json
{"name":"Engineering hiring","description":"Senior engineering leaders"}
```

For deterministic rules, supply `criteria` with unique `id`, `description`, `field`,
`operator`, and `values`. Fields: `title`, `headline`, `company`, `geo`, `industry`,
`about`, `companySize`, `companyDescription`. Text operators: `contains-any` and
`equals-any`. Numeric `gte`/`lte` rules apply to `companySize`. Criteria without a
field retain natural-language requirements. `maxAgeDays` defaults to 90 and controls
qualification freshness; it does not define customer fit.

### Qualification and offline LLM handoff

```bash
allman icp qualify sales --stale-only --limit 100
allman icp results sales
allman icp export sales --limit 25
allman icp export sales --list 'Sales review' --limit 100
allman icp import sales --file /private/path/model-results.json
allman icp override sales --contact CONTACT_ID --match yes --reason 'Reviewed independently'
allman icp override sales --contact CONTACT_ID --clear --reason 'Use structured rules again'
```

`qualify` evaluates structured rules locally. Required criteria compose with AND;
missing, conflicting, old, or natural-language evidence yields `match:null` unless
another criterion already establishes a rejection. Rule confidence is deterministic
rule certainty, not a probability of customer fit. Text matching is literal and
case-insensitive; write criteria accordingly. No LLM/provider is called.

`export` writes a private bounded JSON handoff with criteria, current profile/company
facts, provenance, and an import response template. It excludes email bodies and
addresses. You choose any external model use separately. Model imports must cite
fresh supplied fact IDs for every non-unknown criterion, cover every criterion, agree
with structured rules, and retain the evidence fingerprint and ICP version. Import
validates the whole batch before writing. Model explanations remain model assertions,
not independently verified truth.

Results become stale after definition changes, fact changes, or the freshness window.
User overrides are journaled and never replaced automatically, including stale ones;
clear or renew them explicitly. `--contact` scopes one ID. Batch outputs expose
`nextOffset`; with `qualify --stale-only`, the next offset is zero because successfully
qualified contacts leave that selection. `export` is a stable read and advances normally.

### Combined contact filters

```bash
allman relationships list --icp sales --min-confidence 0.8 --min-rank 40 --tag buyer --geo 'San Diego' --sort rank
allman group set qualified --icp sales --min-confidence 0.8 --all-tags buyer --sort rank
allman relationships list --list qualified --company Example
allman contact show CONTACT_ID
allman contact list --icp sales --fit unknown
allman contact list --icp sales --fit stale
```

Fresh positive matches are the default for `--icp`. Unknown and stale results need
explicit selection. `--fit no` selects fresh negative results. Extra list filters
narrow the saved group; they do not replace its predicates. `--sort` accepts `name`,
`rank` (pins first), `fit` (requires `--icp`), or `recent`. `--has-facts` excludes
contacts lacking stored profile/company facts. Relationship strength and ICP fit
remain separate fields.

### Observed introduction paths

```bash
allman graph --json
allman intro-to 'founder of Example' --limit 10
allman intro-to CONTACT_ID --icp sales --min-confidence 0.8
allman intro-to 'Example' --include-stale
```

Graph reads existing first-degree sweeps, connections-of results, and reciprocal
direct owner/contact history. Ad-hoc enrichment does not establish a connection.
Numeric Sales Navigator identities join only through a unique observed member-ID
bridge. Ambiguous and conflicting identities stay separate. Names and employers
never create edges; group participation and one-way outreach create none.

Queries use exact IDs/slugs or case-insensitive terms in names, roles, and companies,
not an LLM semantic search. Results contain evidence for both steps. Edges older than
90 days are excluded by default (`--max-age-days` adjusts this). Historical results
require `--include-stale` and remain labeled. Partial network exports cannot establish
absence of a relationship.

A connection proves an observed edge, not its strength or willingness to introduce.
Unknown second-leg strength remains null; the product of both strengths and target
fit is only available when all relevant strengths are measured. Otherwise candidates
sort by measured owner-to-connector history, then target fit. No introduction drafts,
asks, reminders, or messages are created.

Connection freshness uses the last actual sweep observation, not a profile's latest
enrichment timestamp. Legacy enriched records without a sweep timestamp have unknown
freshness and require stale-edge opt-in until a later sweep observes them. Sales
Navigator sweep rows establish first-degree edges only when their reported degree is 1.

### Release candidates

Version `0.4.0-rc.1` adds local relationship intelligence. `bun run release
2026-09-22.1-beta --dry-run` runs typecheck, lint, tests, and four-target compilation
from a clean checkout, then writes binaries, SHA-256 files and `release-manifest.json`
under `dist/`. Local packaging is the default and works on a feature branch.

Publication is a separate explicit operation: `--publish --repo owner/repository`.
The repository must match both origin fetch and push URLs; existing clean-main and
pushed-main checks still apply. No upstream repository is hardcoded as a release target.
Only binaries executed on a target count as runtime-verified; cross-compilation alone
does not establish Linux or alternate-architecture behavior.

ICP definitions are workspace-wide; use `--contact` for a bounded qualification or
review. Unsupported flags for a given ICP action are rejected. Facts without a field
observation timestamp remain visible but cannot establish a fresh automated match.
