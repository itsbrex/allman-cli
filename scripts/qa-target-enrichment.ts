#!/usr/bin/env bun
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { targetReviewHtml } from "../src/attio/review-html.ts";

import { artifactDirectory } from "./artifact-directory.ts";

const dir = await artifactDirectory("enrichment-qa");
const unsafe = "</script><script>globalThis.injected=true</script>";
const report = {
  version: 1,
  account: "synthetic",
  accountName: "QA Account",
  runId: "qa",
  list: { id: "list", name: "QA Companies" },
  observedAt: "2026-09-23T00:00:00Z",
  summary: {
    companies: 1,
    attioPeople: 3,
    selected: 1,
    saved: 1,
    employerReview: 1,
    duplicateAttioRecords: 0,
    missingIdentity: 1,
    notInAccount: 1,
    additionalHints: 1,
    nameReviewCandidates: 0,
  },
  profiles: [
    {
      flagshipId: "one",
      name: unsafe,
      expectedCompanies: ["Expected"],
      currentCompanies: ["Actual"],
      employer: "employer-review",
      saved: true,
      enrichedAt: "2026-09-23",
      linkedinUrl: "javascript:alert(1)",
      email: "review@example.test",
      title: "VP",
      about: unsafe,
      location: "Test",
      methods: ["flagship-id"],
      personIds: ["p1"],
      positions: Array.from({ length: 16 }, (_, i) => ({
        title: "Senior Director of Strategy and Long Range Workplace Planning",
        company: "International Company With a Long Name",
        startDate: `${2024 - i}-04`,
        endDate: i ? `${2025 - i}-04` : null,
        current: i === 0,
      })),
      education: [{ school: "Example University", degree: "MBA", startDate: "2001", endDate: "2003" }],
      skills: Array.from({ length: 30 }, (_, i) => `Planning specialty ${i + 1}`),
    },
  ],
  unmatched: [
    { personId: "p2", name: "=FORMULA", companies: ["Target"], outcome: "missing-identity" },
    { personId: "p3", name: "Other Person", companies: ["Target"], outcome: "not-in-account" },
  ],
  hints: [
    {
      flagshipId: "hint",
      name: "Potential Person",
      companies: ["Target"],
      headline: "Candidate only",
      reason: "headline-only",
    },
  ],
  companies: [
    {
      id: "co",
      name: "Expected",
      domains: ["example.invalid"],
      urls: [],
      linkedinIds: [],
      attioPeople: 3,
      selected: 1,
      saved: 1,
    },
  ],
} as unknown as Parameters<typeof targetReviewHtml>[0];
const file = join(dir, "review.html");
await writeFile(file, targetReviewHtml(report));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith("file:") ? route.continue() : route.abort()
  );
  await page.goto(pathToFileURL(file).href);
  assert.equal(await page.locator("#body tr[data-i]").count(), 1);
  await page.locator('#statchips [data-stat="all"]').click();
  assert.equal(await page.locator("#body tr[data-i]").count(), 5);
  assert.equal(
    await page.evaluate(() => (globalThis as { injected?: boolean }).injected),
    undefined
  );
  await page.locator('#statchips [data-stat="employer"]').click();
  assert.equal(await page.locator("#body tr[data-i]").count(), 1);
  await page.locator("#body [data-evidence]").first().click();
  assert.equal(await page.locator("#dname").textContent(), unsafe);
  assert.equal(await page.locator('#ddb a[href^="javascript:"]').count(), 0);
  assert.equal(await page.locator("#body td:not(:has(a))").count(), 0);
  const compose = await page.locator("#draft-email").getAttribute("href");
  assert(compose?.startsWith("mailto:review%40example.test?subject="));
  assert(decodeURIComponent(compose).includes("workplace plans"));
  await page.locator(".outreach-editor summary").click();
  await page.locator("#draft-recipient").fill("invalid@example.test,other@example.test");
  assert.equal(await page.locator("#draft-email").getAttribute("href"), null);
  await page.locator("#draft-recipient").fill("review@example.test");
  await page.locator("#draft-body").press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "copy-draft");
  await page.locator("#drawer a[href]").last().press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "dx");
  await page.locator(".outreach-editor summary").click();
  await page.locator("#review-notes summary").click();
  await page.locator("#decision-note").fill("Synthetic review note");
  await page.locator('[data-decision="investigate"]').click();
  await page.locator("#dx").click();
  await page.reload();
  await page.locator("#body [data-evidence]").first().click();
  await page.locator("#review-notes summary").click();
  assert.equal(await page.locator("#decision-note").inputValue(), "Synthetic review note");
  assert.equal(await page.locator("#decision-status").textContent(), "Saved locally · investigate");
  await page.locator("#clear-decision").click();
  assert.equal(await page.locator("#decision-note").inputValue(), "Synthetic review note");
  assert.equal(await page.locator('[data-decision="investigate"]').getAttribute("aria-pressed"), "false");
  await page.locator("#dx").click();
  await page.locator('#statchips [data-stat="unmatched"]').click();
  assert.equal(await page.locator("#body tr[data-i]").count(), 2);
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".report-tools > summary").click();
  await page.locator("#export-csv").click();
  const download = await downloadPromise;
  const csv = await Bun.file((await download.path()) as string).text();
  assert(csv.includes("'=FORMULA"));
  await page.locator("#cmdopen").click();
  await page.locator("#cbq").fill("Theme: Cresa");
  await page.keyboard.press("Escape");
  await page.locator(".report-tools > summary").click();
  await page.locator('#statchips [data-stat="all"]').click();
  await page.locator("#body [data-evidence]").first().click();
  const viewports = [[320, 740], [390, 844], [768, 1024], [844, 390], [1386, 878], [1920, 1080], [2560, 1440], [5120, 2800]];
  const layouts = [];
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await page.locator("#ddb").evaluate(el => el.scrollTop = el.scrollHeight);
    await page.waitForTimeout(250);
    const layout = await page.evaluate(() => {
      const button = document.querySelector('[data-decision="verified"]')!.getBoundingClientRect();
      const panel = document.querySelector("#drawer")!.getBoundingClientRect();
      const scroller = document.querySelector("#ddb")!.getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1,
        button: { top: button.top, bottom: button.bottom, height: button.height, width: button.width }, panelWidth: panel.width, contentHeight: scroller.height };
    });
    assert(!layout.overflow, `page overflow at ${width}`);
    assert(layout.button.top >= 0 && layout.button.bottom <= height, `decision hidden at ${width}×${height}`);
    assert(layout.button.height >= 44 && layout.button.width >= 44);
    assert(layout.contentHeight >= 80, `evidence scroll area collapsed at ${width}×${height}`);
    if (width >= 1920) assert(layout.panelWidth >= 800);
    layouts.push(layout);
    if ([390, 1386, 5120].includes(width)) await page.screenshot({ path: join(dir, `drawer-${width}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#review-next").click();
  assert.equal(await page.locator("#ddb").evaluate(el => el.scrollTop), 0);
  assert((await page.locator("#draft-email").getAttribute("href"))?.startsWith("mailto:?subject="));
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("main").getAttribute("inert"), null);
  const tableWidth = await page.locator("#records table").evaluate(el => el.getBoundingClientRect().width);
  assert(tableWidth <= 390, "mobile table did not reflow");
  await page.screenshot({ path: join(dir, "mobile.png"), fullPage: true });
  // Invalid import must preserve the currently visible report.
  const count = await page.locator("#body tr[data-i]").count();
  await page.locator("#report-import").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...report, profiles: [{ name: "broken" }] })) });
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#body tr[data-i]").count(), count);
  // Storage denial must leave the UI usable and decisions exportable in memory.
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); }; });
  await page.locator("#body [data-evidence]").first().click();
  await page.locator('[data-decision="verified"]').click();
  assert.equal(await page.locator("#decision-status").getAttribute("data-error"), "true");
  assert((await page.locator("#decision-status").textContent())?.includes("Export decisions"));
  await page.locator("#review-next").click();
  await page.locator("#review-prev").click();
  assert.equal(await page.locator('[data-decision="verified"]').getAttribute("aria-pressed"), "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.locator("#drawer").evaluate(el => getComputedStyle(el).transitionDuration), "0s");
  assert.deepEqual(errors, []);
  await writeFile(
    join(dir, "result.json"),
    JSON.stringify({ passed: true, errors, layouts, checkedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 }
  );
  console.log(
    "Review QA passed: 8 viewport sizes, persistent decisions, keyboard focus, safe email drafts, note persistence, reset, navigation, invalid imports, storage denial, CSV and reduced motion."
  );
} finally {
  await browser.close();
  console.log(`QA artifacts retained: ${dir}`);
}
