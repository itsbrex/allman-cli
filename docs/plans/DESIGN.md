# Design — Interactive Plan Pages (v2)

System doc for the self-contained HTML plan/decision pages under `docs/plans/`.
A plan page is a single offline `.html` file the reader **acts on**: every
decision item can be approved, rejected, or edited in place, then submitted
back to Claude for execution.

Reader context: a developer on a laptop reviewing proposals — approving some,
rewording others — in a dim room at night or a bright cafe by day. The page must
stay legible in glare, dense without sprawling, and every action must feel
instant.

## Creating a page (required workflow)

Never hand-roll a plan page from scratch. Stamp one:

```bash
bun run plans new <slug> --title "Human Title" --source "claude session <id> / <what prompted it>"
```

This assigns the next sequence number from `plans.config.json`, injects the
repo's persistent accent color, stamps date/repo/provenance into the meta strip,
writes `YYYY-MM-DD-NNN-<slug>.html`, and regenerates the dashboard. Then edit
the file: fill the thesis paragraph (`#plan-sub`), replace the sample
`PLAN_ITEMS`, and optionally add `.prose` context sections above the groups.

### Done means published, checked, and texted (v31)

A plan is not handed over until every step below has run. Do them in order:

1. Stamp the page and fill it (above).
2. Run `bun scripts/plans.mjs wait <slug>` in the background. Do not use
   `bun run plans wait`: the token-saver hook wraps `bun run …` with a
   300-second timeout, so the task ends with exit 124. The wait process itself
   keeps running, and its exit never reaches you. With a publish Site set
   (`bun run plans hub publish status`), it copies the page to the Site,
   checks the link card, and texts the Site link. Do not text a link by hand.
3. Check the `wait` output. You need both `[plans wait] published <url>` and
   `[plans wait] texted you the link`. Exit code 3 means the publish failed
   and nothing was texted: fix the cause and run `wait` again.
4. Give the user the published URL in the chat too.
5. When the submission arrives, execute the approved items, then record them
   with `bun run plans done <slug>`.

`bun run plans publish <slug> [--notify]` runs step 2's publish on its own,
for example after you edit a page that is already waiting.

## Numbering & provenance

- `plans.config.json` holds `nextSeq`; every stamped page gets a monotonically
  increasing `#NNN` badge, embedded as `data-plan-seq` on `<html>` and in the
  filename. Highest seq = latest plan, always.
- The meta strip on every page shows `#NNN · date · repo · source`. `--source`
  should say where the content came from (session, prompt, review, etc.).
- The dashboard (`index.html`, auto-regenerated) lists pages newest-first with
  seq badges and marks the latest.

## Interactivity contract

Each page defines `PLAN_ITEMS`, an array of decision items:

```js
{ id: "d01",            // unique + stable within the page
  group: "Migration",   // section heading it renders under
  kind: "edit",         // "edit" | "structural" | "verify" | "note"
  title: "One-line statement of the decision",
  why: "Rationale / consequence the reader needs to judge it",
  current: "Status quo (omit or \"\" when N/A)",
  suggested: "Proposed change — editable by the reader",
  dflt: "approved" }    // OPTIONAL pre-selected state: "approved"|"rejected";
                        // seeded once — a saved reader decision always wins
```

Reader affordances (v11–v16, already wired in the template — do not remove):

- **Two views.** Overview (thesis, prose context, stat tiles, grouped one-line
  rows) and a typeform-style **focus mode** — one decision at a time, centered
  card, direction-aware slide between cards. `Enter` on the overview starts at
  the first pending item; `O`/`Esc` toggles back.
- **Keyboard-first.** `↓/J` next · `↑/K` prev · `A` approve · `R`/`X` reject ·
  `E` edit (⌘↵ save, Esc cancel) · `U` revert edit · `P`/`⇧P` next/prev
  pending · `Home`/`End` · `S`/`⌘↵` submit · `?` help overlay. Approve/reject
  **auto-advance** (~260 ms after visual feedback); pressing the same key again
  clears back to pending and never advances. Editing never auto-advances.
- **Submit validation + review mode.** Submit with undecided items opens a
  confirm dialog listing them (one per line, scrollable); "Review undecided"
  enters review mode, where
  navigation cycles ONLY the pending items (progress track dims the decided
  ones) until they're resolved — or "Submit anyway" sends them as `pending`
  (Claude skips those). With zero pending, a normal confirm dialog submits.
