#!/usr/bin/env bun
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { targetReviewHtml } from "../src/attio/review-html.ts";
import { latestReviewFile } from "../src/attio/review-server.ts";
import { targetContext } from "../src/commands/enrich-list.ts";
import { artifactDirectory } from "./artifact-directory.ts";

const input = process.argv[2];
if (input === "--help") {
  console.log(
    "bun run enrichment:build [saved-review.json]\nWithout a path: rebuild the selected account's newest saved review beside its JSON.\nWith a path: create a new private artifacts/local directory. No provider requests."
  );
} else {
  const file = input
    ? resolve(input)
    : await latestReviewFile((await targetContext({})).root, "review.json");
  const report = JSON.parse(await readFile(file, "utf8"));
  if (
    report?.version !== 1 ||
    typeof report.account !== "string" ||
    !report.list ||
    !report.summary ||
    ![report.companies, report.profiles, report.unmatched, report.hints].every(Array.isArray)
  )
    throw new Error("Expected a saved Allman review.json, not a plan or provider response");
  const html = targetReviewHtml(report);
  const directory = input ? await artifactDirectory("enrichment-review") : dirname(file);
  const target = join(directory, "review.html");
  const pending = `${target}.${crypto.randomUUID()}.pending`;
  try {
    await writeFile(pending, html, { mode: 0o600, flag: "wx" });
    await rename(pending, target);
  } finally {
    await rm(pending, { force: true });
  }
  console.log(target);
}
