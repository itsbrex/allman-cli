#!/usr/bin/env bun
// Retained synthetic browser fixture. No LinkedIn connection or real store access.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ActivityRun } from "../src/activity/journal.ts";
import { startActivityServer } from "../src/activity/server.ts";
import { artifactDirectory } from "./artifact-directory.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = await artifactDirectory("activity-qa");
const journal = join(root, "activity"),
  accountDir = join(root, "account");
await mkdir(accountDir, { recursive: true, mode: 0o700 });
await writeFile(join(accountDir, "COOKIES.json"), JSON.stringify({ cookieJar: { cookies: [] } }));
const options = { account: "fixture", label: "Synthetic QA · 45 events" };
const earlier = new ActivityRun(journal, { ...options, command: "connections — synthetic" });
earlier.person("found", "earlier", { name: "Earlier Example" });
earlier.finish("finished");
let run = new ActivityRun(journal, { ...options, command: "enrich --deep — synthetic" });
for (let i = 1; i <= 45; i++) {
  if (i === 1) run.phase("Connection import", 15);
  if (i === 16) run.phase("Deep enrichment", 15);
  if (i === 31) run.phase("Company lookup", 15);
  const company = i % 9 === 0;
  run.person(
    i % 11 === 0 ? "failed" : i % 7 === 0 ? "skipped" : i % 4 === 0 ? "found" : "saved",
    `fixture-${i}`,
    {
      name: company ? `Fixture Company ${i}` : `Jordan Example ${String(i).padStart(2, "0")}`,
      title: company ? "" : "VP, Operations",
      company: company ? "" : ["Northstar Works", "Meridian Labs", "Cedar Research"][i % 3],
      location: i % 2 ? "San Diego, California" : "Austin, Texas",
    },
    "Synthetic fixture",
    company ? "company" : undefined
  );
  if (i <= 21) run.attempt("enrichment", Date.now() + i);
}
run.flush();
const server = await startActivityServer({
  root: journal,
  accountDir,
  label: options.label,
  port: 0,
  artifact: {
    html: await readFile(join(repo, "apps/activity.html"), "utf8"),
    ogImage: await readFile(join(repo, "apps/activity-og.png")),
  },
});
console.log(JSON.stringify({ url: server.url, run: run.id, earlier: earlier.id }));
console.log("Commands: append, new, quit. Every record is synthetic.");
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  run.finish("finished");
  await server.close();
  console.log(`QA artifacts retained: ${root}`);
  process.exit(0);
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (value) => {
  for (const command of value.trim().split(/\s+/)) {
    if (command === "append") {
      run.person("saved", "arrival", {
        name: "Arrival Example",
        company: "Meridian Labs",
        location: "San Diego, California",
      });
      run.flush();
      console.log("appended");
    } else if (command === "new") {
      run.finish("finished");
      run = new ActivityRun(journal, { ...options, command: "companies — synthetic next run" });
      run.person("saved", "9999", { name: "Next Run Company" }, "Synthetic fixture", "company");
      run.flush();
      console.log("new run");
    } else if (command === "quit") void stop();
  }
});
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
