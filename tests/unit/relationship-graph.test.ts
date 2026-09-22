import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildObservedGraph, introductionPaths } from "@/relationships/graph.js";
import { Store } from "@/store/index.js";
import { writePrivate } from "@/store/private-workspace.js";
import type { RelationshipSnapshot, TimelineEvent } from "@/store/relationships.js";

const now = Date.parse("2026-09-22T00:00:00Z"),
  iso = new Date(now).toISOString(),
  account = "ACoOwner";
let root: string, store: Store;
const snapshot = {
  contacts: [
    {
      id: "connector",
      name: "Same Name",
      emails: [],
      tags: [],
      linkedin: [{ account, flagshipId: "ACoConnector" }],
    },
    {
      id: "target",
      name: "Target",
      company: "Example",
      facts: [{ field: "title", value: "Founder" }],
      emails: [],
      tags: [],
      linkedin: [{ account, flagshipId: "ACoTarget" }],
    },
    {
      id: "impostor",
      name: "Same Name",
      emails: [],
      tags: [],
      linkedin: [{ account, flagshipId: "ACoImpostor" }],
    },
  ],
  timeline: [],
} as unknown as RelationshipSnapshot;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-graph-"));
  store = new Store({ path: root });
  vi.spyOn(store.accounts, "list").mockResolvedValue([account]);
  const connections = store.connectionsFor(account);
  for (const [id, source, memberId] of [
    ["ACoConnector", "connections", "42"],
    ["ACoTarget", "enrich", "99"],
    ["ACoImpostor", "enrich", "50"],
  ] as const)
    await connections.upsertConnection(
      {
        flagshipId: id,
        memberUrn: `urn:li:fsd_profile:${id}`,
        publicIdentifier: id,
        source,
        memberId,
      },
      iso
    );
  await connections.writeConnectionOfTarget("ACoTarget", {
    targetUrn: "urn:li:fsd_profile:ACoTarget",
    targetSlug: "target",
    backend: "salesnav",
    total: 1,
    fetched: 1,
    capturedAt: iso,
  });
  await connections.upsertConnectionOfResult(
    "ACoTarget",
    {
      salesnavId: "ACwConnector",
      memberId: "42",
      memberUrn: "urn:li:member:42",
      publicIdentifier: "connector",
      fullName: "Same Name",
    },
    iso
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
it("traverses observed first-degree and numeric-bridged connections-of evidence", async () => {
  const graph = await buildObservedGraph(store, snapshot, { now });
  const results = introductionPaths(graph, "founder of Example", snapshot);
  expect(results.paths).toHaveLength(1);
  expect(results.paths[0]).toMatchObject({
    connector: { contactId: "connector" },
    target: { contactId: "target" },
    connectorToTargetStrength: null,
    compositeWeight: null,
  });
  expect(results.paths[0]?.legs[0].evidence[0]?.kind).toBe("first-degree");
  expect(results.paths[0]?.legs[1].evidence[0]?.kind).toBe("connections-of");
  expect(graph.edges.some((e) => [e.a, e.b].includes("contact:impostor"))).toBe(false);
});
it("does not claim current paths from stale edges without opt-in", async () => {
  await store.connectionsFor(account).upsertConnectionOfResult(
    "ACoTarget",
    {
      salesnavId: null,
      memberId: "42",
      memberUrn: "urn:li:member:42",
      publicIdentifier: "connector",
    },
    new Date(now - 91 * 86400000).toISOString()
  );
  const graph = await buildObservedGraph(store, snapshot, { now });
  expect(introductionPaths(graph, "Target", snapshot).paths).toHaveLength(0);
  expect(introductionPaths(graph, "Target", snapshot, { includeStale: true }).paths[0]?.stale).toBe(
    true
  );
});
it("keeps ambiguous numeric bridges separate instead of merging same-name contacts", async () => {
  await store
    .connectionsFor(account)
    .enrichConnection("ACoImpostor", { memberId: "42" }, "core", iso);
  const graph = await buildObservedGraph(store, snapshot, { now });
  expect(introductionPaths(graph, "Target", snapshot).paths).toHaveLength(0);
  expect(graph.warnings.some((w) => w.includes("Ambiguous numeric"))).toBe(true);
  expect(graph.nodes.some((n) => n.namespace === "member")).toBe(true);
});
it("never creates peer relationships from group email", async () => {
  const event: TimelineEvent = {
    id: "group-in",
    thread: "group",
    channel: "email",
    account: "mail",
    contactIds: ["connector", "target"],
    timestamp: now,
    direction: "inbound",
    subject: "",
    body: "",
    source: "",
    references: [],
    eligible: true,
    direct: false,
    coverage: "partial",
  };
  const graph = await buildObservedGraph(
    store,
    { ...snapshot, timeline: [event, { ...event, id: "group-out", direction: "outbound" }] },
    { now }
  );
  expect(graph.edges.flatMap((e) => e.evidence).some((e) => e.kind === "reciprocal-history")).toBe(
    false
  );
});
it("rejects contradictory strong identities rather than inventing an edge", async () => {
  await store.connectionsFor(account).upsertConnectionOfResult(
    "ACoTarget",
    {
      salesnavId: null,
      memberId: "42",
      memberUrn: "urn:li:fsd_profile:ACoImpostor",
      publicIdentifier: "impostor",
    },
    iso
  );
  const graph = await buildObservedGraph(store, snapshot, { now });
  expect(introductionPaths(graph, "Target", snapshot).paths).toHaveLength(0);
  expect(graph.warnings.some((w) => w.includes("Conflicting identifiers"))).toBe(true);
});

it("enrichment does not refresh connection evidence", async () => {
  const connections = store.connectionsFor(account),
    old = new Date(now - 91 * 86400000).toISOString();
  await connections.upsertConnection(
    {
      flagshipId: "ACoConnector",
      memberUrn: "urn:li:fsd_profile:ACoConnector",
      publicIdentifier: "connector",
      source: "connections",
    },
    old
  );
  await connections.upsertConnection(
    {
      flagshipId: "ACoConnector",
      memberUrn: "urn:li:fsd_profile:ACoConnector",
      publicIdentifier: "connector",
      source: "enrich",
    },
    iso
  );
  await connections.enrichConnection("ACoConnector", { title: "New role" }, "core", iso);
  const graph = await buildObservedGraph(store, snapshot, { now });
  expect(introductionPaths(graph, "Target", snapshot).paths).toHaveLength(0);
  expect((await connections.readConnection("ACoConnector"))?.connectionObservedAt).toBe(old);
});

it("uses Sales Navigator degree-one evidence without fabricating flagship joins", async () => {
  for (const [memberId, degree] of [
    ["111", 1],
    ["112", 2],
  ] as const)
    await writePrivate(join(root, account, "connections-salesnav", `${memberId}.json`), {
      memberId,
      memberUrn: `urn:li:member:${memberId}`,
      salesnavId: `ACw${memberId}`,
      degree,
      fullName: "Unjoined person",
      lastSeenAt: iso,
    });
  await store.connectionsFor(account).upsertConnectionOfResult(
    "ACoTarget",
    {
      memberId: "111",
      memberUrn: "urn:li:member:111",
      salesnavId: "ACw111",
      publicIdentifier: null,
    },
    iso
  );
  const graph = await buildObservedGraph(store, snapshot, { now });
  const paths = introductionPaths(graph, "Target", snapshot).paths;
  expect(
    paths.some((p) => p.connector.namespace === "member" && p.connector.id.endsWith("/111"))
  ).toBe(true);
  expect(graph.edges.some((e) => e.a.endsWith("/112") || e.b.endsWith("/112"))).toBe(false);
});
