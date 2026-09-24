# One active LinkedIn profile

All LinkedIn CLI commands share one process lock across accounts and stores.
`listen` and `start` hold it for their lifetime. A second network command refuses
immediately instead of waiting or creating another session. Local history,
relationship, rank, ICP, graph, and plain `status` commands remain available.

For persistent account selection and browser enforcement, register each isolated
profile using that profile's launcher/environment. Each must already have its own
saved loopback HTTP CDP endpoint and verified Shield build:

```sh
allman session register brian --store /absolute/path/to/brian-store --account brian-alias
allman-jp session register jp
allman session activate jp
allman session status --json
allman-jp status --check
```

Registration blocks LinkedIn in that browser and closes its LinkedIn tabs. It
does not log the account out or copy/delete its cookies. Registering a name or
browser twice is rejected. A new account may be registered with an explicit
`--account` alias before login, then activated and signed in through its launcher.

To switch or pause:

```sh
allman session activate brian
allman status --check
allman session activate jp
allman-jp status --check
allman session pause
```

Switching blocks every other registered browser before enabling the chosen one.
It closes only inactive LinkedIn tabs. Other browser pages and each profile's
extension selection remain intact. Reopen LinkedIn in the selected browser when
needed. The command refuses while a LinkedIn CLI operation is running.

The selected account/store and browser workspace must match the registered
binding. `--account`, `--store`, `--cdp`, environment overrides, or another launcher
cannot silently switch it. Neo MCP imports are refused while this control is
enabled because their endpoint does not prove a binding to the selected CDP
profile. `status --check` verifies only one resolved account.

Browser protection uses Shield's dynamic rule `2000000001`, blocking all request
types to `linkedin.com` and `licdn.com`, including page loads, API calls, and
WebSocket handshakes. Existing Shield privacy rules and unrelated dynamic rules
are preserved. A conflicting rule ID stops the operation. Chrome persists dynamic
rules across browser sessions and extension upgrades; see the
[Chrome declarativeNetRequest documentation](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest).

Every guarded command verifies Shield and the expected pause state in every
registered browser before contacting LinkedIn. Registered CDP endpoints must be
reachable, including inactive browsers (which can remain open for other sites).
If a browser is closed, reopen its same persistent profile and retry. Missing
Shield, an incorrect pause state, or an unavailable browser stops the command.
`session activate <name>` reapplies the required state after protection is restored.

Selection lives privately in `$XDG_CONFIG_HOME/allman/session-control.json`
(normally `~/.config/allman/session-control.json`, mode `0600`). The adjacent
`linkedin-command.lock/` records a PID and operation, never cookies or command
arguments. Proven dead owners are recovered automatically; unreadable or live
owners are not forcibly removed. A failed switch saves `active: null` before any
further CLI network access is allowed.

This controls one account/profile, not one TCP socket. A browser or command can
use several connections for that account. It covers this CLI and registered
Shield-protected browsers, not unrelated browsers, older binaries, arbitrary
scripts, or a disabled/uninstalled Shield. It is not an operating-system firewall.
Keep all launchers on the guarded checkout and retain the shared configuration.
Direct CLI HTTP requests are outside Shield's browser interception but are
subject to the CLI account and command lock.

[Named profile folders](profile-folders.md) scope default stores and workspaces
with `ALLMAN_PROFILE`. They never scope the shared registry or command lock.
Do not use different `XDG_CONFIG_HOME` values to isolate account settings: that
would also select a different session-control root. Choosing a profile's launcher
does not activate it; `session activate` remains the only account-switch workflow.

## Recover after closing JP's app on this Mac

`allman-jp` selects JP's store/account; ordinary commands attach to its existing
browser. Only the launcher's login branch automatically invokes its browser opener.
The saved JP endpoint is port 9233; Brian uses 9222.

```sh
allman-jp-browser           # reopen the existing dedicated JP profile; no new login
allman session activate jp # preserve the single-active-profile guard
allman-jp connections --flagship --include-headline --raw
```

If activation names another unavailable registered browser, reopen that browser's
same persistent profile too, then retry the intended switch. Do not change CDP
ports or use another account's browser as a workaround. Closing an app does not
remove its saved account, cookies or local data. Plain `allman-jp status` and
`allman exports refresh` remain local; `status --check` makes a provider request.

### Shield verification and tab deduplication

An installed Shield can appear unavailable if a tab-management extension closes
Allman's temporary verification page. On this Mac, Clutter Free closed duplicate
`about:blank` bootstrap tabs before they could navigate. JP's Clutter Free allow
list now preserves `about:blank`, the configured Shield popup, Extension Control
Center's sidepanel and Clutter Free's options page. Existing website exceptions
and enabled extensions were preserved. Interrupted navigation now reports an
interrupted verification rather than asserting that Shield is missing.

`allman-jp-browser` reuses `~/.config/allman/jp/neo-profile` and verifies Shield on
each invocation. It no longer reapplies the saved enable/disable preset merely
because it started the browser. Use `allman-jp-browser --configure-extensions`
only when intentionally restoring that preset. This is a local launcher option,
not a portable Allman CLI subcommand.

Account stores and browser profiles serve different purposes: sharing team exports
does not replace the profile's cookies or installed extensions. Keep the unpacked
Shield build at its configured path; loading that same build during startup does
not recreate the profile or reinstall unrelated extensions. No Chrome DevTools
MCP installation was necessary for this repair.
