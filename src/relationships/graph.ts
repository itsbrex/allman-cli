import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  ConnectionOfTargetMeta,
  StoredConnectionOfResult,
  StoredSalesnavConnection,
} from "../store/connections-store.js";
import type { Store } from "../store/index.js";
import { readJson } from "../store/private-workspace.js";
import {
  filterContacts,
  type RelationshipContact,
  type RelationshipSnapshot,
} from "../store/relationships.js";
import { relationshipScore } from "./rank.js";
export interface GraphNode {
  id: string;
  label: string;
  contactId?: string;
  namespace: "contact" | "self" | "flagship" | "member" | "salesnav";
  slug?: string | null;
  title?: string | null;
  company?: string | null;
}
export interface EdgeEvidence {
  kind: "first-degree" | "connections-of" | "reciprocal-history";
  source: string;
  observedAt: string;
  stale: boolean;
  backend?: string;
  eventIds?: string[];
}
export interface GraphEdge {
  a: string;
  b: string;
  evidence: EdgeEvidence[];
  historyStrength: number | null;
  stale: boolean;
}
export interface ObservedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
  capturedAt: string;
  maxAgeDays: number;
}
const flagship = (urn: string | null | undefined) =>
  urn?.match(/^urn:li:(?:fsd_profile|fs_miniProfile|fs_profile):(ACo[\w-]+)$/)?.[1];
