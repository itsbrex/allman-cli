import { randomUUID } from "node:crypto";
import { chmod, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Command } from "commander";
import {
  AttioListSource,
  attioSourceConfig,
  attioToken,
  type TargetSnapshot,
  validateTargetSnapshot,
} from "../attio/lists.js";
import {
  type IdentityCache,
  mapStoredSalesnavIds,
  parseSalesnavListUrl,
  readSalesnavList,
  salesnavSnapshot,
} from "../attio/salesnav-list.js";
import {
  adequateDeep,
  type EnrichmentPlan,
  matchTargets,
  planHash,
  reviewTargets,
} from "../attio/target-matches.js";
import { executeTargetPlan } from "../attio/target-runner.js";
import { loadSession } from "../linkedin/api/session.js";
import {
  assertActiveProfile,
  beginLinkedInCommand,
  canonicalPath,
} from "../linkedin/session-control.js";
import type { StoredConnection } from "../store/connections-store.js";
import { resolveStorePath, Store } from "../store/index.js";
import {
  readJson,
  withWorkspaceLock,
  workspaceRoot,
  writePrivate,
} from "../store/private-workspace.js";
import { printData } from "../utils/output.js";
import { DEFAULT_PAGE_DELAY, randomPageSleep } from "../utils/random-delay.js";

export interface EnrichListOptions {
  account?: string;
  store?: string;
  json?: boolean;
  snapshot?: string;
  codexConfig?: string;
  limit?: number;
  html?: boolean;
  refreshLinks?: boolean;
}
export async function targetContext(options: EnrichListOptions) {
  const path = canonicalPath(resolveStorePath(options.store)),
    store = new Store({ path });
  const account = await store.accounts.getDefault(options.account);
  return { store, account, root: join(workspaceRoot(path), "target-enrichment", account) };
}
export async function storedConnections(store: Store, account: string) {
  const cstore = store.connectionsFor(account);
  const rows: StoredConnection[] = [];
  // Bounded local I/O; never materialize thousands of pending reads at once.
  const ids = await cstore.listConnectionIds();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = await Promise.all(ids.slice(i, i + 50).map((id) => cstore.readConnection(id)));
    rows.push(...batch.filter((r): r is StoredConnection => !!r));
  }
  return rows;
}
export async function readTargetPlan(root: string, id: string, account: string, path: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("Invalid run ID");
  const sealed = await readJson<{ plan: EnrichmentPlan; hash: string } | null>(
    join(root, id, "plan.json"),
    null
  );
  if (!sealed || planHash(sealed.plan) !== sealed.hash)
    throw new Error("Missing or modified enrichment plan");
  const plan = sealed.plan;
  validateTargetSnapshot(plan.snapshot);
  if (
    plan.id !== id ||
    plan.account !== account ||
    plan.store !== path ||
    (plan.snapshot.source && plan.snapshot.source.account !== account)
  )
    throw new Error("Run belongs to a different account or store");
  if (new Set(plan.targets.map((t) => t.flagshipId)).size !== plan.targets.length)
    throw new Error("Duplicate target IDs in plan");
  return plan;
}

