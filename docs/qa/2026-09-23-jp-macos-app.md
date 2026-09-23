# BrowserOS JP application wrapper

Installed `/Applications/BrowserOS JP.app` beside the original Neo application.
Its unique bundle ID is `com.allman.browser.jp`; its original vector icon is
purple with white JP initials. No changes were made to Neo's signed app bundle.

## Launch behavior

1. Resolve Bun through mise in the current Allman checkout, clearing inherited
   Allman/Playwright overrides and setting JP's account/profile environment.
2. Run the existing JP opener, now with a structured `--json` result. Reuse the
   saved profile, extension settings, CPU flag and CDP port 9233; verify Shield.
3. Ensure Brian's registered endpoint is available. If closed, reopen the saved
   default BrowserClaw profile in the background at port 9222. A separate launch
   is required because normal macOS app opening otherwise focuses JP's existing
   Neo process, which has the same browser bundle ID.
4. Run `allman session activate jp` through the existing guard, then focus only
   the verified JP PID. Activation errors produce a native alert and private log.

The user explicitly selected activation on app opening. No direct registry edits
or bypass of the single-account guard were used.

## Verified

- Native Swift/AppKit compilation, bundle plist, ad-hoc signature and native
  configuration/environment-isolation self-test passed.
- Finder-style `open` launched the installed app. The initial run cold-started
  JP, verified Shield and correctly stopped when Brian's endpoint was closed.
- Reopened Brian's existing browser; the completed wrapper activated JP and
  requested focus successfully. Registry read-back showed `active: jp`.
- Opening the installed app again reused the same JP browser PID, produced a
  fresh successful launch receipt and left JP active.
- JP process flags include the dedicated saved profile, port 9233, configured
  Shield build and `OnDeviceModelForceCpuBackend`.
- Launch receipt is mode 0600. Icon inspected at full resolution.

## Update and presentation boundaries

Every launch uses the installed Neo executable and current external launcher
scripts. Neo's existing updater remains responsible for downloading browser
updates; a subsequent browser start uses the updated installation. This wrapper
does not install an updater or duplicate Neo. Future compiled wrapper UI changes
require a rebuild.

The launcher has its own name and icon in Finder/Dock. Neo's browser windows
and underlying browser process retain Neo branding. Quitting the launcher does
not quit either browser. No provider data command, invitation or message was sent.

Source/build instructions: `scripts/macos-profile-app/README.md`. Local runtime
receipt: `~/.config/allman/jp/logs/app-launch.json`. Local launcher settings and
browser profile remain outside Git.
