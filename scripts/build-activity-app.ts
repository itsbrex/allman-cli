#!/usr/bin/env bun
// Keep the Appkit shell project-owned while embedding the same dashboard as the CLI.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { activityStyles, bdStackTokens } from "../src/activity/design.ts";
import { activityHtml, activityScript } from "../src/activity/view.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "apps/activity.html");
const liveUrl = "https://allman-activity.localhost/apps/activity.html";
const description =
  "Follow local contact processing, daily totals, capacity and every event. Private, read-only activity on your Mac.";
const marker = (name: string, value: string) =>
  `<!-- allman:${name}:start -->\n${value}\n<!-- allman:${name}:end -->`;

export function renderActivityApp(shell: string): string {
  const styles = `<style>
:root{--bg-0:var(--bg);--txt-1:var(--txt);--accent-line:color-mix(in srgb,var(--accent) 40%,var(--line));--ok-soft:color-mix(in srgb,var(--ok) 12%,var(--bg));--wip:var(--info);--wip-soft:color-mix(in srgb,var(--info) 12%,var(--bg));--crit:var(--err);--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--serif:"Iowan Old Style",Georgia,"Times New Roman",serif;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,sans-serif;--radius-sm:7px;--radius-md:12px;--radius-lg:16px;--shadow:0 18px 40px rgba(0,0,0,.5);--ease:180ms ease}
${bdStackTokens.replace(":root{", ":root[data-theme=bd-stack]{--bg:var(--bg-0);--txt:var(--txt-1);")}
${activityStyles.replace(bdStackTokens, "")}
header.masthead{margin-bottom:0}
.wrap{padding-top:0;padding-bottom:0}.wrap.content{padding-top:32px;padding-bottom:38px}
.shell-actions{display:flex;align-items:center;gap:8px}.shell-actions .button{font:10px var(--mono)}
.local-note{padding:12px 17px;color:var(--txt-2);font:11px/1.7 var(--mono);border-bottom:1px solid var(--line);text-align:center}
[data-theme=paper] .badge.saved,[data-theme=paper] .badge.finished{color:#3e6126;background:#e5eedf}
[data-motion=reduced] *,[data-motion=reduced] *::before,[data-motion=reduced] *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
@media(max-width:740px){.wrap.content{padding-top:25px}.masthead{gap:12px}.header-right{flex-wrap:wrap;justify-content:flex-end}.shell-actions .button{padding:7px}}
</style>`;
  const body = activityHtml.split("<body>\n")[1]?.split("<script>")[0];
  if (!body) throw new Error("Dashboard body is missing");
  const dashboard =
    body.replace(
      '<div class="header-right">',
      `<div class="header-right"><div class="shell-actions"><button type="button" class="button" id="cmdopen" aria-label="Open command bar" title="Commands (⌘K)">⌘K</button><button type="button" class="button" id="helpLink" aria-label="Keyboard shortcuts">?</button></div>`
    ) +
    `<p class="local-note" id="local-note" hidden>Live activity is available on this Mac while the viewer runs. <a href="${liveUrl}">Open live dashboard ↗</a></p>`;
  const script = activityScript.replace(
    "function connect() {",
    `function connect() {
  if (location.hostname === 'allman-cli.localhost') { location.replace('${liveUrl}'); return; }
  const local = /^(127\\.0\\.0\\.1|localhost)$/.test(location.hostname) || location.hostname === 'allman-activity.localhost';
  if (!local) { connection('Local viewer required','offline'); $('local-note').hidden=false; text('stage-caption','Open the live dashboard on your Mac to see local activity.'); return; }`
  );
  const runtime = `<script>
const APP_SHORTCUTS = [['/', 'Search events'], ['p', 'Pause / resume view'], ['c', 'Column settings'], ['e', 'Export CSV']];
function appCommands(add){
  add('Activity','⌕','Search events',()=>$('search').focus(),{kbd:'/'});
  add('Activity','Ⅱ','Pause / resume view',()=>$('pause-view').click(),{kbd:'p'});
  add('Activity','▥','Column settings',()=>$('configure-columns').click(),{kbd:'c'});
  add('Activity','↓','Export CSV',()=>$('export-csv').click(),{kbd:'e'});
  add('Activity','↺','Clear filters',()=>$('clear-filters').click());
}
function appKeydown(e){
  const ids={'/':'search',p:'pause-view',c:'configure-columns',e:'export-csv'};
  const id=ids[e.key];if(!id)return;e.preventDefault();id==='search'?$(id).focus():$(id).click();
}
applyTheme(st.theme);
$('cmdopen').onclick=cbOpen;$('helpLink').onclick=showHelp;
$('dx').onclick=closeSheet;$('scrim').onclick=closeSheet;
(() => {
${script}
})();
</script>`;
  const metadata = `<meta property="og:type" content="website">
<meta property="og:title" content="Allman · Live contact processing">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${liveUrl}">
<meta property="og:image" content="https://allman-activity.localhost/apps/activity-og.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Allman live contact processing. Local totals, capacity and event stream. Mac-local observer.">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${liveUrl}">`;
  let result = shell;
  for (const [name, value] of Object.entries({ styles, dashboard, runtime, metadata })) {
    const start = `<!-- allman:${name}:start -->`,
      end = `<!-- allman:${name}:end -->`;
    const from = result.indexOf(start),
      to = result.indexOf(end);
    if (from < 0 || to < from) throw new Error(`Missing activity artifact region: ${name}`);
    result = result.slice(0, from) + marker(name, value) + result.slice(to + end.length);
  }
  return result;
}

