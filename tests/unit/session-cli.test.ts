import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-session-cli-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
function cli(...args: string[]) {
  return spawnSync("bun", [resolve("src/index.ts"), ...args], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: root,
      ALLMAN_STORE: join(root, "brian"),
      ALLMAN_ACCOUNT: "ACoBrian",
      ALLMAN_BROWSER_WORKSPACE: join(root, "browser"),
    },
  });
}

it("shows session control status without opening a browser or contacting LinkedIn", () => {
  const result = cli("session", "status", "--json");
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ enabled: false, active: null });
});

it("blocks an inactive account before live status, while local status stays available", async () => {
  await mkdir(join(root, "allman"), { recursive: true });
  await writeFile(
    join(root, "allman", "session-control.json"),
    JSON.stringify({
      version: 1,
      active: "jp",
      profiles: [
        {
          name: "jp",
          store: join(root, "jp"),
          account: "ACoJp",
          workspace: join(root, "jp-browser"),
          browser: { cdpEndpoint: "http://127.0.0.1:1", shieldPath: "/fixture/shield" },
        },
        {
          name: "brian",
          store: join(root, "brian"),
          account: "ACoBrian",
          workspace: join(root, "browser"),
          browser: { cdpEndpoint: "http://127.0.0.1:2", shieldPath: "/fixture/shield" },
        },
      ],
    })
  );
  const live = cli("status", "--check", "--json");
  expect(live.status).not.toBe(0);
  expect(live.stderr).toContain('Active LinkedIn profile is "jp"');
  const local = cli("status", "--json");
  expect(local.status, local.stderr).toBe(0);
});

it("refuses a concurrent LinkedIn command even for the same account", async () => {
  const lock = join(root, "allman", "linkedin-command.lock");
  await mkdir(lock, { recursive: true });
  await writeFile(
    join(lock, "owner-test.json"),
    JSON.stringify({ pid: process.pid, operation: "listen" })
  );
  const result = cli("enrich", "--limit", "1");
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("LinkedIn command already running");
  expect(cli("status", "--json").status).toBe(0);
});

it("fails closed on malformed session configuration", async () => {
  await mkdir(join(root, "allman"), { recursive: true });
  await writeFile(join(root, "allman", "session-control.json"), "{}");
  const result = cli("status", "--check");
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Invalid session control");
});

it.each([
  ["connections", "--limit", "1"],
  ["login"],
  ["start"],
  ["sync"],
  ["listen"],
  ["messages", "synthetic"],
  ["companies", "synthetic"],
  ["connections-of", "synthetic"],
  ["browser", "doctor"],
])("blocks inactive profile through public command %j", async (...args) => {
  await mkdir(join(root, "allman"), { recursive: true });
  await writeFile(
    join(root, "allman/session-control.json"),
    JSON.stringify({
      version: 1,
      active: "jp",
      profiles: [
        {
          name: "jp",
          store: join(root, "jp"),
          account: "ACoJp",
          workspace: join(root, "jp-browser"),
          browser: { cdpEndpoint: "http://127.0.0.1:1", shieldPath: "/fixture/shield" },
        },
      ],
    })
  );
  const result = cli(...args);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Active LinkedIn profile is "jp"');
});
