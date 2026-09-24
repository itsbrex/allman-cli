# Browser runtime atlas

Open [the atlas](index.html) to compare 18 browser, runtime, service, and companion candidates. Each has a separate project page with a repository graphic and a checked Archify architecture diagram. A nineteenth diagram explains LinkedIn Shield itself. All project links force the dark theme; the canonical viewers also support light mode.

Use **Live** for a finite animated flow, **Play story** for guided chapters, and **Open full diagram** for the full desktop viewer. Motion illustrates authored relationships; it is not a recording of browser network activity. Purple dashed integration paths describe proposed work. Security relationships may also use dashed styling; read their labels and the status in each title.

## What the evidence supports

BrowserOS neo remains the configured allman default. Neo and bundled Chromium passed local persistent-profile, Shield, blocking, and ownership fixtures in the preceding implementation. This atlas additionally measures their protected startup and an owned synthetic page. No authenticated LinkedIn workflow or comparative detection test was performed.

Viewforge's Chrome path is a plausible adapter project, not a drop-in browser. Its local coordinator, identity workers, journal, and Bun.WebView lifecycle must be mapped to allman's auth/capture contract, and extension installation must be proven. WebKit needs a separately tested extension port. Obscura's partial CDP compatibility does not establish the Chrome MV3 service-worker and DNR environment required by Shield.

Donut Browser is an additional Keep candidate with a documented Chromium engine, profile extensions, local API, and CDP source. CloakBrowser Manager already documents a CDP profile route. Both still need live allman checks before eligibility. OpenCLI, Playwriter, and Agency are companion control/workflow layers, not replacement browser engines.

## Coverage and sources

The starting inventory is [browser-support.md](../browser-support.md). Two authenticated, read-only Keep searches found the saved project links used here. They were lexical searches, not an exhaustive export of the account. Camoufox was already in the support document and is a comparison candidate; this work did not confirm a saved Camoufox Keep item. The BrowserOS upstream and itsbrex fork share one architecture entry. Unrelated results such as tab-stash, video-use, skills, and Fara model tooling were excluded from browser-provider scoring.

