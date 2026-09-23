# JP Dock identity and fixed CDP ports

## Result

The installed `/Applications/BrowserOS JP.app` is now an accessory launcher.
The actual JP browser runs from a branded APFS copy with bundle ID
`com.allman.browser.jp.engine`. The running browser's icon was read through
NSRunningApplication and visually verified as the purple JP icon. macOS Dock
accessibility returned exactly one `BrowserOS neo` and one `BrowserOS JP` item.
The launcher itself has activation policy 1 (accessory); both browsers have
policy 0 (regular).

Neo's `CFBundleIconName=AppIcon` originally overrode the custom icon file. The
copy now removes that asset-catalog override as well as changing its icon/name.
The source Neo application is unchanged and its deep code-signature verification
passes. The locally branded engine and launcher pass strict deep verification.

## Launch and profile verification

At 2026-09-23T21:18:18Z, the launcher receipt recorded:

- JP browser PID 92719, endpoint `http://127.0.0.1:9223`.
- `browserBundleIdentifier: com.allman.browser.jp.engine`.
- `launcherAccessory: true`, `shieldVerified: true`, `activatedProfile: jp`.
- Native focus request succeeded.

Brian's saved browser PID 76379 listened on 9222. JP listened on 9223; the old
9233 endpoint was closed. Both launches explicitly include
`--remote-debugging-port` and `--browseros-cdp-port` with their fixed account port.
JP's private launcher, extension verifier, browser workspace and shared session
registry were migrated together from 9233 to 9223, with backups of prior config.
The helper rejects a verified-browser response for a different JP endpoint.

Brian's Clutter Free extension also removed verification tabs. Narrow exceptions
for `about:blank` and the three relevant extension pages were appended through
its storage API; its effective allow-list mode and existing entries were retained.
Prior settings were saved privately for rollback. Brian's Shield and enforced
LinkedIn pause passed before JP activation. The guarded Allman switch then passed
and the registry read back `active: jp`; no guard was bypassed.

The first JP graceful quit saved `profile.exit_type: Normal` and closed CDP but
left PID 99414 stuck in shutdown. After explicit user approval, only that exact
verified JP process was force-quit. The saved profile was reopened with session
restoration; no profile, cookie or extension data was reset. Cold-start readiness
now allows up to 120 seconds to cover signature verification and browser startup.

## Update behavior and limits

The source installation retains its normal updater. The generated engine disables
its own updater and refreshes from the installed source on a later cold launch.
The source/build fingerprint includes the executable, signature resources, plist,
local bridge, icon and preparation script. An actual new vendor release was not
installed during this check. The app is locally ad-hoc signed, not notarized.

A pinned generated-app icon routes cold opening through JPBridge back to the
launcher. While the helper runs, focusing JP requests guarded account activation
when necessary. Original Neo launched directly still follows its own launch
behavior; fixed Brian flags are supplied when the JP launcher opens its companion.
Internal Chromium helper process names can still contain BrowserOS neo.

## Checks

- Native optimized Swift build and installed `--self-test`: pass.
- Python engine tests: 2 pass (branding/update fingerprint contracts).
- Private launcher Python compilation and shell syntax: pass.
- Original source deep signature, generated engine/helper strict signatures: pass.
- Installed browser runtime, Dock names, running icon and guarded activation: pass.
- CodeDB refresh probe: pass.

Temporary disposable browser prototypes were removed after confirming no test
browser process remained. Unrelated repository changes were left intact.
