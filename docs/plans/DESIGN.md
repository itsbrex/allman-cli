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

Reader affordances (v11, already wired in the template — do not remove):

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
  confirm dialog listing them; "Review them" enters review mode, where
  navigation cycles ONLY the pending items (progress track dims the decided
  ones) until they're resolved — or "Submit anyway" sends them as `pending`
  (Claude skips those). With zero pending, a normal confirm dialog submits.
- **Color coding.** Per-repo accent = approve/identity; danger = reject;
  warn = edited/pending-attention. Each group gets a stable hue from the
  curated pool (skipping hues within Δ28° of the accent) shown on group chips,
  card left borders, and row stripes. Kind chips: edit=accent,
  structural=azure, verify=mint, note=amber.
- **Progress.** Segmented track under the toolbar (one clickable segment per
  item, colored by state, gaps between groups, focus ring on the current one),
  `n / N` position on every card, live ✓/✗/○ counts in the toolbar (○ jumps
  into review mode).
- **Persistence.** Decisions in `localStorage` (`plans:<slug>:<seq>`), reading
  position + view in `plans:<slug>:<seq>:ui` — reopening resumes where you
  left off. `dflt` seeding runs once and never overwrites a saved decision.
- **Accessibility.** `aria-live` announcer for card changes and submit
  results, real buttons with `aria-pressed`/labels everywhere, dialogs with
  `role=dialog aria-modal`, skip link, visible focus rings, and a persisted
  Motion: Reduced toggle (`html[data-motion=reduced]`) that kills all
  animation.
- **Theme + Motion toolbar buttons** (v13) — cycle the 13-entry theme list /
  toggle motion; both persist under the shared `plan-ui` localStorage key.
- **Submit to Claude** POSTs the full decision payload to
  `http://127.0.0.1:47613/submit`; when the listener is offline it downloads
  `<slug>-decisions.json` instead. A status dot pings `/ping` every 5s.

### Receiving decisions (Claude side)

When you expect the user to submit, start a listener in the background and let
its exit notify you:

```ts
// bun run listener.ts   (adapt OUT path per session)
const OUT = "<scratchpad>/plan-decisions.json";
const CORS = { "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type" };
Bun.serve({ port: 47613, hostname: "127.0.0.1", async fetch(req) {
  if (req.method === "OPTIONS") return new Response(null, {status:204, headers:CORS});
  const u = new URL(req.url);
  if (req.method === "GET" && u.pathname === "/ping")
    return Response.json({ok:true}, {headers:CORS});
  if (req.method === "POST" && u.pathname === "/submit") {
    await Bun.write(OUT, await req.text());
    setTimeout(() => process.exit(0), 400);
    return Response.json({ok:true}, {headers:CORS});
  }
  return new Response("plans listener", {headers:CORS});
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

**Motion policy (deliberate):** the OS `prefers-reduced-motion` media query is
NOT honored by default — motion is full unless the person picks Motion:
Reduced (toolbar button on plan pages, command-bar Setting in app shells),
applied as `html[data-motion=reduced]` and persisted. This is a conscious
departure from the usual accessibility default for these internal tools; the
reduced setting remains one click away and sticky.

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
  Esc closes, Enter fires the primary.
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
Reduced motion is the explicit `html[data-motion=reduced]` gate (see Motion
policy under Theme) — it kills transitions, animations, and smooth scroll.

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
`127.0.0.1:47613` listener ping/submit, which degrades gracefully.
