import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { get } from "node:https";
import { join } from "node:path";
import { dashboardAutoOpen, dashboardCaFile, dashboardUrl } from "../activity/config.js";
import { activityBaseline, beginActivity } from "../activity/journal.js";
import type { ActivityServer } from "../activity/server.js";
import { resolveStorePath, Store } from "../store/index.js";
import { workspaceRoot } from "../store/private-workspace.js";
import { info, warn } from "../utils/output.js";

export async function activityContext(
  options: { store?: string; account?: string },
  env: NodeJS.ProcessEnv = process.env
) {
  const path = resolveStorePath(options.store);
  const store = new Store({ path });
  const account = await store.accounts.getDefault(options.account || env.ALLMAN_ACCOUNT);
  const auth = await store.accounts.readAuth(account);
  return {
    root: join(
      workspaceRoot(path, env),
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
  const preferred = options.port === undefined ? await dashboardUrl() : undefined;
  if (preferred) {
    try {
      const identityUrl = new URL("/api/identity", preferred);
      const caFile = identityUrl.protocol === "https:" ? await dashboardCaFile() : undefined;
      const response = caFile
        ? await localDashboardIdentity(identityUrl, await readFile(caFile))
        : await fetch(identityUrl, {
            signal: AbortSignal.timeout(1500),
            redirect: "error",
          });
      const identity = (await response.json()) as { app?: string; key?: string };
      const key = createHash("sha256").update(context.root).digest("hex");
      if (response.ok && identity.app === "allman-activity-v1" && identity.key === key) {
        info(`Live activity: ${preferred} (local observer; no LinkedIn connection)`);
        if (options.open !== false) openViewer(preferred);
        return { url: preferred, close: async () => {}, reused: true };
      }
    } catch {
      // An unavailable local viewer must not block processing.
    }
    warn(
      "Configured dashboard is unavailable or belongs to another account; using embedded viewer."
    );
  }
  const { startActivityServer } = await import("../activity/server.js");
  const server = await startActivityServer({ ...context, port: options.port });
  info(`Live activity: ${server.url} (local observer; no LinkedIn connection)`);
  if (options.open !== false) openViewer(server.url);
  return server;
}

// Trust an explicitly configured local CA only for this viewer identity request.
// Never change global TLS verification or trust for LinkedIn requests.
async function localDashboardIdentity(url: URL, ca: Buffer): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = get(url, { ca, signal: AbortSignal.timeout(1500) }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error("Dashboard identity request failed"));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 4096) request.destroy(new Error("Dashboard identity response is too large"));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve(new Response(Buffer.concat(chunks))));
    });
    request.on("error", reject);
  });
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
  if (
    options.dashboard === true ||
    (command === "start" && (await dashboardAutoOpen(options.dashboard)))
  )
    return activityCommand({ ...options, port: options.dashboardPort });
  return undefined;
}
