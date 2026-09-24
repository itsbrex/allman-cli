#!/usr/bin/env bun
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { renderActivityApp } from "./build-activity-app.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const activity = await readFile(join(root, "apps/activity.html"), "utf8");
assert.equal(
  renderActivityApp(activity),
  activity,
  "Activity app stale: run bun run activity:build"
);
let scripts = 0;
for (const file of ["apps/activity.html", "apps/target-enrichment.html"]) {
  const html = await readFile(join(root, file), "utf8");
  if (file.includes("target-enrichment"))
    assert.equal(html.split("/* ALLMAN_REPORT */null").length, 2);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (
      /\bsrc\s*=|type=["'](?:application\/ld\+json|application\/json|module)["']/i.test(
        match[1] ?? ""
      )
    )
      continue;
    new Script(match[2] ?? "", { filename: file });
    scripts++;
  }
}
const receipts = join(root, "docs/browser-atlas/receipts");
let checked = 0;
for (const name of await readdir(receipts)) {
  if (!name.endsWith(".delivery.json")) continue;
  const receipt = JSON.parse(await readFile(join(receipts, name), "utf8"));
  const slug = name.replace(".delivery.json", "");
  for (const [relative, expected] of [
    [`specs/${slug}.final.json`, receipt.specification],
    [`diagrams/${slug}.html`, receipt.artifact],
  ] as const) {
    const data = await readFile(join(root, "docs/browser-atlas", relative));
    assert.equal(data.length, expected.bytes, `${relative}: size changed`);
    assert.equal(
      createHash("sha256").update(data).digest("hex"),
      expected.sha256,
      `${relative}: receipt mismatch`
    );
  }
  checked++;
}
console.log(
  `App checks passed: activity source parity, ${scripts} inline scripts, ${checked} frozen atlas receipts.`
);