async function entries(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
export async function buildObservedGraph(
  store: Store,
  snapshot: RelationshipSnapshot,
  opts: { account?: string; maxAgeDays?: number; now?: number } = {}
): Promise<ObservedGraph> {
  const now = opts.now ?? Date.now(),
    maxAgeDays = opts.maxAgeDays ?? 90;
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 3650)
    throw new Error("--max-age-days must be 1–3650");
  const nodes = new Map<string, GraphNode>(),
    edges = new Map<string, GraphEdge>(),
    warnings: string[] = [];
  const contacts = new Map(snapshot.contacts.map((c) => [c.id, c]));
  const links = new Map<string, Set<string>>(),
    members = new Map<string, Set<string>>();
  const register = (map: Map<string, Set<string>>, key: string, id: string) => {
    const ids = map.get(key) ?? new Set<string>();
    ids.add(id);
    map.set(key, ids);
  };
  for (const contact of snapshot.contacts) {
    nodes.set(`contact:${contact.id}`, {
      id: `contact:${contact.id}`,
      contactId: contact.id,
      label: contact.name,
      namespace: "contact",
      company: contact.company,
      title: String(contact.facts?.find((f) => f.field === "title")?.value ?? ""),
    });
    for (const link of contact.linkedin)
      register(links, `${link.account}/${link.flagshipId}`, contact.id);
  }
  const nodeForFlagship = (
    account: string,
    id: string,
    label?: string | null,
    slug?: string | null
  ) => {
    if (id === account) return `self:linkedin:${account}`;
    const matches = links.get(`${account}/${id}`);
    const contact = matches?.size === 1 ? [...matches][0] : undefined;
    const nodeId = contact ? `contact:${contact}` : `flagship:${account}/${id}`;
    const current = nodes.get(nodeId);
    if (!current)
      nodes.set(nodeId, { id: nodeId, label: label || slug || id, namespace: "flagship", slug });
    else if (slug) current.slug = slug;
    if (matches && matches.size > 1)
      warnings.push(`Ambiguous contact ownership for ${account}/${id}; kept separate`);
    return nodeId;
  };
  const stale = (observedAt: string) => {
    const age = now - Date.parse(observedAt);
    return !Number.isFinite(age) || age < 0 || age > maxAgeDays * 86400000;
  };
  const add = (
    a: string,
    b: string,
    evidence: EdgeEvidence,
    historyStrength: number | null = null
  ) => {
    if (a === b) return;
    const pair = [a, b].sort(),
      key = JSON.stringify(pair),
      previous = edges.get(key);
    if (previous) {
      if (
        !previous.evidence.some(
          (e) => e.source === evidence.source && e.observedAt === evidence.observedAt
        )
      )
        previous.evidence.push(evidence);
      previous.stale = previous.stale && evidence.stale;
      if (historyStrength !== null)
        previous.historyStrength = Math.max(previous.historyStrength ?? 0, historyStrength);
    } else
      edges.set(key, {
        a: pair[0] as string,
        b: pair[1] as string,
        evidence: [evidence],
        historyStrength,
        stale: evidence.stale,
      });
  };
  const allAccounts = await store.accounts.list(),
    accounts = opts.account ? allAccounts.filter((a) => a === opts.account) : allAccounts;
  for (const account of accounts) {
    for (const id of await store.peopleFor(account).listPersonIds()) {
      const person = await store.peopleFor(account).readPerson(id);
      if (person?.memberId && /^\d+$/.test(person.memberId))
        register(members, `${account}/${person.memberId}`, id);
      const numeric = person?.objectUrn?.match(/^urn:li:member:(\d+)$/)?.[1];
      if (numeric) register(members, `${account}/${numeric}`, id);
    }
    const self = `self:linkedin:${account}`;
    nodes.set(self, { id: self, label: `LinkedIn account ${account}`, namespace: "self" });
    const connections = store.connectionsFor(account);
    for (const id of await connections.listConnectionIds()) {
      const row = await connections.readConnection(id);
      if (!row || row.source === "enrich") continue;
      const person = nodeForFlagship(
        account,
        id,
        [row.firstName, row.lastName].filter(Boolean).join(" "),
        row.publicIdentifier
      );
      const observedAt = Object.hasOwn(row, "connectionObservedAt")
        ? (row.connectionObservedAt ?? "")
        : !row.enrichedAt
          ? row.lastSeenAt
          : "";
      add(self, person, {
        kind: "first-degree",
        source: `${account}/connections/${id}.json`,
        observedAt,
        stale: stale(observedAt),
      });
    }
  }
  for (const account of accounts) {
    const base = join(store.root, account, "connections-salesnav");
    for (const file of await entries(base)) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      const row = await readJson<StoredSalesnavConnection | null>(join(base, file.name), null);
      if (!row || row.degree !== 1) continue;
      const numeric = /^\d+$/.test(row.memberId)
        ? row.memberId
        : row.memberUrn?.match(/^urn:li:member:(\d+)$/)?.[1];
      const bridge = numeric ? members.get(`${account}/${numeric}`) : undefined;
      const id = bridge?.size === 1 ? [...bridge][0] : undefined;
      const namespace = numeric ? "member" : "salesnav";
      if (!id && !numeric && !row.salesnavId) {
        warnings.push(`Unresolved Sales Navigator identity: ${account}/${file.name}`);
        continue;
      }
      const nodeId = id
        ? nodeForFlagship(account, id)
        : `${namespace}:${account}/${numeric ?? row.salesnavId}`;
      if (!nodes.has(nodeId))
        nodes.set(nodeId, {
          id: nodeId,
          namespace,
          label: row.fullName || [row.firstName, row.lastName].filter(Boolean).join(" ") || nodeId,
          title: row.title,
          company: row.company,
        });
      if (bridge && bridge.size > 1)
        warnings.push(`Ambiguous numeric identity: ${account}/${numeric}; kept separate`);
      add(`self:linkedin:${account}`, nodeId, {
        kind: "first-degree",
        source: `${account}/connections-salesnav/${file.name}`,
        observedAt: row.lastSeenAt,
        stale: stale(row.lastSeenAt),
        backend: "salesnav",
      });
    }
  }
  // Reciprocal direct history establishes only owner-to-contact interaction.
  // Co-participation, coworkers, mentions, and one-way outreach add no peer edges.
  const histories = new Map<
    string,
    { contact: RelationshipContact; events: RelationshipSnapshot["timeline"] }
  >();
  for (const event of snapshot.timeline) {
    if (
      !event.direct ||
      !event.eligible ||
      event.automated ||
      event.direction === "unknown" ||
      event.contactIds.length !== 1 ||
      (opts.account && event.account !== opts.account)
    )
      continue;
    const contact = contacts.get(event.contactIds[0] ?? "");
    if (!contact) continue;
    const key = JSON.stringify([event.channel, event.account, contact.id]),
      group = histories.get(key) ?? { contact, events: [] };
    group.events.push(event);
    histories.set(key, group);
  }
  for (const { contact, events: history } of histories.values()) {
    const rank = relationshipScore(history, now),
      first = history[0];
    if (
      !first ||
      !rank.signals.inbound ||
      !rank.signals.outbound ||
      rank.signals.lastActivityAt === null
    )
      continue;
    const self = `self:${first.channel}:${first.account}`;
    nodes.set(self, {
      id: self,
      label: `${first.channel} account ${first.account}`,
      namespace: "self",
    });
    const observedAt = new Date(rank.signals.lastActivityAt).toISOString();
    add(
      self,
      `contact:${contact.id}`,
      {
        kind: "reciprocal-history",
        source: "relationship-timeline",
        eventIds: rank.evidence,
        observedAt,
        stale: stale(observedAt),
      },
      rank.derivedScore
    );
  }
  for (const account of accounts) {
    const base = join(store.root, account, "connections-of");
    for (const dir of await entries(base)) {
      if (!dir.isDirectory()) continue; // never follow aliases
      const meta = await readJson<ConnectionOfTargetMeta | null>(
        join(base, dir.name, "RECORD.json"),
        null
      );
      const target = flagship(meta?.targetUrn);
      if (!meta || !target || target !== dir.name) {
        warnings.push(`Missing or inconsistent connections-of metadata: ${account}/${dir.name}`);
        continue;
      }
      if (meta.total !== null && meta.fetched < meta.total)
        warnings.push(
          `Partial network export: ${account}/${dir.name} (${meta.fetched}/${meta.total})`
        );
      const targetId = nodeForFlagship(account, target, meta.targetSlug, meta.targetSlug);
      for (const file of await entries(join(base, dir.name))) {
        if (!file.isFile() || !file.name.endsWith(".json") || file.name === "RECORD.json") continue;
        const row = await readJson<StoredConnectionOfResult | null>(
          join(base, dir.name, file.name),
          null
        );
        if (!row) continue;
        const explicit = flagship(row.memberUrn),
          numeric =
            row.memberId && /^\d+$/.test(row.memberId)
              ? row.memberId
              : row.memberUrn?.match(/^urn:li:member:(\d+)$/)?.[1];
        const bridges = numeric ? members.get(`${account}/${numeric}`) : undefined;
        const bridged = bridges?.size === 1 ? [...bridges][0] : undefined;
        if (explicit && bridged && explicit !== bridged) {
          warnings.push(`Conflicting identifiers: ${account}/${dir.name}/${file.name}`);
          continue;
        }
        let nodeId: string;
        const id = explicit ?? bridged;
        if (id) nodeId = nodeForFlagship(account, id, row.fullName, row.publicIdentifier);
        else if (numeric || row.salesnavId) {
          const namespace = numeric ? "member" : "salesnav";
          nodeId = `${namespace}:${account}/${numeric ?? row.salesnavId}`;
          if (!nodes.has(nodeId))
            nodes.set(nodeId, {
              id: nodeId,
              namespace,
              label:
                row.fullName ||
                [row.firstName, row.lastName].filter(Boolean).join(" ") ||
                row.publicIdentifier ||
                nodeId,
              slug: row.publicIdentifier,
              title: row.title,
              company: row.company,
            });
          if (bridges && bridges.size > 1)
            warnings.push(`Ambiguous numeric identity: ${account}/${numeric}; kept separate`);
        } else {
          warnings.push(`Unresolved identity: ${account}/${dir.name}/${file.name}`);
          continue;
        }
        add(targetId, nodeId, {
          kind: "connections-of",
          source: `${account}/connections-of/${dir.name}/${file.name}`,
          observedAt: row.lastSeenAt,
          stale: stale(row.lastSeenAt),
          backend: meta.backend,
        });
      }
    }
  }
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    warnings: [...new Set(warnings)],
    capturedAt: new Date(now).toISOString(),
    maxAgeDays,
  };
}
export interface IntroPath {
  owner: string;
  connector: GraphNode;
  target: GraphNode;
  legs: [GraphEdge, GraphEdge];
  relationshipStrength: number | null;
  connectorToTargetStrength: number | null;
  fitConfidence: number | null;
  compositeWeight: number | null;
  stale: boolean;
}
export function introductionPaths(
  graph: ObservedGraph,
  query: string,
  snapshot: RelationshipSnapshot,
  opts: { includeStale?: boolean; icp?: string; minConfidence?: number; limit?: number } = {}
) {
  if (!query.trim()) throw new Error("Supply a target id, name, company or role description");
  const limit = opts.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("--limit must be 1–100");
  const allowed = opts.icp
    ? new Set(
        filterContacts(snapshot, { icp: opts.icp, minConfidence: opts.minConfidence }).map(
          (c) => c.id
        )
      )
    : null;
  if (!opts.icp && opts.minConfidence !== undefined)
    throw new Error("--min-confidence requires --icp");
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => !["a", "an", "the", "of", "at", "in"].includes(t));
  const matches = (node: GraphNode) =>
    node.id === query ||
    node.contactId === query ||
    node.slug === query ||
    (terms.length > 0 &&
      terms.every((term) =>
        [node.label, node.title, node.company, node.slug]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term)
      ));
  const targets = graph.nodes.filter(
    (n) =>
      n.namespace !== "self" &&
      matches(n) &&
      (!allowed || (!!n.contactId && allowed.has(n.contactId)))
  );
  const targetIds = new Set(targets.map((n) => n.id)),
    paths: IntroPath[] = [];
  const edges = graph.edges.filter((e) => opts.includeStale || !e.stale);
  const neighbors = new Map<string, { id: string; edge: GraphEdge }[]>();
  for (const edge of edges)
    for (const [a, b] of [
      [edge.a, edge.b],
      [edge.b, edge.a],
    ] as const)
      neighbors.set(a, [...(neighbors.get(a) ?? []), { id: b, edge }]);
  for (const owner of graph.nodes.filter((n) => n.namespace === "self")) {
    for (const first of neighbors.get(owner.id) ?? []) {
      const connector = nodes.get(first.id);
      if (!connector || connector.namespace === "self") continue;
      for (const second of neighbors.get(first.id) ?? []) {
        if (!targetIds.has(second.id) || second.id === owner.id) continue;
        const target = nodes.get(second.id);
        if (!target || target.id === connector.id) continue;
        const fit = opts.icp
          ? (snapshot.contacts.find((c) => c.id === target.contactId)?.qualifications?.[opts.icp]
              ?.confidence ?? null)
          : null;
        const composite =
          first.edge.historyStrength !== null && second.edge.historyStrength !== null
            ? (((first.edge.historyStrength / 100) * second.edge.historyStrength) / 100) *
              (fit ?? 1)
            : null;
        paths.push({
          owner: owner.id,
          connector,
          target,
          legs: [first.edge, second.edge],
          relationshipStrength: first.edge.historyStrength,
          connectorToTargetStrength: second.edge.historyStrength,
          fitConfidence: fit,
          compositeWeight: composite,
          stale: first.edge.stale || second.edge.stale,
        });
      }
    }
  }
  paths.sort(
    (a, b) =>
      Number(a.stale) - Number(b.stale) ||
      (b.compositeWeight ?? -1) - (a.compositeWeight ?? -1) ||
      (b.relationshipStrength ?? -1) - (a.relationshipStrength ?? -1) ||
      (b.fitConfidence ?? -1) - (a.fitConfidence ?? -1) ||
      a.connector.id.localeCompare(b.connector.id) ||
      a.target.id.localeCompare(b.target.id) ||
      a.owner.localeCompare(b.owner)
  );
  return {
    query,
    targets,
    paths: paths.slice(0, limit),
    totalPaths: paths.length,
    ranking:
      "Measured composite weight when available; otherwise owner-to-connector history strength, then target fit. Unknown strengths remain null.",
    coverage: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      excludedStaleEdges: opts.includeStale ? 0 : graph.edges.filter((e) => e.stale).length,
    },
    warnings: [
      ...graph.warnings,
      "Observed connections do not establish willingness to introduce. Absence of an edge is not proof of no relationship.",
    ],
  };
}