- **Color coding.** Per-repo accent = approve/identity; danger = reject;
  warn = edited/pending-attention. Each group gets a stable hue from the
  curated pool (skipping hues within Δ28° of the accent) shown on the group
  header dot, the group chip on the card, and the row's `dNN` id — never as a
  fat colored side border (v18). Kind chips: edit=accent, structural=azure,
  verify=mint, note=amber. Row badges appear only for decided or edited rows;
  undecided is the quiet default.
- **Icons (v18).** One inline SVG sprite (`#i-check`, `#i-x`, `#i-circle`,
  `#i-edit`, `#i-undo`, `#i-up`, `#i-down`, `#i-theme`, `#i-motion`,
  `#i-list`, `#i-file`), 1.75 stroke, via `icon(name)` / `btnWith()`. No
  unicode glyphs stand in for icons in the stock template.
- **Toolbar (v18).** One row: identity (seq + title) · status cluster
  (connection, ✓/✗/○ counts as buttons with numeric aria-labels, theme,
  motion, overview) · Submit. Below 980px the cluster drops to a second row
  and the settings buttons become icon-only. Under the toolbar the summary
  line (`N decisions · a approved · r rejected · p undecided [· e edited]`)
  replaces the old metric tiles.
- **Phones (v18).** Below 720px (and on any coarse pointer) the keyboard
  footer hides, the howto shows tap copy, and the card's Approve/Reject/Edit/
  nav actions become a fixed bottom bar inside thumb reach. Rows wrap their
  titles instead of truncating.
- **Progress.** Segmented track under the toolbar (one clickable segment per
  item, colored by state, gaps between groups, focus ring on the current one),
  `n / N` position on every card, live ✓/✗/○ counts in the toolbar (○ jumps
  into review mode).
- **Persistence.** Decisions in `localStorage` (`plans:<slug>:<seq>`), reading
  position + view in `plans:<slug>:<seq>:ui` — reopening resumes where you
  left off. Unavailable storage falls back to in-memory state so offline review
  still works. `dflt` seeding runs once and never overwrites a saved decision.
- **Accessibility.** `aria-live` announcer for card changes and submit
  results, real buttons with `aria-pressed`/labels everywhere, dialogs with
  `role=dialog aria-modal`, skip link, visible focus rings, and a persisted
  Motion: Reduced toggle (`html[data-motion=reduced]`) that kills all
  animation.
- **Theme + Motion toolbar buttons** (v13) — cycle the 13-entry theme list /
  toggle motion; both persist under the shared `plan-ui` localStorage key.
- **Submit to Claude** POSTs the full decision payload to the always-on
  **plans hub** at `https://<appName>.localhost/plans/_submit` (v17). The page
  itself is served from that origin when the hub is up (`bun run plans latest`
  opens the https URL), or from `file://` otherwise — both work. Every stamped
  page carries a random per-plan **submission token** (`SUBMISSION_TOKEN`, sent
  as `X-Plan-Submission-Token`); the hub reads the expected token from the page
  on disk and rejects anything else, so a stray page or a website you happen to
  have open cannot feed decisions to your session. When the hub is unreachable
  the page downloads `<slug>-decisions.json` instead. A status dot pings
  `/plans/_ping` every 5s. One submission in flight at a time (button disabled,
  10s abort, then the JSON fallback).

### Receiving decisions (Claude side)

**v17 and later — wait on the hub inbox.** Nothing to start per plan. Run, in
the background so its exit notifies you:

```bash
bun run plans wait <slug>            # blocks; prints ~/.claude/plans-hub/inbox/<appName>/<slug>-<seq>.json
bun run plans wait <slug> --timeout 1800 --seq 7   # optional bounds
```

