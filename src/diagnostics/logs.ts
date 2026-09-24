import { spawnSync } from "node:child_process";
import { open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { allmanConfigRoot, profileConfigRoot } from "../store/config.js";

export type LogSource = "http" | "browser" | "launcher" | "viewer";
export interface LogFile {
  source: LogSource;
  path: string;
}
export function sharedViewerLogs(): LogFile[] {
  if (process.platform !== "darwin") return [];
  const plist = join(homedir(), "Library/LaunchAgents/com.allman.activity-viewer.plist");
  return ["StandardOutPath", "StandardErrorPath"].flatMap((key) => {
    const result = spawnSync("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist], {
      encoding: "utf8",
      timeout: 2000,
    });
    const path = result.stdout?.trim();
    return result.status === 0 && path && isAbsolute(path)
      ? [{ source: "viewer" as const, path }]
      : [];
  });
}
export async function discoverLogs(
  env: NodeJS.ProcessEnv,
  viewer: LogFile[] = []
): Promise<LogFile[]> {
  const root = profileConfigRoot(env) ?? allmanConfigRoot(env);
  const directory = join(root, "logs");
  const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const logs: LogFile[] = files
    .filter((name) => /^http-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
    .sort()
    .map((name) => ({ source: "http", path: join(directory, name) }));
  logs.push(
    { source: "browser", path: join(root, "browser.log") },
    { source: "browser", path: join(directory, "browser.log") },
    { source: "launcher", path: join(directory, "app-launch.log") },
    { source: "viewer", path: join(directory, "activity-viewer.log") },
    { source: "viewer", path: join(directory, "activity-viewer-error.log") },
    ...viewer
  );
  return [...new Map(logs.map((file) => [file.path, file])).values()];
}
interface Cursor {
  identity: string;
  offset: number;
  fragment: string;
  decoder: StringDecoder;
}
/** Bounded reads; follow by filename across creation, truncation and replacement. */
export class LogReader {
  private cursors = new Map<string, Cursor>();
  async read(file: LogFile, lines: number, follow: boolean): Promise<string[]> {
    const handle = await open(file.path, "r").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!handle) return [];
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return [];
      const identity = `${stat.dev}:${stat.ino}`;
      let cursor = this.cursors.get(file.path);
      const initial = !cursor;
      if (!cursor || cursor.identity !== identity || stat.size < cursor.offset) {
        cursor = {
          identity,
          offset: initial ? Math.max(0, stat.size - 65536) : 0,
          fragment: "",
          decoder: new StringDecoder("utf8"),
        };
        this.cursors.set(file.path, cursor);
      }
      const start = cursor.offset;
      const buffer = Buffer.alloc(Math.min(65536, Math.max(0, stat.size - start)));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      cursor.offset += bytesRead;
      if (!bytesRead) return [];
      const text = cursor.fragment + cursor.decoder.write(buffer.subarray(0, bytesRead));
      const records = text.split("\n");
      cursor.fragment = records.pop() ?? "";
      if (initial && start > 0) records.shift();
      if (cursor.fragment.length > 65536) {
        records.push("[oversized log line truncated]");
        cursor.fragment = cursor.fragment.slice(-65536);
      }
      if (!follow && cursor.fragment) {
        records.push(cursor.fragment);
        cursor.fragment = "";
      }
      return initial ? records.slice(-lines) : records;
    } finally {
      await handle.close();
    }
  }
}
