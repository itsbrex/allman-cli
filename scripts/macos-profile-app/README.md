# BrowserOS JP launcher

Native macOS launcher and branded browser with a purple JP icon. Build/install:

```sh
python3 scripts/macos-profile-app/install.py
open '/Applications/BrowserOS JP.app'
```

Requires the configured `~/.config/allman/jp/open-browser.py` launcher with
`--json` and `--restore-session`, and the repository runtime through mise. The
installer refuses to overwrite an existing app. No packages are installed.

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