The hub (`~/.claude/plans-hub/hub.ts`, launchd agent `sh.claude.plans-hub`,
one Bun process for every repo) validates each submission before it lands:
slug + seq must name a stamped page in this repo, the `X-Plan-Submission-Token`
must match that page (timing-safe), `Origin` must be the page's own origin or
`null` (file://), body ≤ 1 MB, JSON only, decisions ≤ 500 with the exact item
shape. The inbox file is written atomically with mode 0600 and includes
`receivedAt`, `app`, and `page`. `plans wait` ignores files older than its own
start unless `--any` is passed. Never log or echo the token.

Hub operations: `bun run plans hub status|install|start|stop|logs|url`
(install once per machine; the SessionStart hook registers each repo with
`plans hub register --quiet`, which also runs `portless alias <appName> <port>`
once and suffixes a colliding appName). If the hub or portless is missing the
page still opens from `file://` and falls back to the JSON download — hand that
file to Claude.

**Pages stamped before v17** still POST to `http://127.0.0.1:<port>` (`port` in
`plans.config.json`) with `/ping` + `/submit`. For those, run the v16 loopback
listener below (per-repo port, slug handshake, token). Never kill a listener
that answers `/ping` — it is live, not stale.

### Publishing to a cresa.one Site (v31)

`hub.config.json` `publish` names one cresa.one Site for every repo. Set it once
per machine:

```bash
bun run plans hub publish set --site plans --allow you@example.com   # access restricted (default)
bun run plans hub publish status                                      # config + live access + submit route
```

`plans wait` (and `plans publish`) then does this for each plan:

1. Copies the page to the mirror directory (`~/.claude/plans-hub/cresa-one-site/`
   by default) as `<appName>/<NNN>-<slug>.html`. The copy gets its own Open Graph
   and Twitter tags, and its `ENDPOINT` is pinned to `/_hub/<appName>`.
2. Copies the hub's card for the page to `<appName>/<NNN>-<slug>/og.png`. If the
   hub cannot render one, it uses the cresa-one skill's `og-image.py` instead.
3. Rewrites the Site's `index.html` to list every mirrored plan, waiting plans first.
4. Runs the cresa-one skill's `publish.sh` on the whole mirror. The Site viewer
   title, description, and image are set to this plan.
5. Sets the Site's access policy, public link cards, and submit route
   (see Rules below). It reads first and writes only what differs.
6. Fetches the URL as a link previewer would and checks two things. The
   og:title must name this plan, and og:image must answer 200 `image/*`. If
   either check fails, `wait` exits with code 3 and texts nothing.

Rules that cost a session each to learn:

- **Flat files only.** cresa.one does not serve a folder's `index.html`.
  `/x/` redirects to `/x`, which answers 404. Pages must be `<NNN>-<slug>.html`.
- **The mirror is the whole Site.** A publish replaces every file on the Site,
  so the mirror holds pages from all repos. Never publish a single page
  directory to the Site.
- **A protected Site shows only its viewer metadata to link previewers.** Pages
  stay behind the access gate. That is why each publish points the viewer
  metadata at the plan being texted. An older link then shows the newest
  plan's card.
- **Submit uses a proxy route on a protected Site.** The route is `/_hub` →
  the hub tunnel origin. cresa.one checks the viewer, then adds
  `Authorization: Bearer <remote.proxyToken>` from the service variable
  `PLANS_HUB_SUBMIT_TOKEN`. On the hub, that Bearer opens only
  `/<app>/plans/_submit` and `/<app>/plans/_ping`, and the page token is still
  checked.
- **A public Site cannot submit.** Proxy routes exist only on protected Sites.
  With `--access anyone_with_link`, Submit on the copy downloads a JSON file,
  so the text also carries the hub link. Anyone who guesses the Site URL can
  read a public Site, so keep it restricted.
- `publish.sh` runs with `--no-verify` on a protected Site, because every
  file answers with the access gate. The card check in step 6 replaces it.

### Reviewing from your phone (v19 remote + notify)

The same hub process answers any **non-`.localhost` Host** — a Tailscale
`serve` name, a Tailscale Funnel, an ngrok or cloudflared tunnel — with
path-prefixed routing: `/` is a review-all landing page (every registered
repo's plans, "waiting for you" first), `/_pending` the same as JSON, and
`/<appName>/plans/<file>.html`, `/<appName>/apps/<file>.html`,
`/<appName>/plans/_ping|_submit` mirror the local routes. Every remote request
needs the shared key in `~/.claude/plans-hub/hub.config.json` (`remote.secret`):
the texted link carries `?key=…` once, the hub answers with an HttpOnly cookie
(90 days) and redirects without the key. `.localhost` hosts never need it.

Pages talk to **the origin they were served from**: the template (v19) derives
`ENDPOINT` from `location` when the page is http(s), and the hub additionally
rewrites the stamped `var ENDPOINT = "…";` line to the request's prefix (`""`
locally, `"/<appName>"` remotely) while streaming the file — so pages stamped
before v19, and even pre-v17 loopback pages, submit correctly through the hub
and through a tunnel. A pre-v16 page (no `SUBMISSION_TOKEN`) may submit only
from a real same-origin page, never from `Origin: null`.

`plans wait` writes a marker to `~/.claude/plans-hub/waiting/<app>/<slug>-<seq>.json`
(removed on submit / timeout / signal; stale markers whose pid is gone are
dropped) and **texts you** the direct link + the review-all link, once per plan
per 30 min. Channels: `imessage` (to your own handle; transport `osascript` = Messages.app
— text, then a phone-sized PNG **preview of the page** rendered with headless
Chromium, the pattern the GoFi Alfred workflow uses for cover art — or
`imsg` = the imsg CLI with `--file`; first osascript send triggers a one-time
"control Messages" Automation prompt) or `command` (any shell; message on
stdin, `$PLANS_NOTIFY_TEXT`, preview path in `$PLANS_NOTIFY_FILE`).
`--preview off` or `PLANS_NO_PREVIEW=1` sends text only; previews live in
`~/.claude/plans-hub/previews/<app>/`.
`PLANS_NO_NOTIFY=1` or `--no-notify` keeps a wait silent.

```bash
bun run plans hub remote on --provider tailscale     # tailnet-only: `tailscale serve --https=8443` → the hub (8443, not 443: portless owns 443 on every interface, and the sending Mac must reach its own ts.net URL to render iMessage link cards); phone needs the Tailscale app. --ts-port N overrides
bun run plans hub remote on --provider funnel        # public via Tailscale Funnel (needs Funnel enabled on the tailnet)
bun run plans hub remote on --provider ngrok         # public via an ngrok agent (launchd sh.claude.plans-hub-tunnel; random URL, free plan shows a one-time interstitial)
bun run plans hub remote on --provider cloudflare    # public cloudflared quick tunnel (same agent slot; URL changes on restart)
bun run plans hub remote status|off
bun run plans hub notify set --channel imessage --to <phone or Apple ID email> [--transport osascript|imsg] [--preview on|off]
bun run plans notify --test                          # text yourself a link now
bun run plans hub url --remote                       # this repo's keyed remote URL
```

**Lifecycle: stamped → submitted → implemented.** Submitted = an inbox file
(`~/.claude/plans-hub/inbox/<app>/<slug>-<seq>.json`, written by the hub, or
adopted from a pre-v17 download with `bun run plans inbox import`).
Implemented = a done marker (`~/.claude/plans-hub/done/<app>/<slug>-<seq>.json`)
that Claude writes **after executing the approved items**:

```bash
bun run plans done <slug> [--items d01,d03] [--note "what shipped"] [--commit <sha>,…]
bun run plans status [--all] [--json]      # every plan: submitted (✓/✗ counts) → implemented, plus a git hint
```

`status` also reports commits after the submission that mention `#NNN`, the
slug, or an approved item id — a hint only; the done marker is the record. The
landing page groups plans as Waiting → Submitted, not implemented → Implemented.

**Link previews.** Every remotely served page (plan pages, apps, the landing
page) carries Open Graph tags — `og:title` (seq stripped), `og:description`
(repo · date · waiting/submitted), `og:url`, and an `og:image` card
(1200×630, repo accent bar, seq pill, status badge; rendered once per page
version with headless Chromium into `~/.claude/plans-hub/og/<app>/`, served at
`/<app>/plans/_og/<file>.png?key=…`). A keyed **GET** is served directly with
the cookie attached (no redirect) so LinkPresentation, which follows no
cookies, still sees the real page. iMessage only unfurls a message that is a
bare URL, so notifications go out as: summary text, then each link as its own
message (one card per plan), then the optional PNG attachment (`--preview on`).

`plans serve` inherits the provider: with Tailscale it sets
`PORTLESS_TAILSCALE=1` (or `PORTLESS_FUNNEL=1`) so portless also publishes the
served app on the tailnet (`--local` / `PLANS_SERVE_LOCAL=1` to skip). The
ngrok/cloudflare providers cover the hub only; served apps stay LAN-only there.

```ts
// bun run listener.ts docs/plans/<plan>.html   (pre-v17 pages only; adapt OUT)
import { randomUUID, timingSafeEqual } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";

const OUT = "<scratchpad>/plan-decisions.json";
const MAX_BODY_BYTES = 1_000_000;
const planSource = await Bun.file(process.argv[2]).text();
function stamped(pattern: RegExp, label: string) {
  const match = planSource.match(pattern);
  if (!match) throw new Error(`Missing stamped ${label}`);
  return JSON.parse(match[1]);
}
const EXPECTED = {
  token: stamped(/^var SUBMISSION_TOKEN = ("[^"]+");/m, "submission token"),
  slug: stamped(/^\s*slug: (".*"),$/m, "plan slug"),
  seq: Number(planSource.match(/^\s*seq: (\d+),$/m)?.[1]),
};
if (!Number.isInteger(EXPECTED.seq)) throw new Error("Missing stamped plan sequence");
const { port } = JSON.parse(await Bun.file("docs/plans/plans.config.json").text());

const CORS = { "Access-Control-Allow-Origin": "null", "Vary": "Origin",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Plan-Submission-Token" };
function authorized(req: Request) {
  const actual = Buffer.from(req.headers.get("x-plan-submission-token") || "");
  const expected = Buffer.from(EXPECTED.token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function readLimited(req: Request) {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw Object.assign(new Error("too large"), {status:413});
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw Object.assign(new Error("too large"), {status:413}); }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}
function validatePayload(value: any) {
  if (!value || value.version !== 2 || value.kind !== "plan-decisions" ||
      value.plan?.seq !== EXPECTED.seq || !Array.isArray(value.decisions) ||
      value.decisions.length > 500) {
    throw Object.assign(new Error("invalid payload"), {status:400});
  }
  const ids = new Set<string>();
  for (const item of value.decisions) {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id) ||
        !["approved", "rejected", "pending"].includes(item.status) ||
        typeof item.group !== "string" || typeof item.kind !== "string" ||
        typeof item.title !== "string" || typeof item.current !== "string" ||
        typeof item.suggested !== "string" || typeof item.edited !== "boolean") {
      throw Object.assign(new Error("invalid decision"), {status:400});
    }
    ids.add(item.id);
  }
  return value;
}
Bun.serve({ port, hostname: "127.0.0.1", async fetch(req) {
  const origin = req.headers.get("origin");
  if (origin !== null && origin !== "null") return new Response("forbidden", {status:403});
  if (req.method === "OPTIONS") return new Response(null, {status:204, headers:CORS});
  const u = new URL(req.url);
  if (req.method === "GET" && u.pathname === "/ping")
    return Response.json({ok:true, plan:EXPECTED.slug}, {headers:CORS});
  if (req.method === "POST" && u.pathname === "/submit") {
    try {
      if (!/^application\/json(?:;|$)/i.test(req.headers.get("content-type") || ""))
        return new Response("unsupported media type", {status:415, headers:CORS});
      const raw = await readLimited(req);
      let slug = "unknown";
      try { slug = JSON.parse(raw)?.plan?.slug ?? "unknown"; } catch {}
      if (slug !== EXPECTED.slug) {   // another plan's payload — save aside, stay alive
        await Bun.write(`${OUT}.foreign-${slug.replace(/[^a-z0-9-]/g, "_")}.json`, raw);
        return Response.json({ok:false, reason:"wrong-plan", plan:EXPECTED.slug}, {headers:CORS});
      }
      if (!authorized(req)) return new Response("unauthorized", {status:401, headers:CORS});
      const payload = validatePayload(JSON.parse(raw));
      const temp = `${OUT}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(payload, null, 2) + "\n", {flag:"wx", mode:0o600});
      await rename(temp, OUT);
      setTimeout(() => process.exit(0), 400);
      return Response.json({ok:true}, {headers:CORS});
    } catch (error: any) {
      return new Response(error.message, {status:error.status || 400, headers:CORS});
    }
  }
  return new Response("not found", {status:404, headers:CORS});
}});
```

Payload shape: `{version, kind:"plan-decisions", plan:{seq,slug,…}, submittedAt,
decisions:[{id,group,kind,title,status,current,suggested,edited}]}`. Execute
`approved` items (honoring reader edits in `suggested`), skip `rejected` and
`pending`, treat `note` kinds as acknowledgments.

## Theme

OLED-native dark base with a full switchable theme system (v13; the old
single-theme contract is superseded). True black `#000` base, near-black
elevated surfaces separated by lightness + hairline borders, never drop
shadow. No gradient backgrounds, no gradient text, no glassmorphism.
Precision-instrument feel: dense, legible, fast.

