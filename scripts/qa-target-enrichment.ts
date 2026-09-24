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
      title: "VP",
      about: unsafe,
      location: "Test",
      methods: ["flagship-id"],
      personIds: ["p1"],
      positions: [],
      education: [],
      skills: [],
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
  await page.locator("#decision-note").fill("Synthetic review note");
  await page.locator('[data-decision="investigate"]').click();
  await page.locator("#dx").click();
  await page.reload();
  await page.locator("#body [data-evidence]").first().click();
  assert.equal(await page.locator("#decision-note").inputValue(), "Synthetic review note");
  assert.equal(await page.locator("#decision-status").textContent(), "Saved locally · investigate");
  await page.locator("#dx").click();
  await page.locator('#statchips [data-stat="unmatched"]').click();
  assert.equal(await page.locator("#body tr[data-i]").count(), 2);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-csv").click();
  const download = await downloadPromise;
  const csv = await Bun.file((await download.path()) as string).text();
  assert(csv.includes("'=FORMULA"));
  await page.locator("#cmdopen").click();
  await page.locator("#cbq").fill("Theme: Cresa");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.locator("#body [data-evidence]").first().click();
  assert(await page.locator("#drawer").isVisible());
  await page.screenshot({ path: join(dir, "mobile.png"), fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(
    join(dir, "result.json"),
    JSON.stringify({ passed: true, errors, checkedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 }
  );
  console.log(
    "Review QA passed: filters, details, escaped content, safe links, notes, CSV, command bar, mobile layout."
  );
} finally {
  await browser.close();
  console.log(`QA artifacts retained: ${dir}`);
}
