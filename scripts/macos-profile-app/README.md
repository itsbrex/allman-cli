# BrowserOS JP launcher

Native local macOS launcher with a purple JP icon. Build/install with:

```sh
python3 scripts/macos-profile-app/install.py
open '/Applications/BrowserOS JP.app'
```

Requires the already configured `~/.config/allman/jp/open-browser.py` launcher
with `--json` output and a project-aware Bun installation through mise. The
installer refuses to overwrite an existing app. No packages are installed.

Each opening calls the current launcher source, using the repository's runtime
through mise. The launcher starts or reuses the same JP profile at CDP port 9233,
loads the configured extension set and verifies Shield. The app focuses only the
verified browser PID. Duplicate openings while verification is running coalesce.
All inherited Allman/Playwright overrides are removed, then JP's account variables
are set. No interactive shell initialization is needed.

The browser executable is always the installed `/Applications/BrowserOS neo.app`.
Its normal updater remains responsible for browser updates; the wrapper inherits
the updated installation on the next browser start. No copied browser, separate
browser updater, login migration, extension reinstall or additional update daemon.
Changes to the local launcher and extension build take effect on subsequent runs.
Changes to this small compiled launcher UI require rebuilding the app.

Opening this app runs `allman session activate jp` after browser verification,
pausing Brian's LinkedIn access through the existing guard. If Brian's endpoint
is closed, the app reopens his existing default Neo profile in the background
at port 9222 before switching. Both registered browsers must be reachable.
Activation failure is shown and never silently
bypassed. Quitting the
launcher does not quit the browser. The launcher has its own Finder/Dock icon;
the actual Neo browser process and windows retain Neo's original branding.

Private verification log and launch receipt:
`~/.config/allman/jp/logs/app-launch.log` and `app-launch.json`.

The app is ad-hoc signed for this Mac, not notarized for distribution. Its
`--self-test` executable option checks bundled configuration and environment
isolation without opening a browser. Installer source and generated icon are
original; the signed Neo application bundle remains untouched.