**Default is Auto (system-aware):** dark systems resolve to **Goldenrod** (the
Cresa house theme), light systems to **Paper**, via `prefers-color-scheme`,
with a live change listener while Auto is selected. An explicit theme choice
overrides the OS and persists. The plan template cycles 13 entries on the
toolbar Theme button (Auto · Goldenrod · **Repo accent** · Mono · Graphite ·
Phosphor · Amber · Ember · Cobalt · Violet · Jade · Rose · Paper), persisted
under the shared `plan-ui` localStorage key so every plan page in a repo
follows the same choice. **Repo accent** removes `data-theme` and restores the
stamped per-repo accent on the base OLED palette. App shells (appkit ≥1.1.0
and the monolith app template) expose 12 themes in the command bar with live
preview and on `t`; Paper darkens danger/warn/focus (and the plan template's
kind-chip hues) for AA on light.

**Motion policy:** the stock v29+ plan template honors OS
`prefers-reduced-motion: reduce` for animations and transitions. Its persisted
Motion: Reduced toggle additionally disables smooth scrolling. Mono and legacy
AppKit shells retain their explicit toggle policy; recipes have their own CSS.
Theme and motion preferences use the origin-wide `plan-ui` key (all repos share
that preference when viewed through the same hub hostname).

## Color

