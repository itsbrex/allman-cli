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
