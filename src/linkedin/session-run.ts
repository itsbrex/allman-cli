/** Start a program as the active profile, under the session guard held by the caller. */
import { spawn } from "node:child_process";
import { constants } from "node:os";

export interface GuardEnv {
  ALLMAN_PROFILE: string;
  ALLMAN_NEO_MCP_URL: string;
  ALLMAN_EXPECTED_MEMBER_ID: string;
  ALLMAN_SESSION_RUN: "1";
}

/**
 * Resolve with the child's exit code (128 + signal number when it was killed).
 * The terminal already delivers Ctrl-C to the child's process group, so SIGINT is
 * absorbed here instead of being forwarded twice; SIGTERM and SIGHUP are forwarded.
 */
export function runGuardedChild(command: string[], guard: GuardEnv): Promise<number> {
  const [file, ...args] = command;
  if (!file) return Promise.reject(new Error("Use session run <name> -- <command...>"));
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: "inherit", env: { ...process.env, ...guard } });
    const handlers: Array<[NodeJS.Signals, () => void]> = [
      ["SIGINT", () => {}],
      ["SIGTERM", () => child.kill("SIGTERM")],
      ["SIGHUP", () => child.kill("SIGHUP")],
    ];
    for (const [signal, handler] of handlers) process.on(signal, handler);
    const cleanup = () => {
      for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      resolve(code ?? 128 + (signal ? (constants.signals[signal] ?? 0) : 0));
    });
  });
}
