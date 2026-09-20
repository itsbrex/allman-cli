import { homedir } from "node:os";
import { join } from "node:path";
import { McpMailSource } from "../mail/source.js";
import { ingestMail, type MailConfig, MailStore } from "../mail/store.js";
import { resolveStorePath } from "../store/index.js";
import { withWorkspaceLock, workspaceRoot, writePrivate } from "../store/private-workspace.js";
import * as output from "../utils/output.js";
export interface MailOptions {
  store?: string;
  json?: boolean;
  allAccounts?: boolean;
  mailAccount?: string[];
  days?: number;
  command?: string;
  serverArg?: string[];
  pythonPath?: string;
  maxPages?: number;
  reconcile?: boolean;
}
export async function mailCommand(action: string, opts: MailOptions) {
  const root = workspaceRoot(resolveStorePath(opts.store)),
    store = new MailStore(root);
  if (action === "status") {
    output.printData({ workspace: root, config: await store.config(), runs: await store.runs() });
    return;
  }
  const previous = await store.config();
  const sourceConfig = {
    command:
      opts.command ?? previous?.source.command ?? join(homedir(), ".local/bin/apple-mail-mcp"),
    args: opts.serverArg ?? previous?.source.args ?? ["serve", "-r"],
    pythonPath: opts.pythonPath ?? previous?.source.pythonPath,
  };
  const source = new McpMailSource();
  try {
    await source.connect(sourceConfig);
    if (action === "accounts") {
      output.printData(await source.accounts());
      return;
    }
    if (action === "configure") {
      const available = await source.accounts();
      const selected = opts.allAccounts
        ? available
        : available.filter(
            (a) => opts.mailAccount?.includes(a.name) || opts.mailAccount?.includes(a.id)
          );
      if (!selected.length)
        throw new Error("Choose --all-accounts or repeat --mail-account <name|id>");
      const days = opts.days ?? 90;
      if (!Number.isInteger(days) || days < 1 || days > 3650)
        throw new Error("--days must be between 1 and 3650");
      const config: MailConfig = {
        schemaVersion: 1,
        days,
        accounts: selected,
        source: sourceConfig,
      };
      await withWorkspaceLock(root, () => writePrivate(join(root, "mail-config.json"), config));
      output.printData({ configured: selected.map((a) => a.name), days, workspace: root });
      return;
    }
    if (action !== "sync") throw new Error("Use mail accounts, configure, sync, or status");
    if (!previous) throw new Error("Configure mail accounts before syncing");
    if (opts.maxPages !== undefined && (!Number.isInteger(opts.maxPages) || opts.maxPages < 1))
      throw new Error("--max-pages must be positive");
    const runs = await withWorkspaceLock(root, () =>
      ingestMail(store, source, previous, {
        maxPages: opts.maxPages,
        reconcile: opts.reconcile,
        onPage: (account, run) =>
          output.info(
            `${account}: ${run.scanned} indexed rows scanned, ${run.errors.length} errors${run.cursor ? ", continuing" : ""}`
          ),
      })
    );
    output.printData({ runs, scope: "indexed", archiveComplete: false });
  } finally {
    await source.close();
  }
}
