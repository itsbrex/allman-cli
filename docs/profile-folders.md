# Consolidated account folders

Named profiles keep their Allman-managed files together under
`$XDG_CONFIG_HOME/allman/<name>/` (normally `~/.config/allman/<name>/`).
`ALLMAN_PROFILE` selects a name. If unset, `default-profile.json` in the shared
Allman config root may select one with `{"profile":"brian"}`. Without either
selector, existing global configuration and upstream defaults still apply.

```text
~/.config/allman/
  default-profile.json          default CLI configuration: brian
  session-control.json          shared active LinkedIn profile: jp
  linkedin-command.lock/        shared lock, only while a command runs
  brian/
    default-store.json          {"storePath":"/Users/hack/.config/allman/brian/store"}
    store/                      LinkedIn records and Git history; private cookies ignored
    browser-workspace/          browser config and Allman-owned capture profiles
    relationships/              mail, Attio evidence, ICP, ranking, graph settings
    runs/                       private import receipts
  jp/
    default-store.json          {"storePath":"/Users/hack/.config/allman/jp/store"}
    store/
    browser-workspace/
    relationships/
    neo-profile/                JP's dedicated Neo data, cookies and extension storage
    extensions/                 JP's copied extension packages
    open-browser.py             local browser helper
    neo-cpu                     CPU flag and selected extension package paths
```

The names in this example are configuration scopes, not LinkedIn usernames.
Profile names allow 1–64 lowercase letters, digits, underscores and hyphens,
starting with a letter or digit. A selected profile without `default-store.json`
fails closed; initialize it with `ALLMAN_PROFILE=jp allman store use <absolute-path>`.
Selecting a store does not import data, copy cookies, or activate an account.

For a selected profile, browser configuration defaults to its `browser-workspace/`.
Private relationship data defaults to its `relationships/` only when the requested
store matches that profile's saved store, including filesystem aliases. An unrelated
explicit store retains the separate legacy hashed workspace; it does not inherit
another account's mail or ICP data. Explicit `ALLMAN_BROWSER_WORKSPACE` and
`ALLMAN_RELATIONSHIP_STORE` overrides remain available. Private relationship data
must stay outside the Git-backed store.

## This workstation

`allman` still defaults to Brian's configuration. `allman-brian` and `allman-jp`
select their named configurations and clear inherited store/browser/private-workspace
overrides. All three launchers use the same guarded checkout. The CLI configuration
selection is separate from the active network profile; choosing a launcher does not
switch LinkedIn accounts. With JP active, Brian's live commands refuse.

```sh
allman session status --json
allman-brian status                 # local saved metadata
allman-jp status --check            # live check, only while JP is active
allman session activate brian      # pauses JP before enabling Brian
allman-brian status --check
```

Keep `XDG_CONFIG_HOME` shared across launchers. `ALLMAN_PROFILE` changes account
configuration only; `session-control.json` and the command lock remain in the shared
root. See [single-profile control](single-active-profile.md).

Brian's ordinary Neo data remains at its existing operating-system location. It
contains unrelated browsing data and was explicitly excluded from consolidation.
JP's dedicated Neo directory and current extension selection move together.
The shared Shield build and other local development extension source directories
remain where those projects are maintained; extension storage remains isolated.

Legacy paths are compatibility symlinks, not duplicate stores. Existing TUI paths,
old relationship-workspace hashes and local saved scripts continue to reach the
same moved records. Do not delete these aliases until every consumer has migrated.
Private migration receipts and previous helper/config files live under
`~/.config/allman/migrations/2026-09-22-profile-folders/`.

## Moving an existing profile

Pause all profiles and hold the shared command lock. Stop only a dedicated browser
whose data directory is moving; never move a browser profile while it is in use.
Move the existing store, private relationship workspace, quota ledger, browser data
and receipts without recreating identities or resetting quotas. Update saved paths,
launchers, extension package paths and session bindings while `active` remains null.
Retain compatible aliases for older consumers. Compare file hashes and Git heads.
Reopen the moved browser, verify Shield and persisted pause rules, then reactivate
exactly one profile and run a read-only identity check. Preserve manual extension
choices and never copy another account's cookies into a fresh profile.