OKLCH. **The primary accent is per-repo**, randomized once by the SessionStart
hook into `docs/plans/plans.config.json` and injected into every stamped page —
all of a repo's plans share one identity color. Never hardcode a different
accent; read the config. Supporting roles are fixed:

```css
/* Base */
--bg:            oklch(0 0 0);
--surface-1:     oklch(0.169 0.004 265);  /* card / panel */
--surface-2:     oklch(0.214 0.005 265);  /* sticky bar, open cards */
--surface-3:     oklch(0.255 0.006 265);  /* buttons, inputs */
--hairline:      oklch(0.30 0.006 265);
--hairline-strong: oklch(0.40 0.008 265);

/* Ink */
--ink:           oklch(0.971 0 0);
--ink-muted:     oklch(0.74 0.012 265);   /* >=4.5:1 on black */
--ink-faint:     oklch(0.62 0.012 265);   /* labels/meta at >=13px */

/* Roles */
--accent:        <from plans.config.json>; /* approvals, badges, latest, identity */
--accent-ink:    oklch(0.17 0.03 <hue>);   /* text on accent fills */
--danger:        oklch(0.70 0.20 25);      /* reject, current-state stripe */
--warn:          oklch(0.83 0.16 75);      /* edited badge */
--focus:         oklch(0.86 0.16 215);     /* focus ring, visible on any accent */
```