| Candidate | Separate page | Primary evidence |
| --- | --- | --- |
| BrowserOS neo | [Diagram and tradeoffs](profiles/browseros-neo.html) | Local allman launcher and fixtures; [BrowserOS](https://github.com/browseros-ai/BrowserOS) |
| BrowserOS | [Diagram and tradeoffs](profiles/browseros.html) | Named executable adapter; separate app untested |
| Bundled Chromium | [Diagram and tradeoffs](profiles/chromium.html) | Local fixtures; [extension support](https://playwright.dev/docs/chrome-extensions) |
| Custom Chromium | [Diagram and tradeoffs](profiles/custom-chromium.html) | Explicit executable/CDP routes in `src/linkedin/auth/browser.ts` |
| CloakBrowser Manager | [Diagram and tradeoffs](profiles/cloakbrowser.html) | [Persistent profiles, CDP, extensions and binary license](https://github.com/CloakHQ/CloakBrowser-Manager) |
| Chrome | [Diagram and tradeoffs](profiles/chrome.html) | [Persistent extension-capable context requirement](https://playwright.dev/docs/chrome-extensions) |
| Edge | [Diagram and tradeoffs](profiles/edge.html) | Same CDP contract; installed version not revalidated |
| Viewforge / Chrome | [Diagram and tradeoffs](profiles/viewforge-chrome.html) | Local `runtime/src/browser.ts`, `docs/architecture.md`; [repository](https://github.com/itsbrex/viewforge) |
| Viewforge / WebKit | [Diagram and tradeoffs](profiles/viewforge-webkit.html) | Same native adapter; backend capability and persistence limits |
| Obscura | [Diagram and tradeoffs](profiles/obscura.html) | [Independent engine and implemented CDP subset](https://github.com/h4ckf0r0day/obscura) |
| invisible_playwright | [Diagram and tradeoffs](profiles/invisible-playwright.html) | [Patched Firefox and Python API](https://github.com/feder-cr/invisible_playwright) |
| Camoufox | [Diagram and tradeoffs](profiles/camoufox.html) | [Firefox/Juggler, addon support and maintenance disclosure](https://github.com/daijro/camoufox) |
| ManagedCode.Playwright.Stealth | [Diagram and tradeoffs](profiles/dotnet-stealth.html) | [.NET init-script wrapper](https://github.com/managedcode/playwright_stealth) |
| Kernel CLI | [Diagram and tradeoffs](profiles/kernel.html) | [CLI profile and extension commands](https://github.com/kernel/cli); [extension docs](https://www.kernel.sh/docs/browsers/extensions) |
| Donut Browser | [Diagram and tradeoffs](profiles/donut.html) | [Profile/extensions overview](https://github.com/zhom/donutbrowser); `src-tauri/src/api_server.rs` at asset-provenance revision |
| OpenCLI | [Diagram and tradeoffs](profiles/opencli.html) | [CLI, local daemon, bridge extension](https://github.com/jackwener/OpenCLI) |
| Playwriter | [Diagram and tradeoffs](profiles/playwriter.html) | [Extension relay and shared browser tabs](https://github.com/remorses/playwriter) |
| Agency | [Diagram and tradeoffs](profiles/agency.html) | [Local cards, active agent, and approval boundaries](https://github.com/browser-use/agency) |
| LinkedIn Shield | [Security mechanics](profiles/shield-security.html) | Local MV3 manifest, content/bridge/worker source, allman exact-build verifier |

CodeDB MCP was used first for allman, Viewforge, and Shield. The allman MCP session returned stale pre-change launcher code even after CLI indexing. A refreshed local CodeDB CLI `context`/`explain` and direct reads established the current implementation. [code-evidence.json](code-evidence.json) records source hashes; uncommitted allman changes are explicitly not attributed to the baseline commit.

## Scoring method

The score is an **author-assessed sales readiness index**, not a success probability, privacy certification, detection score, or benchmark. It ranks how close each candidate is to this user's requirement: durable browser identities, real Shield protection, and working allman integration with predictable custody and operations.

Weights: Shield readiness 30%, allman integration 25%, session durability 20%, local control 15%, operational fit 10%. Each criterion receives an integer grade from 0 to 5; weighted contributions sum to 100. Performance and detectability appear separately because most candidates have no comparable measurements. Inventing numbers for those unknowns would produce misleading rankings.

Shield eligibility is a **hard gate independent of score**. Only Neo and bundled Chromium have passed local checks. A high hypothetical score cannot permit an unverified provider to launch unprotected. Authenticated LinkedIn validation is still absent for every candidate.

| Criterion | Grade anchors |
| --- | --- |
| Shield | 0: incompatible/no runtime; 1: port or lifecycle adapter needed; 2: documented Chromium-extension path without local proof; 5: exact build, rules, access, restart and blocking checks passed. |
| Integration | 0: none; 1: new adapter/bridge required; 2: credible route with protocol/lifecycle work; 3: current allman contract available but candidate untested; 4: local integration verified; 5 reserved for validated authenticated workflow. |
| Durability | 1: storage APIs without lifecycle proof; 2: session state with material ownership gaps; 3: profile/addon mechanisms need allman tests; 4: explicit durable profile/journal architecture; 5: restart/isolation verified locally. |
| Local control | 1: provider holds authenticated state; 3: local shared-session or orchestration trust boundaries; 4: local browser with extra vendor/bridge/update dependencies; 5: directly owned local profile with known custody. This is not an audit of every outbound browser request. |
| Operations | 1: major incompatible backend work; 2: extra runtime, commercial provisioning, remote service, or port; 3: familiar supported machinery requiring setup; 4: current adapter/reproducible install; 5: installed, configured, and locally verified default. |

The exact grades and reasons live in [candidates.json](candidates.json). Neo scores 95 and Chromium 93 primarily because Neo is already configured. The small difference is not evidence that Neo is faster or less detectable. Viewforge's 46 reflects promising persistence and local control but an absent allman/Shield adapter. Obscura's 25 reflects its current incompatibility with the mandatory extension contract, not a judgment of its value for unrelated public-page extraction.

## Performance sample

| Metric | BrowserOS neo median (range) | Bundled Chromium median (range) |
| --- | --- | --- |
| Protected startup | 1,434 ms (1,291–1,861) | 1,293 ms (1,066–3,634) |
| Synthetic page navigation | 129 ms (104–131) | 108 ms (88–128) |
| Summed browser-process RSS | 1,137 MiB (1,136–1,137) | 1,011 MiB (1,009–1,016) |

Method: three fresh owned profiles per engine, alternating order, headed=false, Bun 1.3.14, macOS arm64. The timer starts before allman's persistent launcher and ends after exact Shield verification. A locally fulfilled page executes a small DOM mutation; no LinkedIn request is made. RSS sums the owned browser process and descendants after the fixture loads. Every profile is closed and removed after its sample. See [benchmarks.json](benchmarks.json) for raw observations and method text.

RSS may double-count shared memory and is not PSS or physical footprint. Host load was not controlled; the first Chromium launch is an outlier. Three observations cannot establish statistical significance or production throughput. The fixture is a small HTML document, not a rendered 500-row workload (its label/data attribute says 500). BrowserOS's extra processes affect the observed total. No separate extension overhead measurement was made.

Obscura's 30 MB / 51–84 ms and Camoufox's approximate 200 MB figures are labeled **vendor claims** in the atlas. Their workloads and measurement methods differ from this sample; they are excluded from the comparison chart. No anti-detection claim was independently verified.

## Graphics and verification

All displayed project graphics come from actual repository files, copied without alteration and embedded in the project pages. [asset-provenance.json](asset-provenance.json) records source URL/path, commit, hash, bytes, and repository license metadata. BrowserOS/Neo have distinct assets; Chrome's mark comes from BrowserOS's repository; Edge uses its official DevTools repository screenshot. Viewforge's larger image is its owned fixture screenshot, not a screenshot of the control-plane UI. Assets and names remain their owners' property; this atlas is an attributed technical comparison, not an endorsement.

Each canonical diagram was atomically delivered through Archify with 9/9 showcase checks and zero composition errors/warnings. Automated screenshots cover 1440×900, 1600×1000, 1920×1080 and 2048×1320, plus both themes at the smallest/largest sizes. The separate manual review inspected dark/light compositions, labels, cards, and connector corridors. Archify's own visual receipts correctly retain `visualReview: pending`; manual inspection is recorded separately in [verification.json](verification.json) and [DELIVERY.md](DELIVERY.md).

The gallery was exercised using an owned Neo profile with Shield 3.4.0 verified. Every candidate selection displayed its image and dark diagram; project-page navigation worked; index widths 320–2048 and inline widths 320–1024 had no horizontal overflow. Inline selection, finite animation and reduced-motion behavior passed with no page errors. The low-contrast hook finding was fixed by supplying the requested dark surface behind light text; no warning was suppressed or left unresolved.

Project images are embedded, but Archify may request optional Google Fonts when opened; its system-font fallback works with network requests blocked. The inline preview host also references its standard allowed-CDN helpers. Verification blocked all such requests and still passed core rendering and interactions. No application source or saved browser configuration changed during atlas creation.

## Files

- `index.html`: interactive atlas and benchmark comparison.
- `profiles/*.html`: separate project pages with embedded repository graphics.
- `diagrams/*.html`: immutable checked Archify diagrams; append `?theme=dark`.
- `specs/*.final.json`: frozen authored architecture specifications.
- `receipts/*.delivery.json`: specification/artifact SHA-256 and byte receipts.
- `diagrams/*.visual-check.*`: automated viewport receipts and screenshots.
- `browser-readiness.html`: inline Visualize comparison fragment.
- `candidates.json`, `benchmarks.json`, `asset-provenance.json`, `code-evidence.json`: evidence and scoring data.

To revise a diagram, author a new candidate revision, validate it, then use Archify `deliver`. Do not patch checked HTML in place; that would invalidate its receipt. Changes to scores or graphics also require rebuilding the embedded project-page data.
