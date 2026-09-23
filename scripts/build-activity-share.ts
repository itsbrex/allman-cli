#!/usr/bin/env bun
// Render an intentional share card. Never screenshot live contacts for previews.
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { bdStackTokens } from "../src/activity/design.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.route("**/*", (route) => route.abort());
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
${bdStackTokens}
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:var(--bg-0);color:var(--txt-1);font:14px var(--sans);padding:48px 58px;background-image:radial-gradient(800px 600px at 95% 0%,#e0a51f12,transparent)}
header,footer{display:flex;align-items:center;justify-content:space-between;font:12px var(--mono);letter-spacing:.1em;color:var(--txt-2)}
.brand{font:24px var(--serif);letter-spacing:0;color:var(--txt-1)}.brand b{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;background:var(--accent);color:var(--bg-0);border-radius:9px;margin-right:10px;font-style:italic}
.chip{border:1px solid var(--accent-line);border-radius:30px;padding:9px 13px;color:var(--accent);font-size:10px}
.eyebrow{margin-top:49px;color:var(--txt-2);font:11px var(--mono);letter-spacing:.16em}
h1{font:58px/1.05 var(--serif);letter-spacing:-1.5px;margin:18px 0 16px}em{font-weight:400;color:var(--accent)}
.sub{font-size:17px;color:var(--txt-2);margin:0}
.features{display:flex;gap:14px;margin-top:35px}.feature{border:1px solid var(--line);background:linear-gradient(135deg,var(--bg-1),var(--bg-0));border-radius:12px;flex:1;padding:20px 21px}.feature span{font:10px var(--mono);color:var(--accent);margin-right:8px}.feature strong{font:20px var(--serif)}.feature p{color:var(--txt-2);font:11px/1.6 var(--mono);margin:10px 0 0}
footer{margin-top:36px;padding-top:20px;border-top:1px solid var(--line);font-size:10px;letter-spacing:.025em}
</style></head><body><header><div class="brand"><b>a</b> allman <span style="color:var(--txt-2);font:11px var(--mono);margin-left:12px">/ ACTIVITY</span></div><div class="chip">PRIVATE · MAC-LOCAL</div></header>
<div class="eyebrow">RELATIONSHIP WORKSPACE · FIELD NOTES</div><h1>Live contact <em>processing.</em></h1><p class="sub">Your network, taking shape. Every person, company, and step.</p>
<div class="features"><div class="feature"><span>01</span><strong>Today</strong><p>Unique people &amp; company totals</p></div><div class="feature"><span>02</span><strong>Local capacity</strong><p>Attempts, limits &amp; coverage</p></div><div class="feature"><span>03</span><strong>Event stream</strong><p>Filter, sort, select &amp; export</p></div></div>
<footer><span>allman-activity.localhost/apps/activity.html</span><span>READ-ONLY OBSERVER · NO CONTACT DATA IN PREVIEW</span></footer></body></html>`);
  await page.screenshot({ path: join(root, "apps/activity-og.png"), animations: "disabled" });
} finally {
  await browser.close();
}
await writeFile(
  join(root, "apps/activity-sms.txt"),
  "Allman live dashboard is ready: https://allman-activity.localhost/apps/activity.html\nDaily totals, quota visibility, and a live event table with filters, sorting, column controls, selection, and CSV export. Opens on this Mac while the local viewer runs; this .localhost link will not open from a phone.\n"
);
console.log("Created apps/activity-og.png (1200×630) and apps/activity-sms.txt.");
