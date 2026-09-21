# Persistent browsers and LinkedIn Shield

All browser flows require LinkedIn Shield. The CLI verifies its installed runtime and enabled blocking rules before opening LinkedIn. A failed check stops the operation. There is no unprotected or ephemeral fallback.

## Configure once

Build the extension with its own `npm run build`, then select the runtime-only `dist/` directory:

```sh
allman browser configure --browser browseros-neo --shield /absolute/path/to/linkedin-shield/dist
allman browser doctor --json
allman login
```

Configuration lives in `~/.allman/browser-workspace/config.json`, mode `0600`. Profiles live under that workspace and survive process exits, repository changes, and running commands from another directory. `ALLMAN_BROWSER_WORKSPACE` selects another workspace. The Shield build path is saved and reloaded on every launch; keep that directory available. Browser-generated `_metadata` and unrelated repository files are excluded from verification.

This workspace holds browser identities. The message/account store follows `--store` / `ALLMAN_STORE` / saved selection / `./.allman`. Use `allman store use /absolute/path/to/.allman` to select an existing populated store across working directories; the absolute path is saved privately under `$XDG_CONFIG_HOME/allman/default-store.json` (normally `~/.config/allman/default-store.json`). No account data is migrated. Browser sign-in alone does not save CLI cookies: run `allman login` to authorize that local export.

Configuration is saved only after successful live verification. Flags override environment settings, which override saved settings. A higher-priority browser/CDP/executable choice replaces lower-priority transport choices. Explicit choices never silently fall back.

Login and query-ID capture share the browser/Shield settings. Capture uses a separate persistent profile for each account so injecting its cookies cannot replace a login profile's account. `--account` selects the login identity. An explicit `--profile` selects the login directory; capture uses a separate subdirectory. Browser profile locks are reported rather than retried in another browser.

## Browser support

Research checked against local source and primary project documentation on 2026-09-18. Saved Keep results included Obscura, CloakBrowser Manager, invisible_playwright, managedcode/playwright_stealth, and Kernel CLI. These are candidates, not interchangeable browser engines.

