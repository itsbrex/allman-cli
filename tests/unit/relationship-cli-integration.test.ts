import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { storeGitEnvironment } from "@/store/git.js";
import { Store } from "@/store/index.js";
import { relationshipSnapshot } from "@/store/relationships.js";

const repository = resolve(import.meta.dirname, "../..");
it("runs groups, rank, ICP lifecycle and introductions through real CLI without network", async () => {
  const root = await mkdtemp(join(tmpdir(), "allman-intelligence-cli-")),
    privateRoot = join(root, "private"),
    source = join(root, "linkedin"),
    account = "ACoFixtureOwner",
    store = new Store({ path: source });
  vi.spyOn(store.git, "scheduleCommit").mockImplementation(() => {});
  const env = { ...storeGitEnvironment(), ALLMAN_RELATIONSHIP_STORE: privateRoot };
  const executable = process.env.ALLMAN_TEST_BINARY ?? "bun",
    prefix = process.env.ALLMAN_TEST_BINARY ? [] : ["src/index.ts"];
  const cli = (...args: string[]) =>
    JSON.parse(
      execFileSync(executable, [...prefix, "--store", source, "--json", ...args], {
        cwd: repository,
        env,
        encoding: "utf8",
      })
    );
  try {
    await store.accounts.writeAuth(account, {
      urn: `urn:li:fsd_profile:${account}`,
      profileSlug: "fixture-owner",
      name: "Fixture",
      headline: null,
      profileUrl: null,
      imageUrl: null,
      userType: null,
      networkSize: null,
      status: "unauthenticated",
      lastSyncAt: null,
    });
    const now = new Date().toISOString(),
      connections = store.connectionsFor(account);
    for (const [id, title, kind] of [
      ["ACoConnector", "Advisor", "connections"],
      ["ACoTarget", "CFO", "enrich"],
    ] as const) {
      await connections.upsertConnection(
        {
          flagshipId: id,
          memberUrn: `urn:li:fsd_profile:${id}`,
          publicIdentifier: id,
          firstName: id,
          source: kind,
        },
        now
      );
      await store.peopleFor(account).applyObservations(
        { flagshipId: id },
        {
          title: { value: title, provenance: { source: "user", observedAt: now } },
          company: { value: "Example", provenance: { source: "user", observedAt: now } },
        },
        now
      );
    }
    await connections.writeConnectionOfTarget("ACoTarget", {
      targetUrn: "urn:li:fsd_profile:ACoTarget",
      targetSlug: "target",
      backend: "flagship",
      total: 1,
      fetched: 1,
      capturedAt: now,
    });
    await connections.upsertConnectionOfResult(
      "ACoTarget",
      {
        memberUrn: "urn:li:fsd_profile:ACoConnector",
        memberId: null,
        salesnavId: null,
        publicIdentifier: "connector",
      },
      now
    );
    const snapshot = await relationshipSnapshot(store, privateRoot),
      target = snapshot.contacts.find((c) => c.linkedin.some((l) => l.flagshipId === "ACoTarget"));
    if (!target) throw new Error("Missing fixture target");
    const definition = join(root, "definition.json");
    await writeFile(
      definition,
      JSON.stringify({
        name: "Fixture",
        description: "CFO",
        criteria: [
          {
            id: "role",
            description: "CFO",
            field: "title",
            operator: "equals-any",
            values: ["CFO"],
          },
        ],
      })
    );
    expect(cli("icp", "define", "fixture", "--file", definition).version).toBe(1);
    cli("relationships", "tag", target.id, "buyer");
    cli(
      "group",
      "set",
      "Fixture buyers",
      "--icp",
      "fixture",
      "--all-tags",
      "buyer",
      "--min-rank",
      "0",
      "--sort",
      "rank"
    );
    expect(cli("group", "show", "Fixture buyers")).toHaveLength(0);
    expect(cli("icp", "qualify", "fixture").written).toBe(2);
    expect(
      cli("relationships", "list", "--list", "Fixture buyers", "--company", "Example")
    ).toHaveLength(1);
    expect(
      cli("rank", target.id, "--set", "80", "--pin", "--reason", "Fixture override")[0].rank
    ).toMatchObject({ score: 80, derivedScore: 0, pinned: true });
    const shown = cli("contact", "show", target.id);
    expect(shown.contact.qualifications.fixture).toMatchObject({
      match: true,
      freshness: "fresh",
      method: "rules",
    });
    const handoff = cli("icp", "export", "fixture", "--contact", target.id);
    expect(handoff.contacts).toBe(1);
    expect((await stat(handoff.path)).mode & 0o777).toBe(0o600);
    const payload = JSON.parse(await readFile(handoff.path, "utf8"));
    expect(payload.contacts[0].facts.length).toBeGreaterThan(0);
    const imported = join(root, "import.json");
    await writeFile(
      imported,
      JSON.stringify({
        schemaVersion: 1,
        icpId: "fixture",
        icpVersion: 1,
        qualifications: [{ ...shown.contact.qualifications.fixture, confidence: 0.85 }],
      })
    );
    expect(cli("icp", "import", "fixture", "--file", imported).written).toBe(1);
    const paths = cli("intro-to", target.id, "--icp", "fixture");
    expect(paths.totalPaths).toBe(1);
    expect(paths.paths[0].legs).toHaveLength(2);
    expect(paths.paths[0].compositeWeight).toBeNull();
    const changedAt = new Date().toISOString();
    await store
      .peopleFor(account)
      .applyObservations(
        { flagshipId: "ACoTarget" },
        { title: { value: "Director", provenance: { source: "user", observedAt: changedAt } } },
        changedAt
      );
    expect(cli("relationships", "list", "--icp", "fixture", "--fit", "stale")).toHaveLength(1);
    const before = await readFile(join(privateRoot, "icp/qualifications.json"), "utf8");
    const rejected = spawnSync(
      executable,
      [...prefix, "--store", source, "--json", "icp", "import", "fixture", "--file", imported],
      { cwd: repository, env, encoding: "utf8" }
    );
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("stale evidence fingerprint");
    expect(await readFile(join(privateRoot, "icp/qualifications.json"), "utf8")).toBe(before);
    cli(
      "icp",
      "override",
      "fixture",
      "--contact",
      target.id,
      "--match",
      "yes",
      "--reason",
      "Fixture review"
    );
    expect(cli("icp", "qualify", "fixture").preservedOverrides).toBe(1);
    cli(
      "icp",
      "override",
      "fixture",
      "--contact",
      target.id,
      "--clear",
      "--reason",
      "Return to rules"
    );
    expect(cli("contact", "show", target.id).contact.qualifications.fixture).toMatchObject({
      match: false,
      method: "rules",
    });
    const invalid = spawnSync(
      executable,
      [...prefix, "--store", source, "relationships", "list", "--min-rank", "NaN"],
      { cwd: repository, env, encoding: "utf8" }
    );
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("--min-rank");
  } finally {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
