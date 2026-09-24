# Durable working artifacts

Use this directory for work worth keeping. Do not write reports, captures, one-off
scripts, screenshots, or handoffs to `/tmp`.

```sh
run_dir=$(bun run --silent artifacts:new investigation)
printf '%s\n' "$run_dir"
# Write new evidence below "$run_dir"; each call returns a fresh directory.
```

`local/` is Git-ignored and private (0700). Recovery copies are 0600 and
non-executable. Keep private CRM/profile content, logs and experimental scripts
there. Promote reviewed, reusable code into `scripts/` and contact-free documentation
into `docs/`. Nothing in `local/` is automatically executed, published, rebuilt, or
cleaned. Builds may replace generated app/CLI outputs, never these archives.

## Recovery

```sh
bun run artifacts:recover --date 2026-09-23
```

Dates use America/Los_Angeles file modification time, midnight to midnight; override
with `--timezone`. The recovery tool recursively inspects regular files in `/tmp`,
excluding dependency/browser caches and symlinks. It selects Allman/JP filenames,
known review helpers, or small text files containing project references. It creates
a unique `local/recovered-<date>-<suffix>/files/` tree and `manifest.json` with source
paths, sizes, timestamps, SHA-256 hashes, selection outcomes and errors. Originals
remain untouched. Re-running creates another archive rather than replacing one.
Review `unrelated` entries when investigating additional projects; selection is not
an assurance that every system temporary file is relevant. Existing metadata cannot
recover files already deleted or whose modification date changed.

September 24 recovery preserved 128 September 23 files (22,388,324 bytes) and 114
related September 22 files (3,121,597 bytes), with zero copy errors. Exact manifests:

- `local/recovered-2026-09-23-o5m2jqj1/manifest.json`
- `local/recovered-2026-09-22-ihyjd59k/manifest.json`

Recovered patch scripts and vendor source captures are historical evidence. They
may contain old paths or destructive operations; do not run them as current tools.
No executable bits were carried into the archive. Unit-test fixtures and browser
scratch profiles may still use OS temporary directories when deliberately disposable.
App QA now retains its report and synthetic fixture in this directory.

Git ignore prevents accidental publication, not disk failure. Back up `artifacts/local/`
with the rest of your private workspace; Git alone will not preserve these files.
