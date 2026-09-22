# Build a first-degree connection baseline

Use three passes: enumerate the network, optionally collect Sales Navigator's
richer search fields, then deep-enrich the flagship identities in quota-sized
batches. These commands read LinkedIn and write the local store; they do not
send messages or invitations. `sync` imports conversations, not connections.

## 1. Verify the selected account

Use the same explicit store and account on every command, or a dedicated
launcher with those defaults. Check browser protection before a login or a
query-ID capture, and verify the saved session with a live account check:

```sh
allman browser doctor --json
allman status --store /absolute/path/to/store --account account-slug --check
```

Plain `status` checks local cookies only. If the live check fails, stop and use
protected `allman login` for that account before trying the imports.

## 2. Enumerate all first-degree connections

```sh
allman connections --store /absolute/path/to/store --account account-slug \
  --flagship --include-headline
```

Flagship is the default backend even with a Sales Navigator seat. It stores
names, LinkedIn identities, slugs, headlines, and connection observations under
`<account-id>/connections/`. Existing enrichment is preserved by the upsert.
Keep the final-page output as evidence of reaching the endpoint's end; a
successful limited sample is not a complete export. The CLI has a 35,000-record
safety cap. A sweep is not an atomic snapshot of a changing network and does
not delete older records that no longer appear.

Do not add `--json` or `--no-save` when building the store: these are ephemeral
export modes. A separate enumeration pass is easier to resume and audit than
combining it with `--enrich --deep`.

## 3. Collect Sales Navigator fields, when available

```sh
allman connections --store /absolute/path/to/store --account account-slug \
  --salesnav
```

This requires the seat cookie captured by login. Results include available
title, company, location, about text, positions, and other Sales Navigator
fields without a separate per-person enrichment request. They are stored under
`<account-id>/connections-salesnav/` with Sales Navigator/member identities.

Sales Navigator search caps pagination at **2,500 results**. Its reported total
can differ from flagship enumeration, so retain both coverage counts. It cannot
replace the full flagship sweep for larger networks. The export does not join
the two namespaces automatically; a verified numeric member ID from profile
detail can support an identity join. Never equate records by name alone.

`connections --salesnav --deep` and `--salesnav --enrich` are rejected. There is
currently no Sales Navigator-specific deep-profile command. Full work history,
education, and skills use the flagship enrichment path below.

## 4. Deep-enrich in bounded, resumable batches

```sh
allman enrich --store /absolute/path/to/store --account account-slug \
  --deep --limit 100
```

Re-run that command after capacity returns. Records already enriched to the
requested depth are skipped; core-only records are upgraded. Avoid `--force`
for the initial baseline. Bulk enrichment visits stored flagship records,
including any ad hoc records previously added with `enrich <target>`; use a
connection-only store if strict first-degree scope is required.

The CLI's default rolling limits are **100 profile attempts/hour with a saved
Sales Navigator seat cookie** or **25/day without one**, subject to account
configuration. These are local safeguards, not published LinkedIn allowances
or guarantees of acceptance. Failed attempts consume capacity. The ledger
persists across runs; do not reset it or copy the same account into another
store to bypass it. The CLI allows only one LinkedIn command at a time across
stores and accounts. Stop a running `listen`/`start` before enrichment. With
[single-profile control](single-active-profile.md) enabled, explicitly activate
the desired profile before a batch; inactive accounts remain available for local
history and relationship queries.

Fetching is paced between profiles. On exhaustion the command stops and reports
when capacity returns; it does not wait or schedule another run. For 1,427
unenriched profiles, the default seat-aware cap requires at least 15 batches
with up to 100 attempts each. At least 14 quota-window intervals separate the
first and last batches; request time, failures, and availability add to that.

Read the final enriched/skipped/failed counts and warnings, not only the exit
code: bulk mode can report failed profiles or exhausted capacity and still
exit successfully. Stop on authentication rejection, account restriction, or
rate-limit errors rather than repeatedly attempting remaining records. Missing
or inaccessible fields remain missing; `enrichDepth: deep` records the requested
fetch depth, not proof that every profile field is available.

## Keep other accounts isolated

Give every account its own store, browser workspace, and persistent Neo profile.
Changing `--account` alone does not isolate a shared CDP browser. See
[isolated account setup](browser-support.md#isolated-accounts).

Shield protects browser pages used by login and query-ID capture. The CLI's
direct HTTP API requests run outside browser extension coverage.
