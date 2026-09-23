import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ActivityRun, type ActivitySnapshot, readActivitySnapshot } from "@/activity/journal.js";
import { startActivityServer } from "@/activity/server.js";
import { usesLinkedIn } from "@/linkedin/session-control.js";

let root: string;
const cleanup: Array<() => Promise<void>> = [];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-activity-"));
});
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  await rm(root, { recursive: true, force: true });
});

it("records actual person outcomes without copying private payloads or losing history", async () => {
  const run = new ActivityRun(root, { command: "enrich", account: "fixture", label: "QA fixture" });
  run.phase("Deep enrichment", 2);
  const person = {
    firstName: "Taylor",
    lastName: "Example",
    company: "Fixture Co",
    cookieJar: "DO-NOT-COPY",
    body: "PRIVATE-MESSAGE",
  };
  run.person("processing", "person-1", person);
  run.person("saved", "person-1", person);
  run.person("failed", "person-2", { name: "Morgan Example" }, "Profile unavailable");
  run.finish("finished");
  const snapshot = readActivitySnapshot(root);
  expect(snapshot.run?.counts).toEqual({ found: 0, saved: 1, skipped: 0, failed: 1 });
  expect(snapshot.run?.status).toBe("finished");
  expect(snapshot.run?.current).toBeNull();
  expect(snapshot.run?.events.find((e) => e.person?.id === "person-1")?.person?.name).toBe(
    "Taylor Example"
  );
  const journal = await readFile(join(root, `${run.id}.jsonl`), "utf8");
  expect(journal).not.toMatch(/DO-NOT-COPY|PRIVATE-MESSAGE|cookieJar/);
  expect((await stat(join(root, `${run.id}.json`))).mode & 0o777).toBe(0o600);
  const second = new ActivityRun(root, {
    command: "connections",
    account: "fixture",
    label: "QA fixture",
  });
  second.finish("finished");
  expect(readActivitySnapshot(root, run.id).run?.counts.saved).toBe(1);
  expect(readActivitySnapshot(root).runs).toHaveLength(2);
});

it("bounds the browser feed, retains the journal, and shows stopped workers honestly", async () => {
  const run = new ActivityRun(root, {
    command: "connections",
    account: "fixture",
    label: "QA fixture",
  });
  for (let i = 0; i < 230; i++) run.person("found", `id-${i}`, { name: `Example ${i}` });
  run.flush();
  expect(readActivitySnapshot(root).run?.events).toHaveLength(200);
  expect(
    (await readFile(join(root, `${run.id}.jsonl`), "utf8")).trim().split("\n").length
  ).toBeGreaterThan(230);
  expect(readActivitySnapshot(root, undefined, () => false).run?.status).toBe("interrupted");
  expect(() => readActivitySnapshot(root, "../../COOKIES")).toThrow("Invalid activity run");
  run.finish("interrupted");
});

it("keeps quota exhaustion distinct from successful completion", () => {
  const run = new ActivityRun(root, { command: "enrich", account: "fixture", label: "QA fixture" });
  run.quota(Date.now() + 60_000);
  run.finish("finished");
  expect(readActivitySnapshot(root).run?.status).toBe("quota");
});

it("serves a local read-only SSE feed, replays after reconnect, and rejects cross-site access", async () => {
  expect(usesLinkedIn("activity", {})).toBe(false);
  const server = await startActivityServer({ root, label: "QA fixture", port: 0 });
  cleanup.push(server.close);
  expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  const page = await fetch(server.url);
  expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect(await page.text()).toContain("Live contact processing");
  expect((await fetch(`${server.url}api/snapshot`, { method: "POST" })).status).toBe(405);
  expect(
    (await fetch(`${server.url}api/snapshot`, { headers: { Origin: "https://evil.example" } }))
      .status
  ).toBe(403);
  const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
    get(`${server.url}api/snapshot`, { headers: { Host: "evil.example" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", reject);
  });
  expect(wrongHost).toBe(403);
  const run = new ActivityRun(root, { command: "enrich", account: "fixture", label: "QA fixture" });
  run.person("processing", "person-1", { name: "Taylor Example" });
  run.flush();
  const controller = new AbortController();
  const stream = await fetch(`${server.url}api/events`, { signal: controller.signal });
  expect(stream.headers.get("content-type")).toContain("text/event-stream");
  if (!stream.body) throw new Error("Missing SSE body");
  const reader = stream.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  expect(first).toContain("Taylor Example");
  controller.abort();
  run.person("saved", "person-1", { name: "Taylor Example" });
  run.finish("finished");
  const replay = (await fetch(`${server.url}api/snapshot`).then((r) =>
    r.json()
  )) as ActivitySnapshot;
  expect(replay.run?.counts.saved).toBe(1);
  expect(replay.run?.status).toBe("finished");
});
