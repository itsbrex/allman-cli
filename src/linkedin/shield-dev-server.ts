import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { SessionDevelopmentConfig } from "./session-development.js";

const exec = promisify(execFile);
type ServerConfig = SessionDevelopmentConfig["shield"];

async function listenerPids(port: number): Promise<number[]> {
  try {
    const { stdout } = await exec("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"], {
      timeout: 5000,
    });
    return [
      ...new Set(
        stdout
          .split("\n")
          .filter((line) => /^p\d+$/.test(line))
          .map((line) => Number(line.slice(1)))
      ),
    ];
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    if (failure.code === 1 && !failure.stdout && !failure.stderr) return [];
    throw error;
  }
}

function firstPath(lsofOutput: string): string | undefined {
  return lsofOutput
    .split("\n")
    .find((line) => line.startsWith("n"))
    ?.slice(1);
}

async function assertOwnedServer(pid: number, config: ServerConfig): Promise<void> {
  // argv0 is unreliable: `bun run dev` starts the server as a bare `node`, so the
  // executable comes from the process's first open text file, not from `ps comm`.
  const [cwd, text, command] = await Promise.all([
    exec("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { timeout: 5000 }),
    exec("lsof", ["-a", "-p", String(pid), "-d", "txt", "-Fn"], { timeout: 5000 }),
    exec("ps", ["-p", String(pid), "-o", "command="], { timeout: 5000 }),
  ]);
  const directory = firstPath(cwd.stdout);
  const binary = firstPath(text.stdout);
  let owned = false;
  try {
    const root = realpathSync(config.root);
    owned = Boolean(
      directory &&
        binary &&
        realpathSync(directory) === root &&
        realpathSync(binary) === realpathSync(config.node) &&
        ["dev/server.mjs", join(root, "dev/server.mjs")].some((script) =>
          command.stdout.trim().endsWith(` ${script}`)
        )
    );
  } catch {
    /* An unknown owner must never be killed. */
  }
  if (!owned)
    throw new Error(
      `Port ${config.port} belongs to an unrecognized process (PID ${pid}); nothing was killed`
    );
}

async function health(config: ServerConfig, expectedClients: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/health`, {
      redirect: "error",
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as {
      name?: string;
      revision?: string;
      clients?: number;
      loadedRevisions?: string[];
    };
    return (
      data.name === "LinkedIn Shield DEV" &&
      /^[a-f0-9]{64}$/.test(data.revision ?? "") &&
      (data.clients ?? 0) >= expectedClients &&
      (expectedClients === 0 ||
        Boolean(
          data.loadedRevisions?.length &&
            data.loadedRevisions.every((revision) => revision === data.revision)
        ))
    );
  } catch {
    return false;
  }
}

/** Only a verified Shield process is stopped; unrelated port owners fail closed. */
export async function restartShieldDevelopment(
  config: ServerConfig,
  stateRoot: string,
  expectedClients: number
): Promise<void> {
  if (process.platform !== "darwin")
    throw new Error(
      "Automatic Shield development restart currently requires macOS process ownership checks"
    );
  const owners = await listenerPids(config.port);
  if (owners.length > 1)
    throw new Error(`Multiple processes own port ${config.port}; nothing was killed`);
  for (const pid of owners) {
    await assertOwnedServer(pid, config);
    process.kill(pid, "SIGTERM");
  }
  const stopDeadline = Date.now() + 10000;
  while ((await listenerPids(config.port)).length) {
    if (Date.now() >= stopDeadline)
      throw new Error(`Shield dev server did not release port ${config.port}`);
    await delay(150);
  }
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const logPath = join(stateRoot, "shield-dev.log");
  const log = openSync(logPath, "a", 0o600);
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(config.node, ["dev/server.mjs"], {
      cwd: config.root,
      env: { ...process.env, SHIELD_DEV_PORT: String(config.port) },
      detached: true,
      stdio: ["ignore", log, log],
    });
    await once(child, "spawn");
    child.unref();
  } finally {
    closeSync(log);
  }
  try {
    // MV3 can sleep until its 30-second reconnect alarm. Await build acknowledgement.
    const deadline = Date.now() + 45000;
    while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
      const owners = await listenerPids(config.port);
      if (owners.length === 1 && owners[0] === child.pid && (await health(config, expectedClients)))
        return;
      if (owners.some((pid) => pid !== child.pid))
        throw new Error(`Another process claimed port ${config.port} during restart`);
      await delay(250);
    }
    throw new Error(
      `Shield dev server or ${expectedClients} extension reconnects not ready; inspect ${logPath}`
    );
  } catch (error) {
    // Leave no unverified child after a failed switch, and never signal a replacement PID.
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    throw error;
  }
}
