import { spawn } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import axios from "axios";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configureHttpLog, resetHttpLog } from "@/diagnostics/http-log.js";
import { discoverLogs, LogReader } from "@/diagnostics/logs.js";
import { LinkedInApiClient } from "@/linkedin/api/client.js";
import type { AccountRecord } from "@/store/types.js";

vi.mock("axios", () => ({ default: vi.fn() }));
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-logs-"));
});
afterEach(async () => {
  resetHttpLog();
  vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});
it("isolates selected/default profile logs and includes explicit shared viewer paths once", async () => {
  for (const profile of ["jp", "brian"]) {
    await mkdir(join(root, "allman", profile, "logs"), { recursive: true });
    await writeFile(join(root, "allman", profile, "logs", "http-2026-09-24.jsonl"), "{}\n");
  }
  await writeFile(join(root, "allman/default-profile.json"), JSON.stringify({ profile: "brian" }));
  const jp = await discoverLogs({ XDG_CONFIG_HOME: root, ALLMAN_PROFILE: "jp" });
  expect(jp.every((f) => f.path.includes("/jp/"))).toBe(true);
  const defaultFiles = await discoverLogs({ XDG_CONFIG_HOME: root });
  expect(defaultFiles.every((f) => f.path.includes("/brian/"))).toBe(true);
  expect(
    (
      await discoverLogs({ XDG_CONFIG_HOME: root }, [
        { source: "viewer", path: "/shared/viewer.log" },
      ])
    ).at(-1)?.path
  ).toBe("/shared/viewer.log");
});
it("tails appended fragments, later creation, truncation and file replacement", async () => {
  const file = { source: "http" as const, path: join(root, "http.jsonl") };
  const reader = new LogReader();
  expect(await reader.read(file, 2, true)).toEqual([]);
  await writeFile(file.path, "one\ntwo\nthree\npartial");
  expect(await reader.read(file, 2, true)).toEqual(["two", "three"]);
  expect(await reader.read(file, 2, true)).toEqual([]);
  await appendFile(file.path, " complete\nfour\n");
  expect(await reader.read(file, 2, true)).toEqual(["partial complete", "four"]);
  await writeFile(file.path, "reset\n");
  expect(await reader.read(file, 2, true)).toEqual(["reset"]);
  await rename(file.path, `${file.path}.old`);
  await writeFile(file.path, "replacement\n");
  expect(await reader.read(file, 2, true)).toEqual(["replacement"]);
});
it("writes HTTP failure metadata privately without bodies or credentials, with raw path", async () => {
  configureHttpLog({ XDG_CONFIG_HOME: root, ALLMAN_PROFILE: "jp" });
  const client = new LinkedInApiClient({ account: { cookieJar: null } as AccountRecord });
  client.setRawArchive(join(root, "evidence"), "jp");
  vi.mocked(axios).mockResolvedValue({
    status: 429,
    headers: { "retry-after": "90", "set-cookie": "cookie-secret" },
    data: { message: "private-body" },
  });
  await expect(
    client.request({
      method: "GET",
      url: "https://www.linkedin.com/sales-api/fixture?token=query-secret",
      headers: { authorization: "header-secret" },
    })
  ).rejects.toMatchObject({ statusCode: 429 });
  vi.mocked(axios).mockRejectedValue(new Error("transport-secret"));
  await expect(
    client.request({ method: "GET", url: "https://www.linkedin.com/sales-api/fixture" })
  ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  const file = (await discoverLogs({ XDG_CONFIG_HOME: root, ALLMAN_PROFILE: "jp" })).find(
    (f) => f.source === "http"
  );
  const text = await readFile(file?.path ?? "", "utf8");
  expect(text).not.toMatch(/secret|private-body/);
  const events = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(events[0]).toMatchObject({
    status: 429,
    retryAfterSeconds: 90,
    endpoint: "https://www.linkedin.com/sales-api/fixture",
  });
  expect(events[0].rawPath).toContain("/evidence/raw/");
  expect(events[1]).toMatchObject({ outcome: "network-error" });
  expect((await stat(file?.path ?? "")).mode & 0o777).toBe(0o600);
});
it("public logs --follow emits new files as JSON and exits cleanly on SIGINT", async () => {
  const directory = join(root, "allman/jp/logs");
  await mkdir(directory, { recursive: true });
  const child = spawn(
    "bun",
    [resolve("src/index.ts"), "--json", "logs", "--source", "http", "--follow"],
    {
      env: { ...process.env, ALLMAN_PROFILE: "jp", XDG_CONFIG_HOME: root },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  const done = new Promise<number | null>((resolve) => child.once("exit", resolve));
  try {
    await writeFile(join(directory, "http-2026-09-24.jsonl"), '{"status":429}\n');
    await vi.waitFor(() => expect(stdout).toContain("429"), { timeout: 10000 });
    expect(JSON.parse(stdout.trim())).toMatchObject({
      profile: "jp",
      source: "http",
      line: '{"status":429}',
    });
    child.kill("SIGINT");
    expect(await done, stderr).toBe(0);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await done;
    }
  }
}, 15000);
