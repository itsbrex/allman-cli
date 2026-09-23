import { createHash } from "node:crypto";
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
  const html = await page.text();
  expect(html).toContain("Live contact processing");
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  expect(script).toBeTruthy();
  expect(page.headers.get("content-security-policy")).toContain(
    `script-src 'sha256-${createHash("sha256")
      .update(script ?? "")
      .digest("base64")}'`
  );
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
  )) as ActivitySnapshot & { viewKey: string };
  expect(replay.viewKey).toBe(createHash("sha256").update(root).digest("hex"));
  expect(replay.run?.counts.saved).toBe(1);
  expect(replay.run?.status).toBe("finished");
});

it("serves the Appkit artifact through only its configured local proxy origin", async () => {
  const html = await readFile(new URL("../../apps/activity.html", import.meta.url), "utf8");
  const image = await readFile(new URL("../../apps/activity-og.png", import.meta.url));
  // Obtain a free loopback port without routing tests through the user's proxy.
  const listener = await startActivityServer({ root, label: "port reservation", port: 0 });
  const localUrl = listener.url;
  await listener.close();
  const proxied = await startActivityServer({
    root,
    label: "QA fixture",
    port: Number(new URL(localUrl).port),
    publicOrigin: "https://allman-activity.localhost",
    artifact: { html, ogImage: image },
  });
  cleanup.push(proxied.close);
  expect(proxied.url).toBe("https://allman-activity.localhost/apps/activity.html");
  const request = (path: string, headers: Record<string, string | undefined> = {}) =>
    new Promise<{ status?: number; body: Buffer; csp?: string }>((resolve, reject) => {
      get(
        new URL(path, localUrl),
        { headers: { Host: "allman-activity.localhost", ...headers } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              body: Buffer.concat(chunks),
              csp: String(res.headers["content-security-policy"] ?? ""),
            })
          );
        }
      ).on("error", reject);
    });
  const page = await request("/apps/activity.html");
  expect(page.status).toBe(200);
  expect(page.body.toString()).toBe(html);
  // A link/redirect from the plans hub is cross-site navigation. The static shell
  // has no account data; API reads below still reject cross-site requests.
  expect((await request("/apps/activity.html", { "Sec-Fetch-Site": "cross-site" })).status).toBe(
    200
  );
  expect((await request("/apps/activity-og.png", { "Sec-Fetch-Site": "cross-site" })).status).toBe(
    200
  );
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
    expect(page.csp).toContain(
      `'sha256-${createHash("sha256")
        .update(match[1] ?? "")
        .digest("base64")}'`
    );
  expect(page.csp).toContain("font-src data:");
  expect(
    (
      await request("/api/snapshot", {
        Host: `localhost:${new URL(localUrl).port}`,
        "X-Forwarded-Host": "allman-activity.localhost",
        "X-Forwarded-Proto": "https",
      })
    ).status
  ).toBe(200);
  expect((await request("/apps/activity-og.png")).body).toEqual(image);
  expect(
    (await request("/api/snapshot", { Origin: "https://allman-activity.localhost" })).status
  ).toBe(200);
  for (const headers of [
    { Host: "evil.example", "X-Forwarded-Host": "allman-activity.localhost" },
    { Origin: "https://evil.example" },
    { "Sec-Fetch-Site": "cross-site" },
    {
      Host: `localhost:${new URL(localUrl).port}`,
      "X-Forwarded-Host": "evil.example",
      "X-Forwarded-Proto": "https",
    },
    {
      Host: `localhost:${new URL(localUrl).port}`,
      "X-Forwarded-Host": "allman-activity.localhost",
      "X-Forwarded-Proto": "http",
    },
  ])
    expect((await request("/api/snapshot", headers)).status).toBe(403);
  expect((await request("/COOKIES.json")).status).toBe(404);
  expect((await request("/api/snapshot?run=../../private")).status).toBe(400);
});

it("refuses non-local proxy origins and does not silently switch a proxy's occupied port", async () => {
  for (const publicOrigin of [
    "https://public.example",
    "https://x.localhost.evil.example",
    "https://x.localhost/path",
    "https://user@x.localhost",
  ])
    await expect(startActivityServer({ root, label: "fixture", publicOrigin })).rejects.toThrow(
      "local .localhost"
    );
  const existing = await startActivityServer({ root, label: "fixture", port: 0 });
  cleanup.push(existing.close);
  await expect(
    startActivityServer({
      root,
      label: "fixture",
      port: Number(new URL(existing.url).port),
      publicOrigin: "https://allman-activity.localhost",
    })
  ).rejects.toMatchObject({ code: "EADDRINUSE" });
});
