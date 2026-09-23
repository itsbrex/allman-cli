import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { activityBaseline, beginActivity } from "../activity/journal.js";
import type { ActivityServer } from "../activity/server.js";
import { resolveStorePath, Store } from "../store/index.js";
import { workspaceRoot } from "../store/private-workspace.js";
import { info, warn } from "../utils/output.js";

export async function activityContext(options: { store?: string; account?: string }) {
  const path = resolveStorePath(options.store);
  const store = new Store({ path });
  const account = await store.accounts.getDefault(options.account || process.env.ALLMAN_ACCOUNT);
  const auth = await store.accounts.readAuth(account);
  return {
    root: join(
      workspaceRoot(path),
      "activity",
      createHash("sha256").update(account).digest("hex").slice(0, 20)
    ),
    account,
    accountDir: join(path, account),
    label: auth?.name || account,
  };
}

function openViewer(url: string): void {
  const [command, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { stdio: "ignore" });
  child.on("error", () => warn("Could not open a browser. Open the activity URL manually."));
  child.unref();
}

export async function activityCommand(options: {
  store?: string;
  account?: string;
  port?: number;
  open?: boolean;
}): Promise<ActivityServer> {
  const context = await activityContext(options);
  const { startActivityServer } = await import("../activity/server.js");
  const server = await startActivityServer({ ...context, port: options.port });
  info(`Live activity: ${server.url} (local observer; no LinkedIn connection)`);
  if (options.open !== false) openViewer(server.url);
  return server;
}

export async function beginCommandActivity(
  command: string,
  options: {
    store?: string;
    account?: string;
    dashboard?: boolean;
    dashboardPort?: number;
    deep?: boolean;
    salesnav?: boolean;
    flagship?: boolean;
    limit?: number;
  }
): Promise<ActivityServer | undefined> {
  const context = await activityContext(options);
  const description = [
    command,
    options.deep ? "--deep" : "",
    options.salesnav ? "--salesnav" : "",
    options.flagship ? "--flagship" : "",
    Number.isFinite(options.limit) ? `--limit ${options.limit}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  beginActivity(context.root, { ...context, command: description });
  // Preserve retained history before a later quota consumption prunes its rolling ledger.
  const rate = await new Store({ path: resolveStorePath(options.store) }).accounts.readRateState(
    context.account
  );
  activityBaseline(rate?.enrichmentTimestamps ?? [], rate?.companyTimestamps ?? []);
  if (options.dashboard === true || (command === "start" && options.dashboard !== false))
    return activityCommand({ ...options, port: options.dashboardPort });
  return undefined;
}