The curated accent pool (all ≥7:1 on black): lime 132, cyan 215, violet 300,
amber 75, pink 8, coral 30, mint 165, azure 245, magenta 330, chartreuse 105,
goldenrod 84 (Cresa brand — use when a page carries the Cresa name).

### Semantic layer

Never reference `--accent` or `--danger` directly for meaning. Derive a named
role once, then use the role, so a change of accent (or theme) recolors the
whole page:

```css
--tier-crit:      var(--accent);   /* highest-priority items */
--tier-note:      var(--ink-muted);
--tier-ctx:       var(--hairline-strong);
--caution-wash:   color-mix(in oklch, var(--danger), transparent 93%);
--caution-line:   color-mix(in oklab, var(--danger) 36%, var(--hairline));
--verify-wash:    color-mix(in oklch, var(--warn),   transparent 92%);
--verify-line:    color-mix(in oklab, var(--warn) 30%, var(--hairline));
```

Interpolation space is not interchangeable here. Mixing two colors that carry
different hues must use `oklab`: `oklch` interpolates hue along the shorter arc,
so blending danger (hue 25) with a hue-265 neutral swings the result through
purple at roughly hue 308. Mixing a single color with `transparent` keeps its
hue either way, so the wash tokens can stay in `oklch`. Verify the result, do
not assume it.

Applied in `.plan-template.html` (and the mono variant): caution tokens on the
rejected state chip, verify tokens on the edited state chip. Applied in the
app templates and appkit `10-tokens.css`: caution tokens on the blocked stage
pill, `--tier-crit`/`--tier-ctx` on the other stage pills.

Completion semantics are green, not accent:
`input[type=checkbox]{accent-color:var(--ok)}`.

