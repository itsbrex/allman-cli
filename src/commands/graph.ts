import { buildObservedGraph, introductionPaths } from "../relationships/graph.js";
import { resolveStorePath, Store } from "../store/index.js";
import { workspaceRoot } from "../store/private-workspace.js";
import { relationshipSnapshot } from "../store/relationships.js";
import * as output from "../utils/output.js";
export async function graphCommand(
  query: string | undefined,
  opts: {
    store?: string;
    account?: string;
    maxAgeDays?: number;
    includeStale?: boolean;
    icp?: string;
    minConfidence?: number;
    limit?: number;
  }
) {
  const store = new Store({ path: resolveStorePath(opts.store) }),
    snapshot = await relationshipSnapshot(store, workspaceRoot(store.root));
  const account = opts.account ? await store.accounts.getDefault(opts.account) : undefined;
  const graph = await buildObservedGraph(store, snapshot, { account, maxAgeDays: opts.maxAgeDays });
  output.printData(query === undefined ? graph : introductionPaths(graph, query, snapshot, opts));
}
