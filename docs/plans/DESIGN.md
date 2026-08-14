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
  `role=dialog aria-modal`, skip link, visible focus rings,
  `prefers-reduced-motion` kills all animation.
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

OLED-native dark, single theme. True black `#000` base, near-black elevated
surfaces separated by lightness + hairline borders, never drop shadow. No
gradient backgrounds, no gradient text, no glassmorphism. Precision-instrument
feel: dense, legible, fast.

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
amber 75, pink 8, coral 30, mint 165, azure 245, magenta 330, chartreuse 105.

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
Content `max-width:1100px` (dashboard 900px). Sticky toolbar solid `--surface-2`
+ hairline, no blur. Mobile <640px: single column, cards stack full width.

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
`@media (prefers-reduced-motion: reduce)` → instant everything.

## Self-contained rule

Every plan page is one `.html` with all CSS + JS inline and system-font stacks.
It must open from `file://` with no network and no build step — `bun run plans`
(or a double-click) always works offline. The only network call is the optional
`127.0.0.1:47613` listener ping/submit, which degrades gracefully.