export async function enrichListCommand(
  action: string,
  target: string | undefined,
  options: EnrichListOptions
) {
  if (action === "auth") {
    if (!options.codexConfig)
      throw new Error("Use auth --codex-config <path> or set ATTIO_API_KEY");
    await readFile(resolve(options.codexConfig));
    await writePrivate(attioSourceConfig(), { codexConfig: resolve(options.codexConfig) });
    await attioToken();
    printData({ configured: true, credentialCopied: false });
    return;
  }
  if (action === "lists") {
    printData(await new AttioListSource(await attioToken()).lists());
    return;
  }
  if (!["prepare", "run", "review", "status", "history"].includes(action))
    throw new Error(
      "Use lists, prepare <list-id>, run <run-id>, review <run-id>, status <run-id>, history, or auth"
    );
  const { store, account, root } = await targetContext(options);
  if (action === "history") {
    const dirs = await readdir(root, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
    const runs = [];
    for (const dir of dirs.filter((d) => d.isDirectory())) {
      const plan = await readTargetPlan(root, dir.name, account, store.root);
      runs.push({
        id: plan.id,
        preparedAt: plan.preparedAt,
        list: plan.snapshot.list,
        selected: plan.targets.length,
      });
    }
    printData(runs.sort((a, b) => b.preparedAt.localeCompare(a.preparedAt)));
    return;
  }
  if (!target)
    throw new Error(`${action} requires ${action === "prepare" ? "a list ID" : "a run ID"}`);
  if (action === "prepare") {
    const salesList = target.startsWith("http") ? parseSalesnavListUrl(target) : null;
    const rows = await storedConnections(store, account);
    let snapshot: unknown;
    if (options.snapshot) snapshot = JSON.parse(await readFile(options.snapshot, "utf8"));
    else if (salesList) {
      const opts = { ...options, store: store.root, account };
      await assertActiveProfile(opts);
      const command = new Command("connections");
      for (const [key, value] of Object.entries(opts)) command.setOptionValue(key, value);
      const release = await beginLinkedInCommand(command);
      try {
        const session = await loadSession(store, account);
        if (session.profileId !== account) throw new Error("Authenticated account mismatch");
        const pace = () => randomPageSleep(DEFAULT_PAGE_DELAY);
        const list = await readSalesnavList(session.apiClient, salesList.url, pace);
        const cachePath = join(root, "salesnav-identities.json");
        const cache = await readJson<IdentityCache>(cachePath, {
          version: 1,
          account,
          mappings: {},
        });
        const mapping = list.leads.length
          ? await mapStoredSalesnavIds(
              session.apiClient,
              rows,
              account,
              cache,
              (value) => writePrivate(cachePath, value),
              pace
            )
          : new Map<string, string>();
        snapshot = salesnavSnapshot(list, rows, account, mapping);
      } finally {
        release?.();
      }
    } else snapshot = await new AttioListSource(await attioToken()).snapshot(target);
    validateTargetSnapshot(snapshot);
    if (snapshot.list.id !== (salesList?.id ?? target))
      throw new Error("Snapshot list ID mismatch");
    if (snapshot.source && snapshot.source.account !== account)
      throw new Error("Snapshot account mismatch");
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const plan: EnrichmentPlan = {
      version: 1,
      id,
      preparedAt: new Date().toISOString(),
      store: store.root,
      account,
      accountName: (await store.accounts.readAuth(account))?.name ?? account,
      snapshot,
      ...matchTargets(snapshot, rows),
    };
    await writePrivate(join(root, id, "plan.json"), { plan, hash: planHash(plan) });
    const report = reviewTargets(plan, rows);
    await writePrivate(join(root, id, "review.json"), report);
    printData({
      runId: id,
      account,
      accountName: plan.accountName,
      list: snapshot.list,
      ...report.summary,
      pending: report.summary.selected - report.summary.saved,
      reportPath: join(root, id, "review.json"),
    });
    return;
  }
  const plan = await readTargetPlan(root, target, account, store.root);
  const reportPath = join(root, target, "review.json");
  const linksPath = join(root, target, "review-links.json");
  let links = await readJson<TargetSnapshot>(linksPath, plan.snapshot);
  if (action === "review" && options.refreshLinks) {
    if (plan.snapshot.source)
      throw new Error("Sales Navigator links are stable; prepare again to refresh list membership");
    links = await new AttioListSource(await attioToken()).snapshot(plan.snapshot.list.id);
    await writePrivate(linksPath, links);
  }
  validateTargetSnapshot(links);
  if (links.list.id !== plan.snapshot.list.id) throw new Error("Review links list mismatch");
  if (action === "status") {
    printData({
      runId: target,
      list: plan.snapshot.list,
      state: await readJson(join(root, target, "state.json"), null),
      summary: reviewTargets(plan, await storedConnections(store, account), links).summary,
    });
    return;
  }
  if (action === "review") {
    const report = reviewTargets(plan, await storedConnections(store, account), links);
    await writePrivate(reportPath, report);
    let htmlPath: string | undefined;
    if (options.html) {
      const { targetReviewHtml } = await import("../attio/review-html.js");
      htmlPath = join(root, target, "review.html");
      await writeFile(htmlPath, targetReviewHtml(report), { mode: 0o600 });
      await chmod(htmlPath, 0o600);
    }
    printData({ ...report, reportPath, ...(htmlPath ? { htmlPath } : {}) });
    return;
  }
  await withWorkspaceLock(join(root, target), async () => {
    const rows = await storedConnections(store, account);
    const byId = new Map(rows.map((row) => [row.flagshipId, row]));
    const pending = plan.targets.filter(
      (t) => !byId.has(t.flagshipId) || !adequateDeep(byId.get(t.flagshipId) as StoredConnection)
    );
    if (pending.length && !plan.snapshot.source) {
      // Revalidate membership once per run. A new list member can never expand the sealed queue.
      const live = await new AttioListSource(await attioToken()).snapshot(plan.snapshot.list.id);
      const liveTargets = new Map(matchTargets(live, rows).targets.map((t) => [t.flagshipId, t]));
      if (pending.some((t) => !liveTargets.has(t.flagshipId)))
        throw new Error("Attio membership changed; prepare a new shortlist before enrichment");
    }
    const source = plan.snapshot.source;
    try {
      const state = await executeTargetPlan(
        plan,
        store,
        { ...options, store: store.root, account },
        (state) => writePrivate(join(root, target, "state.json"), state),
        source
          ? async (client) => {
              const live = await readSalesnavList(client, source.url, () =>
                randomPageSleep(DEFAULT_PAGE_DELAY)
              );
              const ids = new Set(live.leads.map((lead) => lead.id));
              if (pending.some((t) => !t.personIds.some((id) => ids.has(id))))
                throw new Error(
                  "Sales Navigator membership changed; prepare a new shortlist before enrichment"
                );
            }
          : undefined
      );
      printData({ runId: target, ...state, reportPath });
    } finally {
      await writePrivate(
        reportPath,
        reviewTargets(plan, await storedConnections(store, account), links)
      );
    }
  });
}
