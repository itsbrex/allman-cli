# docs/plans/

Interactive, self-contained HTML plan/decision pages — one file each,
offline-ready, approve/reject/edit-able, numbered per repo.

## Browse

```bash
bun run plans            # interactive picker (fzf if installed, else numbered)
bun run plans latest     # open the newest plan (highest #seq)
bun run plans <substr>   # open first plan whose filename matches <substr>
open docs/plans/index.html   # dashboard (auto-regenerated each session)
```

(No `package.json`? Use `bun scripts/plans.mjs …` — or `node scripts/plans.mjs …`
if bun isn't installed — or the global `claude-plans` command — same behavior.)

## Create

```bash
bun run plans new <slug> --title "Title" --source "where this came from"
```

Stamps `YYYY-MM-DD-NNN-<slug>.html` from `.plan-template.html` with the next
sequence number and this repo's accent color, then rebuilds the dashboard.
Fill in the thesis paragraph and `PLAN_ITEMS` (see `DESIGN.md`).

Plan pages (v13) carry a 13-entry theme system — default **Auto** resolves to
Cresa goldenrod on dark systems, paper on light; **Repo accent** restores the
stamped per-repo color — plus a persisted Motion toggle. Both live on the
toolbar and are shared across a repo's plan pages via the `plan-ui`
localStorage key.

## App skeletons — owned by appkit, not by this folder

```bash
bun run plans app <slug> [--title "Title"] [--badge "TAG"] [--dest dir] [--recipe workspace|records]
appkit new <slug> --recipe workspace          # the same thing, direct
```

`plans app` forwards to **appkit** (`~/.claude/templates/appkit`), the canonical
source for single-file HTML apps. appkit composes the app from named parts
instead of copying one giant template, and records provenance in
`<repo>/.appkit/lock.json` so the app can be upgraded later:

```bash
appkit recipes                    # what each recipe ships
appkit status                     # is an upgrade available for this repo's apps?
appkit diff apps/<slug>.html      # preview it — writes nothing
appkit migrate apps/<slug>.html   # apply it via 3-way merge, keeping your edits
appkit doctor                     # integrity, drift, and context-hygiene checks
```

Two recipes today:

- **`workspace`** (default) — 100dvh flex column, pinned footer, one isolated
  scroll region, file/drag/paste intake, stat tiles, item list, source drawer,
  download/copy/offline-ZIP export. The shape the Font Swap app hand-rolled.
- **`records`** — sortable table + grouped board over a `DATA` array, KPI tiles,
  filter chips, search, record drawer, CSV export. Byte-compatible with the old
  `.app-template.html`.

Both ship the shared shell: embedded Geist Sans/Mono/Pixel (fully offline),
12 switchable themes incl. Cresa goldenrod — default Auto resolves goldenrod on
dark systems, paper on light (`t` cycles; live preview in the command bar) —
⌘K/⌘; fuzzy command bar with a Motion setting, confirm modal, toast stack,
drawer, and a keyboard layer where each overlay owns its keys.

`--template <name>` still uses the old copy-a-file path for named variants that
have not been ported to a recipe yet (e.g. `--template changes`). As of hook v9
this folder no longer receives `.app-template*.html` copies; if your repo still
has them, they are leftovers — `appkit doctor` lists them.

## Serving apps (portless — REQUIRED, no raw ports)

```bash
bun run plans serve <command…>            # e.g. bun run plans serve bun web/server.ts
bun run plans serve --name api <command…> # rare: extra name for a second server
```

Any server that backs an HTML page/app in this repo MUST be started through
`plans serve`, which wraps [portless](https://www.npmjs.com/package/portless):

- **One name per repo, created once.** `plans.config.json` carries `appName`
  (auto-derived from the repo folder on first use; edit it once to taste, then
  commit). Every HTML page/app in the repo reuses the SAME name — pages are
  distinguished by *route*, never by port.
- **Stable URL, zero port conflicts.** The app is always at
  `https://<appName>.localhost`. portless injects a free `PORT` (plus `HOST`
  and `PORTLESS_URL`) into the child, so two repos — or a crashed old
  process — can never collide with `EADDRINUSE` again.
- **Server contract:** listen on `Number(process.env.PORT || 0)` (0 = ephemeral
  fallback for direct runs), bind `process.env.HOST` when set, and when
  auto-opening a browser prefer `process.env.PORTLESS_URL`. NEVER hardcode a
  port number in code, scripts, or docs.
- **package.json:** wire app scripts through the wrapper, e.g.
  `"web": "bun scripts/plans.mjs serve bun web/server.ts"`.
- Cross-service refs: `portless get <name>`. No portless installed? The wrapper
  warns and falls back to a direct run on an ephemeral port.

## Convention

- One plan = one `*.html` file: `YYYY-MM-DD-NNN-short-title.html`. `NNN` is the
  repo-monotonic sequence — highest number is always the latest plan.
- `plans.config.json` holds the repo's randomized accent color, `nextSeq`, and
  the portless `appName`. Commit it; it keeps every machine's plans cohesive
  and every machine's app URL identical.
- Every page is interactive: ✓ approve / ✗ reject / double-click-edit each
  decision, then **Submit to Claude** (localhost listener, JSON download
  fallback). Decisions persist in `localStorage`.
- `DESIGN.md` holds the visual system + the decision-item contract.
- Pages are fully self-contained (inline CSS/JS, system fonts): they open from
  `file://` with no server and no build step.

This folder + `scripts/plans.mjs` are auto-scaffolded and version-upgraded from
`~/.claude/templates/plans/` by a SessionStart hook. Hook-owned files:
`plans.mjs`, `.plan-template.html`, `DESIGN.md`, `README.md`, `index.html`.
Plan pages themselves are never touched. Opt a repo out with an empty
`.no-claude-plans` file at its root.

App skeletons are **not** hook-owned — see `~/.claude/templates/appkit/` and its
`docs/ARCHITECTURE.md` for why that split exists.
