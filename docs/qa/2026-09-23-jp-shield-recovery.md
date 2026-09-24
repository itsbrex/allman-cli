# JP Shield verification recovery

## Diagnosis

- JP's existing Neo process used its dedicated persistent profile and port 9233.
- Shield's installed ID matched the configured build, and its worker was running.
- A direct CDP probe created `about:blank`; the tab was destroyed within 800 ms.
  A unique blank URL and direct Shield popup remained available. JP had Clutter
  Free enabled; its duplicate-tab removal explains the observed behavior.
- The previous verifier caught navigation errors and reported every failed
  candidate as a missing Shield installation. A second reproduction passed
  Shield but lost the next extension-inspection tab with `TargetClosedError`.

## Repair

- Added four narrow Clutter Free allow-list entries: `about:blank`, Shield's
  popup, Extension Control Center's sidepanel and Clutter Free's options page.
  Prior entries, control mode and extension selection were preserved. Saved the
  prior settings privately beside JP's launcher for rollback.
- JP's local launcher no longer reapplies extension enable/disable presets on
  every new browser process. Explicit `--configure-extensions` retains that option.
  A backup of the prior launcher is retained beside it.
- Shield navigation interruptions now surface separately from missing installs;
  verification still blocks LinkedIn navigation on failure.
- Kept the existing CDP bootstrap behavior. Experimental unique bootstrap URLs
  exposed Playwright initialization races and were removed before completion.

## Verification

- Two consecutive `allman-jp-browser` runs exited successfully with the same
  existing browser. Shield 3.4.0, runtime hashes, site access, worker response and
  `linkedin_blocklist` passed. No missing extensions or preset mismatches.
- Both runs reported `stateConfigurationApplied: false`; the second read back
  the saved Clutter Free exceptions.
- 67 tests passed across Shield, CDP, browser commands/launcher, Neo adapter,
  query capture and session control. Typecheck passed.
- No extension reinstall, browser restart, account switch or LinkedIn navigation
  was performed. Cold restart persistence remains untested; configuration is saved
  through Chrome's extension storage API in the existing persistent profile.
