import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { restartShieldDevelopment } from "@/linkedin/shield-dev-server.js";

const exec = promisify(execFile);
const macTest = it.skipIf(process.platform !== "darwin");
let root: string;
let config: { root: string; node: string; port: number };
const children: ChildProcess[] = [];
async function listener(): Promise<number | undefined> {
  try {
    const { stdout } = await exec("lsof", ["-nP", `-iTCP:${config.port}`, "-sTCP:LISTEN", "-t"]);
    return Number(stdout.trim());
  } catch {
    return undefined;
  }
}
async function start(script: string) {
  const child = spawn(config.node, [script], {
    cwd: root,
    stdio: "ignore",
    env: { ...process.env, SHIELD_DEV_PORT: String(config.port) },
  });
  children.push(child);
  const deadline = Date.now() + 5000;
  while ((await listener()) !== child.pid) {
    if (Date.now() > deadline || child.exitCode !== null)
      throw new Error("Fixture failed to listen");
    await delay(50);
  }
  return child;
}
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "allman-dev-server-")));
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  config = { root, node: await realpath(process.execPath), port };
  await mkdir(join(root, "dev"));
  const source = `import {createServer} from 'node:http';
const server=createServer((req,res)=>res.end(JSON.stringify({name:'LinkedIn Shield DEV', revision:'a'.repeat(64),clients:0,loadedRevisions:[]})));
server.listen(Number(process.env.SHIELD_DEV_PORT),'127.0.0.1');
process.on('SIGTERM',()=>server.close());`;
  await writeFile(join(root, "dev/server.mjs"), source);
  await writeFile(join(root, "unrelated.mjs"), source);
});
afterEach(async () => {
  const pid = await listener();
  // This test owns its ephemeral port and every process started on it.
  if (pid) process.kill(pid, "SIGTERM");
  for (const child of children.splice(0))
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await rm(root, { recursive: true, force: true });
});
macTest(
  "replaces the exact dev server and waits for healthy replacement PID",
  async () => {
    const previous = await start("dev/server.mjs");
    await restartShieldDevelopment(config, join(root, "state"), 0);
    expect(await listener()).toBeTruthy();
    expect(await listener()).not.toBe(previous.pid);
    expect(previous.exitCode === 0 || previous.signalCode === "SIGTERM").toBe(true);
  },
  20000
);
macTest(
  "starts development when the configured port is free",
  async () => {
    await restartShieldDevelopment(config, join(root, "state"), 0);
    expect(await listener()).toBeTruthy();
  },
  10000
);
macTest(
  "refuses an unrelated listener without signaling it",
  async () => {
    const unrelated = await start("unrelated.mjs");
    await expect(restartShieldDevelopment(config, join(root, "state"), 0)).rejects.toThrow(
      "unrecognized process"
    );
    expect(await listener()).toBe(unrelated.pid);
    expect(unrelated.exitCode).toBeNull();
    expect(unrelated.signalCode).toBeNull();
  },
  10000
);
macTest(
  "reports a failed startup and leaves no listener",
  async () => {
    await writeFile(join(root, "dev/server.mjs"), "process.exit(1);");
    await expect(restartShieldDevelopment(config, join(root, "state"), 0)).rejects.toThrow(
      "not ready"
    );
    expect(await listener()).toBeUndefined();
  },
  10000
);
