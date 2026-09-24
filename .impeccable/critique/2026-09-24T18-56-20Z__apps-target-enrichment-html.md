---
target: apps/target-enrichment.html
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/hack/github/allman-cli/apps/target-enrichment.html"
target_fingerprint: "sha256:a34db38baca8698f577cf55954e5e5605d78db7ae0187b74aea8fe2e5ff84d18"
target_path: /Users/hack/github/allman-cli/apps/target-enrichment.html
timestamp: 2026-09-24T18-56-20Z
slug: apps-target-enrichment-html
closed: true
---
Method: dual-agent (A: /root/design_review · B: /root/technical_review).

**Design specificity:** evidence and career summaries fit prospecting well. Layout still prioritizes report administration over reviewing people. Keep charcoal/gold theme; change hierarchy.

| Nielsen heuristic | Score | Main issue |
|---|---:|---|
| System status | 3/4 | Save state exists, but active filters unclear |
| Real-world language | 2/4 | “Verified” lacks definition |
| User control | 3/4 | No explicit return to Unreviewed |
| Consistency | 2/4 | Name opens LinkedIn; row opens review |
| Error prevention | 3/4 | Conservative evidence labels; decision meaning unclear |
| Recognition | 1/4 | Primary actions buried |
| Efficiency | 2/4 | No visible next-person or email-draft path |
| Minimalism | 2/4 | Long introduction and repeated information |
| Error recovery | 2/4 | Generic import errors; storage failures unhandled |
| Help | 3/4 | Strong sourcing guidance; weak decision guidance |
| **Total** | **23/40** | **Substantial improvement needed** |

**Working well:** linked provenance, honest uncertainty, readable work/education summaries. Existing keyboard navigation and reduced-motion support provide useful foundation.

**Priorities:**

1. **P1 — Persistent review actions.** Desktop actions begin at y=3301; long mobile example y=5351. Fitts’s Law and recognition favor actions beside identity, with bottom placement for thumbs. Apply **adapt + clarify**: persistent decision bar, definitions, local save state, next/previous.
2. **P1 — Mobile records and readable type.** 900px table sits inside 360px scroller. First record begins at y=1343. Apply **adapt + typeset**: stacked records, 16px evidence, 14px supporting text, 44px controls.
3. **P1 — Wider evidence panel.** Drawer stays 460px at 5120px viewport. Apply **layout + adapt**: responsive panel with bounded prose width; additional space supports comparison.
4. **P2 — Reduce setup overhead.** Repeated metrics, instructions and exports consume first screen. Hick’s Law favors clear primary task. Apply **clarify + distill**: compact summary, secondary report tools, explicit Review buttons.
5. **P2 — Faster, recoverable action.** Apply **harden + delight**: email drafts, copyable brief, reversible decisions, retained notes and useful errors. Saved reports currently omit email; recipient must remain blank unless supplied explicitly.

**Cognitive load:** five checklist failures—competing focus, excessive choices, weak hierarchy, lengthy dossier, memory burden. **Emotional journey:** good evidence reassurance, followed by scroll fatigue; clear save confirmation and next-person navigation should finish each review.

**Persona risks:** Alex loses time scrolling; Sam faces small text and incomplete focus trapping; Casey cannot review comfortably one-handed.

**Detector:** six findings; several base-style warnings superseded by later CSS. Browser inspection independently confirmed layout defects. CSP blocked overlay injection; screenshots and computed layout provide fallback evidence.

**Design questions resolved:** primary task = review one person, act, continue. Email = editable draft, never send. Widescreen = useful space with readable measure. Delight = confidence and saved effort, with brief press/save feedback rather than page-load choreography.

Questions skipped: user requested self-resolved design decisions and implementation.