## Typography

System stacks only, so pages open offline with zero network requests:

```css
--font-ui:   system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
--font-mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace;
```

Fixed rem scale `.75 / .8125 / .9375 / 1 / 1.125 / 1.75`. Display 700, body 400,
labels 500–600, heading letter-spacing -0.02em. Prose measure ≤76ch. Mono for:
seq badges, dates, filenames, labels, counts, code. Code blocks never wrap;
`overflow-x:auto`.

## Spacing, radius, layout

8px rhythm (`4 8 12 16 24 32 48 64`). Radius 8/12/16, pill 999 for chips/badges.
Touch-target floor 44px (38px buttons acceptable inside dense desktop toolbars).
Content `max-width:1100px` (dashboard 900px, focus-mode plan pages 960px).
Sticky toolbar solid `--surface-2` + hairline, no blur. Mobile <640px: single
column, cards stack full width.

### Widescreen (≥1680px) — app shells

Mobile-first is the default; wide viewports are an opt-in second column, never
a stretched measure. Tokens: `--measure:920px`, `--col-max:1080px`,
`--col-gap:clamp(32px,3vw,72px)`, `--wide:1680px`.

- Long prose or a single register keeps `max-width:var(--measure)` at every width.
- Two sibling sections read independently: wrap each in `.col` (which is
  `display:contents` below `--wide`, so nothing changes on mobile) inside a
  `.cols` grid of `repeat(2,minmax(0,var(--col-max)))`.
- One long list that should fill the width: CSS `columns:2` with
  `break-inside:avoid` on items (`.colflow`), so order stays top-down —
  never a left-right zigzag.
- Verify at 390 / 834 / 1440 / 2560px; no horizontal page scroll at any width.

Plan pages need no widescreen change — `.wrap` is already capped.

## Components

- **Toolbar** (sticky): seq pill + title, listener status dot, live ✓/✗/○
  count buttons (○ enters review mode), Overview toggle, primary Submit.
- **Progress track** (sticky, under toolbar): one segment per item, colored by
  state (accent/danger/neutral), group gaps, click-to-jump, focus ring on the
  current item; review mode dims decided segments.
- **Focus card**: group chip (group hue) + kind chip (kind hue) + state badge +
  `id · n / N` position; title → why → current (danger-striped) → suggested
  (accent-striped, editable) → approve/reject/edit/revert + prev/next. Card
  border and tint follow the decision state; keycap hints (`<kbd>`) on actions.
- **Overview rows**: grouped one-line buttons (state dot + id + title + badge)
  with group-hue left stripe; All / Pending-only filter chips; Enter/click
  opens focus mode at that item.
- **Review banner** (sticky, warn-tinted): undecided count + exit; shown only
  in review mode.
- **Dialogs**: shortcut help (`?`) and submit confirm (stats, undecided list,
  Review-them / Submit-anyway / Cancel) — `role=dialog aria-modal`,
  Tab is trapped inside the dialog and focus returns to the opener on close;
  Esc closes, Enter fires the primary unless a control inside is focused.
- **Shortcut footer** (fixed, desktop only): the whole key map at a glance.
- **Meta strip**: seq pill + date + repo + source — provenance at a glance.
- **Stat tiles**: decisions/approved/rejected/pending, mono numerals, colored.
- **Prose sections**: optional free-form context blocks in the overview.
- **Toast** + **aria-live announcer**: visible + screen-reader feedback for
  every action.
- States everywhere: default, hover, focus-visible, active, edited, empty.

## Motion

150–260ms ease-out: card slide (direction-aware `translateY` + fade on
navigate), state-badge pop on decide, hover lift, chip select, toast slide,
progress-segment scale on hover. Auto-advance waits ~260ms so the state
change is seen before the next card slides in. No page-load choreography.
Reduced motion uses the OS preference plus the explicit `html[data-motion=reduced]`
gate in the stock plan template (see Motion policy under Theme).

## Semantic z-index scale

Templates declare their stacking order as tokens rather than arbitrary
numbers. `.plan-template.html`: `--z-keys:80`, `--z-banner:85`, `--z-track:90`,
`--z-bar:100`, `--z-overlay:200`, `--z-skip:300`, `--z-toast:1000`. App
shells: `--z-header:30` (changes variant), `--z-drawer:40`, `--z-cmdbar:50`,
`--z-modal:55`, `--z-toast:60`. The skip link sits above the sticky toolbar
because the toolbar would otherwise cover it on focus.