| Browser or runtime | Integration and current boundary |
| --- | --- |
| BrowserOS neo | Named macOS executable adapter. Dedicated allman profile. Neo 0.50.5 / Chromium 151 passed live persistence, blocking, and Node CDP ownership checks with Shield 3.4.0. [Source](https://github.com/browseros-ai/BrowserOS). |
| BrowserOS | Named macOS executable adapter using the same Chromium path. Must pass the same checks; separate from Neo. |
| Bundled Chromium | Full `chromium` channel supports extensions in headed and headless persistent contexts. Bundled Chromium 147 passed the same live checks. Run `allman install-browsers` first if absent. [Playwright](https://playwright.dev/docs/chrome-extensions). |
| Custom Chromium / CloakBrowser Manager | Explicit executable or existing CDP endpoint. Manager documents persistent profiles, unpacked extensions, and CDP. No vendor library is needed for the CDP route. License/setup and a live Shield check remain prerequisites; no license is purchased here. [Manager documentation](https://github.com/CloakHQ/CloakBrowser-Manager). |
| Chrome / Edge | Existing CDP profile with Shield installed is the supported route. Current branded builds removed command-line extension sideloading; `--load-extension` alone is insufficient. A failed Shield check blocks use. [Playwright extension guidance](https://playwright.dev/docs/chrome-extensions). |
| Viewforge | Local runtime is Bun.WebView with Chrome/WebKit backends and its own profile/lifecycle API. It is not a Playwright BrowserContext or CDP server. Chrome argv support offers a possible bridge, but Shield installation and API compatibility need a dedicated adapter/test. WebKit cannot run this Chromium MV3 build unchanged. Not selected automatically. Local files: `runtime/src/browser.ts`, `runtime/src/contracts.ts`, `docs/architecture.md` in the Viewforge repository. |
| Obscura | Independent Rust/V8 browser implementing portions of CDP. Primary docs do not establish Chrome MV3/service-worker/DNR extension support. Its built-in tracker blocking does not satisfy the requirement to run Shield itself. Not enabled. [Source](https://github.com/h4ckf0r0day/obscura). |
| invisible_playwright / Camoufox | Firefox-family approaches. They require a Firefox adapter and a tested extension port; they cannot use the current Chromium CDP/Shield integration unchanged. [invisible_playwright](https://github.com/feder-cr/invisible_playwright). |
| managedcode/playwright_stealth / Kernel CLI | .NET wrapper or separate browser service tooling, respectively. Neither is needed for the local Neo integration. A remote browser would also change where authenticated data lives. [Wrapper](https://github.com/managedcode/playwright_stealth), [Kernel](https://github.com/kernel/cli). |

No detection-evasion guarantees are made. Browser compatibility tests do not establish authenticated LinkedIn behavior or protection against every tracker. Shield affects browser pages; allman's direct HTTP API calls remain outside extension coverage.

## Existing browsers and CDP

Two independent initialization failures were reproduced on 2026-09-21:

1. Playwright auto-attaches every existing page. Discarded Neo tabs have no renderer and never answer `Page.enable`, `Page.getFrameTree`, or `Runtime.enable`. A clean isolated Neo profile attached in 256 ms; discarding one owned tab reproduced the timeout. Allman now routes CDP through a local relay that attaches only tabs it creates, leaving existing tabs and their discarded state unchanged. Page-scoped frame/worker attachment remains enabled. The relay cannot close the borrowed browser.
2. Bun 1.3.14 has a separate Playwright WebSocket transport failure, consistent with [Bun issue 32526](https://github.com/oven-sh/bun/issues/32526). Bun 1.4.2 and Node 20.20.1 passed live checks; the native executable compiled with Bun 1.4.2 also passed. `.tool-versions` pins the working Bun version. Older Bun versions now fail before connecting with a runtime-specific error.

Use the pinned Bun runtime or the Node entry. The latter requires this checkout's installed dependencies and is not a standalone binary:

```sh
bun run build:node
node dist/allman-node.mjs browser doctor --json
```

For Neo, start the browser with its native CDP flag, then configure the already installed Shield build:

```sh
open -a 'BrowserOS neo' --args --browseros-cdp-port=9222 --enable-features=OnDeviceModelForceCpuBackend
allman browser configure --cdp http://127.0.0.1:9222 --shield /absolute/path/to/linkedin-shield/.dev-build
allman browser doctor --json
```

Startup arguments only take effect when the browser starts. If Neo is already running without that flag, quit it normally before reopening. `[DEV] LinkedIn Shield` and production builds both pass the same runtime hash and blocking-rule verification. Attachment failures retain the underlying Playwright error and cause.

Install the configured unpacked Shield build in the persistent target profile before attaching. For example, with a CloakBrowser Manager profile whose extension settings already include that directory:

```sh
node dist/allman-node.mjs browser configure --cdp http://127.0.0.1:8080/api/profiles/PROFILE_ID/cdp --shield /absolute/path/to/linkedin-shield/dist
node dist/allman-node.mjs browser doctor --json
node dist/allman-node.mjs login
```

A missing default context, missing Shield, disabled rules, unavailable host permission, or mismatched build prevents use. CDP disconnection leaves the browser running. The CLI closes only its own verification/login/capture tabs and does not inject stored cookies into the borrowed context. Query-ID capture also compares the attached LinkedIn session with the account's stored session without printing either cookie value.

For an allman-owned persistent browser, the Shield package is checked before launch and loaded through Chromium's startup extension flag. Live verification must then pass before stored cookies are injected or LinkedIn is opened. This gate runs for every acquisition, including query-ID refresh. Saved cookies accept only `linkedin.com` and its subdomains and use a Git-ignored `0600` file; re-login preserves existing account metadata and rejects a different selected account. These guarantees cover CLI-controlled activity, not tabs already running before attachment or later manual changes to the browser's extension settings.

For Chrome 136+, remote debugging requires a non-default `--user-data-dir`. Never point allman at a daily browser's live profile directory. Use a dedicated profile or attach to an already-running browser. Chromium extensions still need installation in that exact profile.

## Import connections through Neo MCP

An authenticated Neo session can populate a local store without exporting browser cookies. This route uses Neo's local MCP server and does not require Playwright CDP attachment:

```sh
allman connections --browseros-mcp http://127.0.0.1:9010/mcp \
  --store /absolute/path/to/.allman --limit 25 --include-headline
```

An empty store gets an account record for the verified browser owner. Existing stores use the selected/default account and reject a different browser identity before fetching connections. New account records remain `unauthenticated` for direct HTTP commands because no `COOKIES.json` is written. Existing auth records are preserved.

Each call fetches one bounded batch: default 25, maximum 100. `--start` selects the offset. A full batch is explicitly partial and reports the next offset; reaching the end after a nonzero offset does not claim a complete network export. `--json` emits NDJSON without store writes; `--no-save` reports counts without persisting. MCP mode does not support CSV, enrichment, Sales Navigator, or local geo filtering in the same command.

The adapter verifies Shield before opening LinkedIn, uses GET requests only, closes its own tabs, and keeps cookies and CSRF values inside the browser. Large Neo evaluation results are read from its local `~/.browseros/tool-output` directory with path, size, and content-marker validation. Missing records or malformed results stop the import. The MCP endpoint must be local loopback HTTP.

## Upstream speed comparison (2026-09-21)

The reference is upstream commit [`d19fb68`](https://github.com/tarkaai/allman-cli/tree/d19fb681c0b33116f8e9f8dad1ab23e900fb9d4f) and its latest published prerelease, [`2026-08-18.1-alpha`](https://github.com/tarkaai/allman-cli/releases/tag/2026-08-18.1-alpha). The official macOS arm64 binary was downloaded separately and verified against its published SHA-256 sidecar; it did not replace the installed launcher.

Ordinary `connections` commands use direct HTTP with saved cookies in both versions. The default page size is 100 and the deliberate delay between pages remains 2–8 seconds (mean 5 seconds). Browser/Shield checks do not run once per API page. A default complete sweep of exactly 1,000 connections needs 10 data pages and an empty terminal page: pacing alone is 20–80 seconds (mean 50), plus requests and local writes. For exactly 5,000, pacing alone is 100–400 seconds (mean 250). An explicit matching `--limit` skips the terminal page. These estimates exclude enrichment, retries, login, and rate limiting. [Upstream pagination](https://github.com/tarkaai/allman-cli/blob/d19fb681c0b33116f8e9f8dad1ab23e900fb9d4f/src/commands/connections.ts), [delay defaults](https://github.com/tarkaai/allman-cli/blob/d19fb681c0b33116f8e9f8dad1ab23e900fb9d4f/src/utils/random-delay.ts).

Successful local observations, not a controlled speed ratio:

| Operation | Elapsed |
| --- | ---: |
| Official upstream binary, direct API, 25 records as JSON | 4.786 s |
| Current source CLI, same account and 25-record API read | 0.899 s; 0.669 s after re-login |
| Current source CLI, Neo MCP import of the next 25 records | 7.722 s |
| Current compiled CLI, local browser/Shield doctor | 5.794 s |

The MCP route adds extension verification, browser-page setup, owner validation, and local import work. Its timing is not evidence that ordinary CLI reads became slower. A later compiled API attempt timed out after 45 seconds; subsequent source and upstream reads both reported an expired session, and Neo also showed its sign-in page. A sustained paired benchmark could not be completed. Protected re-login restored the session, and the source CLI read 25 records successfully in 0.669 seconds. Synthetic loopback HTTP success and authentication-error responses passed through both source and compiled clients. No fixed speed multiplier or uninterrupted live-session guarantee is established.

## Validation

533 unit tests passed after integrating the relationship workspace; typecheck, Biome, native and Node builds, and the CodeDB refresh gate passed. An installer test exceeded its timeout during a concurrent full-build run; it passed in isolation and in subsequent complete runs. Login regressions cover Shield verification before cookie access/navigation, rejection when verification fails, no cookie injection into attached browsers, exact cookie-domain filtering, private cookie permissions, account mismatch, and metadata preservation.

The linked development CLI and compiled executable passed `browser doctor --json` using saved defaults. The compiled MCP command read a 25-record batch successfully with `--no-save`; the source CLI imported two bounded batches totaling 50 connections. Authenticated CLI login and direct HTTP reads also passed after explicit local-cookie authorization. The private cookie file was verified as `0600` and Git-ignored.

The isolated smoke test uses synthetic cookies and locally fulfilled pages. Neo 0.50.5 / Chromium 151 and bundled Chromium 147 passed persistence, actual Shield blocking, discarded-tab preservation, owned-tab cleanup, and rejection of disabled blocking rules. Live CDP doctor checks passed against the existing Neo profile. Full-network coverage and authenticated query-ID capture remain unverified; the successful login reused an existing authenticated session and did not exercise a fresh 2FA challenge.

`bun run test` covers configuration precedence, persistent profile selection, fail-closed extension checks, ownership cleanup, and capture account isolation. `allman browser doctor --json` performs a live local check without visiting LinkedIn. BrowserOS neo MCP connectivity is separate from the local executable adapter; a disconnected cockpit does not establish that its existing profile is usable over MCP.

The opt-in smoke test launches only owned profiles with synthetic cookies and locally fulfilled fixture pages. It checks restarts, content-script blocking, actual DNR script blocking, an allowed-script control, CDP disconnect ownership, discarded tabs, and rejection of disabled rules:

```sh
bun build scripts/browser-smoke.ts --target=node --packages=external --outfile=.cache/browser-smoke.mjs
node .cache/browser-smoke.mjs browseros-neo
node .cache/browser-smoke.mjs chromium
```
