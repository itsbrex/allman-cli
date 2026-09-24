# Target review usability pass — 2026-09-24

Scope: `apps/target-enrichment.html`, its presentation tests, browser QA and design documentation. No enrichment, CRM writes, email sends or live review decisions were performed.

## Checkpoint before changes

- `24f3bd1`: browser atlas and prospecting research.
- `a634ee5`: account workspace, scoped enrichment, persistent exports and app tooling.
- `ca065d8`: isolated JP backend adapter.

Working tree was clean after those three commits. Private captures remained ignored under `artifacts/local/`.

## Review and changes

Impeccable critique ran two independent assessments with user approval. Design score: 23/40; bounded technical audit: 11/20. The initial drawer kept its 460px width even at 5120×2800; actions appeared thousands of pixels below identity. Mobile retained a 900px table inside a 360px scroller.

Applied clarify, adapt, harden, animate, delight, extract, document and polish workflows, plus better-ui and emil-design-eng guidance:

- Persistent local review decisions below identity on desktop, at the bottom on mobile.
- Next/previous within the filtered list; reset returns to Unreviewed while retaining notes.
- Mobile records stack with visible field labels and explicit Review profile controls.
- Body evidence is 16px; supporting text is 14px; primary controls are at least 44px tall.
- Wider detail panels preserve readable prose measures. Dynamic viewport height and safe-area padding protect short/mobile screens.
- Report administration is collapsed; the arrival summary emphasizes profiles ready for review.
- Draft email uses only explicit `email` from the report or a typed address. Existing JP report has no email field, so recipient remains blank. Subject and body are editable; no send operation exists. Copy brief includes the current note and saved role fields.
- Keyboard focus includes textareas, selects and disclosure summaries. Background content is inert while the drawer is open.
- Storage failure keeps decisions in memory and explains export recovery. Invalid report fixtures preserve the current view.
- Motion is limited to press/drawer continuity; keyboard, reduced motion and theme changes suppress transitions. No loading choreography delays work.

`DESIGN.md` and `.impeccable/design.json` capture the extracted review system. They are scoped to this app; the separate plans design guide remains unchanged. Theme CSS remains authoritative for the existing alternative palettes.

## Verification

- `bun run check`: passed typecheck, app integrity, temporary-artifact recovery tests, **91 Vitest files / 756 tests**.
- `bun run build` and `bun run build:node`: passed.
- `bun run enrichment:qa`: passed at 320×740, 390×844, 768×1024, 844×390, 1386×878, 1920×1080, 2560×1440 and 5120×2800.
- Browser tests cover persistent action visibility after scrolling, no page overflow, mobile table reflow, minimum action dimensions, keyboard wrapping, note reload persistence, reset, navigation scroll reset, valid/invalid/absent recipients, encoded email parameters, escaped hostile strings, invalid import, storage denial, CSV escaping and reduced motion.
- Final browser QA: `artifacts/local/2026-09-24T19-07-19.531Z-enrichment-qa-e8CSKC/result.json`.
- Live JP profile inspected through Codex browser: buttons at y=163px in 1386×878 viewport, each 44px tall; body evidence 16px, metadata 14px. No live local decisions modified.
- `ALLMAN_PROFILE=jp bun run enrichment:build` regenerated the saved report. Existing server reads the updated file and recomputes its script CSP hashes.
- CodeDB refresh probe passed after repository edits.

## Detector and coverage limits

Post-change detector ran once: 43 warnings/advisories. They concern legacy base selectors superseded by later rules, retained font taste heuristics, and the initial document's partial token inventory versus existing theme variants. Font/title entries were subsequently expanded in the design document. No second detector scan was run, and no clean-detector claim is made. Computed review padding is nonzero; modal/command borders are removed by final rules. Do not replace the incumbent font or discard supported themes merely to satisfy detector taste heuristics.

The critique overlay could not run because the app's CSP blocked script injection; CSP was not weakened. Temporary visualization server was stopped and private evidence moved under `artifacts/local/`. Critique snapshot was archived; polish recognized changed target bytes and closed its active backlog. No post-change numerical design score is claimed.

Not verified: physical touch devices, VoiceOver/screen-reader walkthrough, native mail-client handoff, actual browser zoom, all theme contrast combinations, 10%-speed animation frame inspection, or remote network performance. Responsive tests use emulated viewports; they are not a claim of full WCAG conformance.

Reference: [W3C 44px target guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html).
