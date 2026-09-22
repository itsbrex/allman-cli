# Relationship intelligence release candidate

This document owns the ten-task batch authorized on 2026-09-22. The release adds local intelligence to existing stored evidence. Live messaging, invitations, reactions, drafts, and CRM writes remain outside scope. No external qualification provider is contacted automatically.

## Upstream audit — task 1 complete

Fetched upstream and fork refs on 2026-09-22. Upstream `main` is `d19fb681c0b33116f8e9f8dad1ab23e900fb9d4f`; starting local commit `e07d45e` contains it, with 20 additional commits and no missing upstream commits. Upstream has no open PRs. Checked issue bodies, maintainer scope comments, and merged PR descriptions before selecting work.

| Source | Already available locally | Remaining work selected |
| --- | --- | --- |
| [tarkaai/allman-cli#35](https://github.com/tarkaai/allman-cli/issues/35#issuecomment-5335356697), [tarkaai/allman-cli#33](https://github.com/tarkaai/allman-cli/pull/33) | Upstream CLI 0.3.2 includes company slug resolution, quota docs and raw capture. Fork additionally preserves sparse company arrays and Sales Navigator fields. | Reuse; do not rebuild |
| [tarkaai/allman-cli#36](https://github.com/tarkaai/allman-cli/issues/36), [tarkaai/allman-cli#37](https://github.com/tarkaai/allman-cli/issues/37) | Fork `preSendSync` persists conversation metadata first and uses fresh read state plus explicit local acknowledgement. Existing regression tests cover both reports. | Reuse; mocked tests only |
| [tarkaai/allman-cli#34](https://github.com/tarkaai/allman-cli/issues/34), [tarkaai/allman-cli#32](https://github.com/tarkaai/allman-cli/pull/32) | Original package lookup rewrite and portable fixture | Namespaced build configuration, failed-artifact cleanup, hermetic browser-path handling and broader asset guards |
| [tarkaai/allman-cli#1](https://github.com/tarkaai/allman-cli/issues/1) | Contact tags and single-predicate saved lists | Composable tag groups and CLI workflows |
| [tarkaai/allman-cli#6](https://github.com/tarkaai/allman-cli/issues/6) | Directional, timestamped mail/LinkedIn timeline with duplicate and automation handling | Explainable score, decay, override, pinning and sorting |
| [tarkaai/allman-cli#7](https://github.com/tarkaai/allman-cli/issues/7) | Person/company facts, provenance and a private ICP reference | Versioned definitions, rules and offline LLM evidence handoff, freshness, overrides, filters |
| [tarkaai/allman-cli#14](https://github.com/tarkaai/allman-cli/issues/14#issuecomment-5235751185), [tarkaai/allman-cli#26](https://github.com/tarkaai/allman-cli/pull/26) | Stored first-degree and connections-of observations | Local graph traversal and explained introduction candidates; no drafted or sent requests |
| [tarkaai/allman-cli#2](https://github.com/tarkaai/allman-cli/issues/2), [tarkaai/allman-cli#8](https://github.com/tarkaai/allman-cli/issues/8), [tarkaai/allman-cli#9](https://github.com/tarkaai/allman-cli/issues/9), [tarkaai/allman-cli#10](https://github.com/tarkaai/allman-cli/issues/10) | Structured geo, canonical people, mail/Attio joins, provider-neutral observations and company rollups | Build on existing contracts; do not infer identity or relationships from names/employers |

Open upstream issues are not proof of missing local code. In particular, some comments describe an earlier upstream state. Broad issues remain open even after their data-layer prerequisites landed.

## Ten deliverables

1. **Complete:** upstream issue/PR/comment audit above.
2. **Complete:** Portable-build hardening against ambient configuration, builder paths and failed artifacts.
3. **Complete:** Composable tag groups with local CLI commands.
4. **Complete:** Explainable, history-derived relationship scoring; no fit/seniority blending.
5. Auditable manual score overrides and pinning.
6. Multiple private, versioned natural-language/structured ICP definitions.
7. Evidence-backed rule qualification plus bounded offline LLM export/import, unknown results and stale-result handling.
8. Composable ICP/rank/tag/company/location filtering and sorting.
9. Observed graph construction and ranked `intro-to` results with evidence on both legs.
10. End-to-end verification, docs/agent docs, release packaging and remaining-gap report.

Each implementation deliverable receives a focused commit and regression coverage. Private business context, contacts, cookies and qualification results stay outside the source repository. Existing user WIP is preserved.
