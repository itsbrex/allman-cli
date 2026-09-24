# BrowserOS account launchers

Native macOS launcher and branded browser with a purple JP icon. Build/install:

```sh
python3 scripts/macos-profile-app/install.py
open '/Applications/BrowserOS JP.app'
```

Requires the configured `~/.config/allman/jp/open-browser.py` launcher with
`--json` and `--restore-session`, and the repository runtime through mise. Use `--update` to replace an owned launcher after staging and signature checks;
a private backup is retained. Unrelated applications are never replaced. No packages are installed.

## Browser identity and updates

The application in `/Applications` runs as a background accessory. The actual
browser owns the single JP Dock icon, with bundle ID
`com.allman.browser.jp.engine`. Brian continues using BrowserOS neo.

On cold launches, `prepare_engine.py` creates or refreshes an APFS copy at
`~/.config/allman/jp/BrowserOS JP.app` from `/Applications/BrowserOS neo.app`.
The original application's updater remains responsible for downloading updates.
The generated copy follows that installed version on its next cold launch and
has its own updater disabled. Source signatures are checked; the copied entry
point and app receive local ad-hoc signatures. Vendor frameworks and the original
installation remain unchanged. Refresh refuses to replace a running JP browser
and retains one previous generated copy for rollback.

A tiny `JPBridge` executable routes opening the generated app (including a pinned
Dock icon after quitting) back through the main launcher. The configured
`~/.config/allman/jp/neo-cpu` script must call `prepare_engine.py`, then execute its
returned browser path with the existing CPU, profile, CDP and extension flags.
`open-browser.py` must recognize that generated executable when finding an
existing JP process. These private host scripts are prerequisites; the installer
does not overwrite them. The installed host has this wiring configured.

## JP backend storage

The browser profile and backend storage are separate settings. BrowserClaw
0.0.53 defaults to `~/.browserclaw` even when the browser uses JP's isolated
`--user-data-dir`. A newer default-Neo backend can migrate that shared database
beyond the bundled JP backend, preventing JP's API and MCP listeners from starting.

The installed JP adapter now passes:

```text
--browseros-server-resources-dir=/Users/hack/.config/allman/jp/mcp-resources
--disable-browseros-server-updater
```

`mcp-resources/bin/browseros-claw-server` is a copy of `jp-backend.sh` from this
directory. `mcp-resources/skills` points to the selected private vendor resources.
The wrapper sets `BROWSERCLAW_DIR` to `~/.config/allman/jp/browserclaw-state` and
executes the unmodified, signature-verified vendor backend at
`~/.config/allman/jp/backend-vendor/0.0.58/resources/bin/browseros-claw-server`.
This resource bundle was copied from the existing official Neo server update.
The older app-bundled 0.0.53 server also failed cross-call tab ownership checks.
Backend updates are explicit: verify a vendor resource bundle, retain the old
bundle and a consistent SQLite backup, then update the wrapper and skill link.
A separate server updater must not bypass this wrapper. Shared history is
preserved; JP begins with separate cockpit
history. Browser cookies, extensions, saved tabs, and the Allman store are unchanged.

Upstream boot reconciliation also tries to adopt existing `browseros-neo` MCP
entries. The backend-only macOS sandbox allows writes inside JP's backend state
but denies other writes beneath the user's home. Browser permissions are unchanged.
`first-run-connect.json` in JP's state has `firstRunConnectDone: true` to skip
automatic agent linking. Use the dedicated BrowserOS JP plugin to connect; agent
config writes through JP's cockpit are intentionally blocked.

The wrapper requires the state directory to exist (mode `0700`) and fails closed
if the backend is unavailable. It never changes `HOME`, modifies the vendor
binary, or removes migrations from an existing database. Host rollback: restore
the backed-up `neo-cpu` and restart JP; preserve the private state directory.

Repair verified on 2026-09-23: JP-owned listeners on 9012/9013/9211/9223,
MCP discovery and tab list, then create/read/close of a temporary tab across
separate MCP calls. The five previously failing cockpit API routes returned
HTTP 200. The native MCP page displayed endpoint 9012 without its connection
error. Its “0 of 7 connected” count describes upstream-managed agent configs;
the separate BrowserOS JP plugin is not registered through those Connect buttons.
Telemetry remained opted out after restart. Codex/Claude configs and the original
Neo skill matched their pre-repair hashes before the deliberate JP plugin update.
Backups: `~/.config/allman/jp/backups/mcp-repair-20260923-195248`.

## Saved sessions and account activation

Opening the app starts or reuses JP's saved profile on port 9223, restores saved
tabs on cold starts, verifies Shield, then runs `allman session activate jp`.
The existing guard pauses Brian's LinkedIn access before selecting JP. If
Brian's CDP endpoint is closed, the launcher reopens his saved Neo profile on
port 9222. Both launches explicitly pass `--remote-debugging-port` and
`--browseros-cdp-port`; JP uses 9223 and Brian uses 9222. Both registered browsers must stay reachable during verification.
Failure is shown; the guard is never bypassed.

Only the verified browser PID receives focus. Repeated opens reuse that process.
While the helper is running, focusing JP's browser also requests guarded
activation if another account is active. Quitting the helper does not quit JP's
browser, but disables this focus observer until the helper is reopened.

Inherited Allman/Playwright overrides are cleared before JP's settings are set.
Extensions use the same persistent profile and existing selections; they are not
reinstalled or reset on each launch. Local launcher/build changes apply on later
runs. Changes to the compiled Swift helper require rebuilding it.

Private log and last successful receipt:
`~/.config/allman/jp/logs/app-launch.log` and `app-launch.json`. Check the receipt's
`verifiedAt` timestamp: a failed opening does not replace an older success.

## Verification

```sh
python3 -m unittest discover -s scripts/macos-profile-app -p 'test_*.py'
'/Applications/BrowserOS JP.app/Contents/MacOS/JPLauncher' --self-test
codesign --verify --deep --strict '/Applications/BrowserOS JP.app'
codesign --verify --deep --strict "$HOME/.config/allman/jp/BrowserOS JP.app"
```

The app is locally ad-hoc signed, not notarized for distribution. Its self-test
checks bundled configuration, environment isolation and launcher availability
without opening a browser. Internal Chromium helper process names may still say
BrowserOS neo; the main browser's Dock identity is BrowserOS JP.

## Brian launcher

```sh
python3 scripts/macos-profile-app/install.py --profile brian --update
python3 scripts/macos-profile-app/install.py --profile jp --update
open '/Applications/BrowserOS Brian.app'
```

BrowserOS Brian has a blue BR launcher icon. It starts or reuses the original
Neo engine and saved BrowserClaw profile on fixed CDP port 9222, verifies Shield,
then activates Brian through the session guard. JP uses its purple engine on
9223. Missing companion browsers are opened through their existing launchers.
Brian's running engine retains the vendor Neo Dock icon; the accessory adds no
second Dock process. Pin or open the Brian launcher to guarantee launch flags.
Opening the original Neo application directly cannot add flags to an already
running process. If it was started without the required flags, quit it normally
and open BrowserOS Brian. No browser is forcibly stopped.

Brian follows vendor updates in the original app without copying its engine.
JP keeps its existing isolated backend and follows engine updates on cold starts.
Rebuilding either helper preserves additional installed configuration fields.
