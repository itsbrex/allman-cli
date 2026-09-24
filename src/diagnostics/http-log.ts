import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { allmanConfigRoot, profileConfigRoot } from "../store/config.js";

let directory: string | undefined;
let warned = false;
export function configureHttpLog(env: NodeJS.ProcessEnv = process.env): void {
  directory = join(profileConfigRoot(env) ?? allmanConfigRoot(env), "logs");
}
export function resetHttpLog(): void {
  directory = undefined;
  warned = false;
}
export interface HttpLogEntry {
  method: string;
  endpoint: string;
  status?: number;
  durationMs: number;
  outcome: "response" | "network-error";
  retryAfterSeconds?: number;
  rawPath?: string;
}
/** Append metadata only. Never record cookies, headers, query values or bodies here. */
export function recordHttp(entry: HttpLogEntry): void {
  if (!directory) return;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const time = new Date().toISOString();
    const file = join(directory, `http-${time.slice(0, 10)}.jsonl`);
    appendFileSync(file, `${JSON.stringify({ time, pid: process.pid, ...entry })}\n`, {
      mode: 0o600,
    });
    chmodSync(file, 0o600);
  } catch {
    if (!warned)
      process.stderr.write(
        "HTTP diagnostics could not be saved; inspect profile log permissions.\n"
      );
    warned = true;
  }
}
