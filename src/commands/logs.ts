import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { discoverLogs, LogReader, type LogSource, sharedViewerLogs } from "../diagnostics/logs.js";
import { profileConfigRoot } from "../store/config.js";
import { isJsonMode, printData } from "../utils/output.js";

export async function logsCommand(options: {
  follow?: boolean;
  lines: number;
  source: string;
  paths?: boolean;
}) {
  if (!["all", "http", "browser", "launcher", "viewer"].includes(options.source))
    throw new Error("Log source must be all, http, browser, launcher or viewer");
  if (options.lines > 10000) throw new Error("Log lines must be 1–10000");
  if (options.paths && options.follow) throw new Error("Use --paths or --follow, not both");
  const env = { ...process.env };
  const selectedRoot = profileConfigRoot(env);
  const profile = selectedRoot ? basename(selectedRoot) : "default";
  const viewer = options.source === "all" || options.source === "viewer" ? sharedViewerLogs() : [];
  const files = async () =>
    (await discoverLogs(env, viewer)).filter(
      (file) => options.source === "all" || file.source === (options.source as LogSource)
    );
  if (options.paths) {
    printData({ profile, files: await files() });
    return;
  }
  const reader = new LogReader();
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (options.follow) {
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
  try {
    if (options.follow && !isJsonMode())
      process.stderr.write(`Following ${profile} logs; viewer logs are shared. Ctrl-C stops.\n`);
    do {
      for (const file of await files()) {
        for (const line of await reader.read(file, options.lines, Boolean(options.follow))) {
          if (isJsonMode()) printData({ profile, source: file.source, path: file.path, line });
          else
            process.stdout.write(
              `[${file.source}:${basename(file.path)}] ${line.replace(/\p{Cc}/gu, "")}\n`
            );
        }
      }
      if (!options.follow || controller.signal.aborted) break;
      await delay(1000, undefined, { signal: controller.signal }).catch((error) => {
        if (error.name !== "AbortError") throw error;
      });
    } while (!controller.signal.aborted);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
