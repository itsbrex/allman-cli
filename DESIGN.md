---
name: Allman target review
description: Account-scoped prospect review with persistent actions
colors:
  bg: "oklch(.1 .008 84)"
  bg-1: "oklch(.13 .01 84)"
  bg-2: "oklch(.155 .011 84)"
  txt: "oklch(.97 .006 84)"
  txt-2: "oklch(.74 .017 84)"
  accent: "oklch(.83 .16 84)"
  accent-contrast: "oklch(.23 .05 84)"
typography:
  body:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontSize: ".875rem"
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontWeight: 500
    lineHeight: 1.5
  title:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "clamp(1.25rem,1.1rem + .5vw,1.75rem)"
    fontWeight: 600
    lineHeight: 1.3
  mobile-title:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
  date-emphasis:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.3
  code:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  legacy-accent:
    fontFamily: "Geist Pixel Square, Geist Mono, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "6px"
  md: "8px"
spacing:
  sm: "8px"
  md: "16px"
components:
  review-button:
    backgroundColor: "{colors.bg-1}"
    textColor: "{colors.txt}"
    rounded: "{rounded.sm}"
    height: "44px"
    padding: "9px 14px"
---

# Design System: Allman target review

## Overview

**Creative North Star: "The Prospect Review Desk"**

Scope: `apps/target-enrichment.html` only. Extracted through Impeccable document scan mode from the existing Appkit tokens and review components. Product language inferred from the user's brief: calm, direct, readable, action-oriented. This does not replace the separate plans system in `docs/plans/DESIGN.md`.

**Key Characteristics:**
- Evidence and local review outcomes remain distinct.
- Primary actions remain visible while evidence scrolls.
- Report administration is secondary to reviewing people.

## Colors

Goldenrod's warm charcoal surfaces and gold accent remain the dark default. Auto respects system light preference; Paper provides a light surface. Existing named themes remain supported. Frontmatter records Goldenrod values; CSS theme overrides remain normative for other palettes.

Matched findings use green, uncertain findings amber, missing identity rose, source information blue, and candidates violet. Every state includes text; color never implies independent verification.

## Typography

Geist Sans carries operational text: 16px body, 14px labels and metadata. Profile headings use a fluid 20–28px scale. Keep long prose within 75ch. Retain embedded fonts for offline use; monospace is reserved for identifiers and commands.

## Layout

At 760px and below, records become stacked labeled summaries and the decision dock sits at the bottom of the full-height drawer, above the safe area. Larger viewports place the dock directly beneath identity. Evidence alone scrolls; identity and decisions remain available.

Above 1100px, the panel uses 56vw, capped at 900px; above 2000px it uses 42vw, capped at 1100px. The main register caps at 2400px. Do not stretch prose across a 5120px display. Dynamic viewport height accommodates mobile browser chrome. Short landscape screens retain a scrollable evidence area.

## Elevation & Depth

Existing offset, soft popover shadow separates the profile from the dimmed register. Dividers organize evidence; no decorative cards within cards. Background is inert while the modal profile is open.

## Shapes

Controls use the existing 6px radius; record summaries use 8px. Minimum custom action target is 44×44px. Inputs and decision buttons share the same border, type, and spacing system.

## Components

Review dock: Verified, Investigate, Skip are reversible local choices. Selected state uses color plus `aria-pressed`. Reset returns to Unreviewed without deleting the note. Save errors retain values in memory and direct the user to export.

Profile drawer: focus stays inside; Escape closes and restores focus. Notes and email editing use progressive disclosure. Next/previous respect the current filtered order and reset evidence scroll.

Draft email: only explicit saved or typed addresses enter the recipient. Missing email leaves recipient blank and explains why. Subject/body are editable; drafts never send automatically. Record changes discard draft edits after an explicit warning in the editor. Copy brief includes saved role fields and current note.

Record summary: explicit Review profile entry coexists with labeled external links. Mobile preserves findings, target/current employers and observation dates. Sorting remains available in a native select.

Motion: 120ms press feedback at scale 0.96; 220ms drawer transition with cubic-bezier(.2,0,0,1). Keyboard actions and reduced motion suppress animation. Theme changes suppress transitions. Routine table updates are instant. First use offers a concise task hint rather than a blocking entrance animation.

## Do's and Don'ts

- Do preserve date precision, provenance, and uncertainty.
- Do keep primary actions outside long evidence content.
- Do derive new styling from semantic tokens.
- Don't infer email addresses or send messages from this app.
- Don't equate a local Verified choice with a CRM update.
- Don't reduce text to fit a desktop table on phones.
