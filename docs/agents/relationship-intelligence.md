# Relationship intelligence agent contract

Upstream references: tarkaai/allman-cli#1, tarkaai/allman-cli#6,
tarkaai/allman-cli#7, tarkaai/allman-cli#14. The [release batch](../releases/2026-09-22-relationship-intelligence.md)
is the authoritative audit and completion record.

## Boundaries

- New commands use stored data only. No browser initialization, LinkedIn API calls,
  Attio writes, provider/model calls, sends, drafts, invitations, or remote read-state changes.
- Preserve existing Shield-first requirements when maintaining separate browser commands.
- Runtime context, ICP definitions/results/handoffs, rank overrides and audit history
  live outside the Git-backed store, through `writePrivate` and `withWorkspaceLock`.
- Named profile folders keep private evidence in `relationships/`, beside `store/`.
  Relocation must retain the existing workspace, file identities, quotas and history;
  do not let a changed store-path hash select an empty workspace. Keep the session
  registry and command lock shared across profile selections. See [profile folders](../profile-folders.md).
- Keep user business settings out of source fixtures. Cresa reference remains private;
  runtime criteria must not invent numeric thresholds or geographic restrictions.
- The companion relationship TUI now exposes fit/rank evidence and observed introduction
  queries in views 5 and 6. Its writes use the CLI; new definitions and model-result
  imports remain CLI workflows. Select the current CLI explicitly if its sibling checkout
  is older. Do not confuse cached snapshot freshness with a live provider check.

## Ownership and semantics

- `src/relationships/rank.ts`: deterministic `history-v1`, 0–100 history heuristic,
  90-day half-life. Exclude automation, duplicate events, unknown directions and
  group mail. Scores are not probabilities, social standing or ICP fit.
- `rank-overrides.ts`: retain derived score/evidence; journal every operator override
  and pin. Overrides never create an observed relationship.
- `icp.ts`: validate and append definitions; unchanged content does not bump version.
- `facts.ts`: export only current person/company facts and provenance. Do not expose
  mail bodies or addresses in model handoffs. Unknown field observation times cannot
  establish fresh evidence, even if the containing person record was recently touched.
- `qualification.ts`: required criteria compose with AND. Missing/conflicting/expired
  evidence is unknown. Fingerprints cover definition version and source facts. Model
  imports validate every row before any write; evidence IDs must exist and be fresh.
  Model assertions remain labeled `llm-import`. User overrides are sticky, audited and
  may themselves become stale; clear/renew explicitly.
- `icp export --list <group>` reuses saved-group predicates before pagination and exports
  at most 100 contacts from one snapshot. This flag is export-only; do not pass it to
  qualification, whose writes can change membership of a fit-based group.
- `relationships.ts`: filters compose; extra filters narrow saved groups. Stale or
  unknown qualification cannot enter a default positive ICP filter. Rank and fit stay
  separately inspectable. Changing data invalidates results without paid background work.
- `graph.ts`: first-degree sweeps, explicit connections-of results, reciprocal direct
  owner/contact interactions. No name/company merge, inferred coworker edge, group-mail
  peer edge, or enrichment-implies-connection shortcut. Sales Navigator numeric bridges
  must be unique; conflicting IDs stay separate. Require degree 1 for SalesNav sweeps.
  `connectionObservedAt` belongs to the connection sweep; enrichment must not refresh it.
  First/second-leg evidence accompanies every introduction candidate. Unmeasured peer
  strength remains null, so a multiplicative composite may be unavailable.

## Verification

Use `bun run test`, never `bun test`. Regression tests include groups, rank, overrides,
ICP definitions/qualification, combined filters, observed graphs, and
`relationship-cli-integration.test.ts`. The latter exercises real subprocess commands
against synthetic private stores, including rejected imports leaving state unchanged.
Set `ALLMAN_TEST_BINARY` to an absolute compiled binary path to run the same flow against
an artifact. `store-git-isolation.test.ts` verifies hooks and nested stores cannot
redirect store commits into a parent repository. Preserve these behavioral assertions.

After repository edits run the required CodeDB refresh probe. Publish nothing merely
because local checks pass. `bun run release TAG` defaults to local four-target packaging;
publication requires an explicit target matching both origin URLs, a clean main branch,
and the existing pushed-main/tag checks.
