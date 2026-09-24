import { canonicalPath, readSessionRegistry } from "../linkedin/session-control.js";
import { resolveStorePath } from "../store/index.js";
import { warn } from "../utils/output.js";
import { readExportConfig, refreshTeamExports } from "./team.js";

/** Opt-in derived exports. Never changes command output or retries a provider operation. */
export async function beginAutomaticExports(
  command: string,
  parent: string | undefined,
  options: Record<string, unknown>
) {
  const relevant = [
    "start",
    "listen",
    "sync",
    "connections",
    "connections-of",
    "enrich",
    "companies",
    "messages",
    "send",
    "react",
    "connect",
    "mail",
    "relationships",
    "attio",
    "rank",
    "icp",
    "contact",
    "group",
  ];
  if (options.save === false || (!relevant.includes(command) && !relevant.includes(parent ?? "")))
    return undefined;
  const config = await readExportConfig();
  if (!config?.enabled) return undefined;
  const selected = canonicalPath(resolveStorePath(options.store as string | undefined));
  if (
    !readSessionRegistry()?.profiles.some(
      (p) => config.profiles.includes(p.name) && canonicalPath(p.store) === selected
    )
  )
    return undefined;
  let pending: Promise<unknown> | undefined;
  const refresh = () =>
    (pending ??= refreshTeamExports(true)
      .catch((error: unknown) => {
        warn(
          `Team export refresh failed; saved source data remains available. Run allman exports refresh. ${error instanceof Error ? error.message : String(error)}`
        );
      })
      .finally(() => {
        pending = undefined;
      }));
  const timer = ["start", "listen"].includes(command)
    ? setInterval(() => void refresh(), 60000)
    : undefined;
  timer?.unref();
  return async () => {
    if (timer) clearInterval(timer);
    if (pending) await pending;
    await refresh();
  };
}