## Horizontal-scroll affordance

Any container that scrolls horizontally while hiding its scrollbar needs an
edge signal. Use a mask driven by a numeric `--fade-r` custom property:

```css
--fade-r:0;
mask-image:linear-gradient(to right,#000 calc(100% - var(--fade-r) * 44px),transparent 100%);
```

Set `--fade-r` to 1 from script only while `scrollLeft < scrollWidth -
clientWidth`. At 0 the mask is a no-op, so containers that fit pay nothing.
Fade the right edge only: pinned first columns / leading elements mean a
left-edge fade would dim anchored content. Applied on the mono variant's chip
strip and the changes variant's view tabs; the v13 focus-mode plan template
has no hidden-scrollbar strip, so it carries none.

## Kanban card moves (monolith app template)

The app template's Board is a kanban: drag a card between stage columns
(HTML5 drag, pointer), or focus a card and press `[` / `]` to move it to the
previous / next visible column; the drawer carries a "Move to stage" chip row
for touch and screen readers. A move writes `r.stage`, persists to
`st.stages` keyed by `DATA` index (re-applied at boot), re-renders, restores
focus, and toasts the destination. Drop targets highlight via `.kcol.dropover`
using the accent border only. appkit's board is a grouped table, not cards —
card moves are a monolith-template feature until appkit grows a card board.

## Self-contained rule

Every plan page is one `.html` with all CSS + JS inline and system-font stacks.
It must open from `file://` with no network and no build step — `bun run plans`
(or a double-click) always works offline. The only network call is the optional
`127.0.0.1:<per-repo port>` listener ping/submit, which degrades gracefully
(offline or busy-with-another-plan both fall back to a JSON download).


## Review layout standard — September 23, 2026

Follow the Target Enrichment reference (`https://allman-enrichment.localhost/apps/target-enrichment.html`) for new decision plans and results apps: embedded Geist fonts, warm charcoal/goldenrod dark theme and paper light theme, compact app header, short scope panel, compact metric tiles, full-width search, filter chips with counts, rows for scanning, and a detail inspector/drawer for evidence. Keep headings near 28–32px; avoid giant hero text and walls of expanded cards. Maintain keyboard access, visible focus, 44px primary touch targets, reduced-motion behavior, and mobile layouts.

For results/evidence apps use `bun ~/.claude/templates/appkit/bin/appkit.mjs new <slug> --recipe review --root <repo> --title <title>`. Replace its `review-data` JSON with verified rows. Results are read-only; do not add decision submission actions to factual rows. For decision plans continue using `bun run plans new`; its managed template retains approval/rejection/editing, drafts, review validation and authenticated submission. Recommendations, submitted decisions and observed completion must remain distinct.

Keep paired HTML and Markdown. Explain every verification count: what ran, fixture versus live evidence, skipped/blocked checks, and what a pass cannot prove. An OpenAPI operation is method plus path; changed fingerprints are not automatically breaking changes, and route coverage is not parameter coverage.

Existing pages need an explicit, content-preserving migration. Preserve IDs, source hashes, legacy storage data, saved decisions, submission tokens and hub receipts. The Attio installation includes a surgical local v29 layout merge over existing WIP; its original `.plans-template.json` remains unchanged so managed drift remains visible. Do not force a managed upgrade over these local changes.

## v30 storage and completion safety

Decision keys include repository metadata and the existing per-page submission
token. Tokens, authored decisions, and inbox receipts are not regenerated.
Dedicated `<app>.localhost` origins copy legacy decisions and position once,
without deleting old keys. Shared hub origins and `file://` cannot prove who
owns an old `plans:<slug>:<seq>` entry; use **Recover older saved decisions** only
when those choices belong to the displayed repo. Recovery keeps the old entry.
Browser storage is origin-specific; changing hostname does not transfer data.

`plans done --items` accumulates approved IDs only within the exact current
receipt. Partial work remains submitted. A new receipt invalidates completion;
pending decisions also prevent implemented status. Import validates the complete
v2 payload and refuses ambiguous repository matches.

New apps still default to AppKit's `workspace` recipe. `review` (AppKit 1.2.0)
is an explicit read-only evidence recipe, not a replacement for interactive plan
decisions. Existing apps remain authored outputs and need AppKit migration.