async function build() {
  let shell = await readFile(target, "utf8");
  if (!shell.includes("<!-- allman:dashboard:start -->")) {
    const lock = JSON.parse(await readFile(join(root, ".appkit/lock.json"), "utf8"));
    const expected = lock.apps?.["apps/activity.html"];
    if (
      expected?.recipe !== "workspace" ||
      createHash("sha256").update(shell).digest("hex") !== expected.generatedSha
    )
      throw new Error("Expected the untouched workspace scaffold from bun run plans app activity");
    // Preserve shared parts and provenance; replace only the starter workspace.
    shell = shell.replace(/\/\* ---- app-shell layout:[\s\S]*?<\/style>/, "</style>");
    const bodyStart = shell.indexOf("<body>") + "<body>".length;
    const chromeStart = shell.indexOf('<div class="scrim"');
    if (chromeStart < bodyStart) throw new Error("Appkit chrome is missing");
    shell =
      shell.slice(0, bodyStart) + "\n" + marker("dashboard", "") + "\n" + shell.slice(chromeStart);
    const moduleComment = shell.lastIndexOf("/* ═", shell.indexOf("APP MODULE"));
    if (moduleComment < 0) throw new Error("Appkit app module is missing");
    shell =
      shell.slice(0, moduleComment) + "</script>\n" + marker("runtime", "") + "\n</body></html>\n";
    shell = shell.replace(
      "</head>",
      marker("styles", "") + "\n" + marker("metadata", "") + "\n</head>"
    );
    shell = shell.replace("single-file app skeleton", "private local activity dashboard");
    shell = shell.replace("theme: 'auto'", "theme: 'bd-stack'");
    shell = shell.replace("const THEMES=[", "const THEMES=[['bd-stack','BD Stack'],");
    shell = shell.replace(
      "document.addEventListener('keydown', e => {",
      "document.addEventListener('keydown', e => {\n  if(document.querySelector('#columns-dialog[open]'))return;"
    );
  }
  const result = renderActivityApp(shell);
  if (process.argv.includes("--check")) {
    if (result !== (await readFile(target, "utf8")))
      throw new Error("Activity artifact is stale; run bun run activity:build");
    console.log("Activity artifact matches dashboard source.");
  } else {
    await writeFile(target, result);
    console.log(target);
  }
}
if (import.meta.main) await build();
