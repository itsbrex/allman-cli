import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AttioListSource,
  type TargetSnapshot,
  validateTargetSnapshot,
} from "../../src/attio/lists.js";
import {
  type EnrichmentPlan,
  matchTargets,
  planHash,
  reviewTargets,
} from "../../src/attio/target-matches.js";
import { runTargets } from "../../src/attio/target-runner.js";
import { readTargetPlan } from "../../src/commands/enrich-list.js";
import type { StoredConnection } from "../../src/store/connections-store.js";
import { writePrivate } from "../../src/store/private-workspace.js";

const id = "ACoAAAAAAAAAAAA",
  other = "ACoBBBBBBBBBBBB";
const row = (flagshipId = id, extra = {}) =>
  ({
    flagshipId,
    publicIdentifier: "person-one",
    memberUrn: `urn:li:fsd_profile:${flagshipId}`,
    source: "connections",
    ...extra,
  }) as StoredConnection;
const snapshot = (): TargetSnapshot => ({
  version: 1,
  complete: true,
  observedAt: "2026-09-23T00:00:00Z",
  list: { id: "list", name: "Targets" },
  companies: [{ id: "company", name: "Target Inc", linkedinIds: ["123"], urls: [], domains: [] }],
  people: [
    {
      id: "p1",
      name: "Person",
      companies: ["company"],
      urls: ["https://www.linkedin.com/in/person-one/"],
      urns: [],
      handles: [],
      left: false,
    },
  ],
});
const plan = (): EnrichmentPlan => ({
  version: 1,
  id: "run",
  preparedAt: "2026-09-23",
  store: "/store",
  account: "account",
  accountName: "Account",
  snapshot: snapshot(),
  ...matchTargets(snapshot(), [row()]),
});
const firstPerson = (s: TargetSnapshot) => {
  const person = s.people[0];
  if (!person) throw new Error("Missing fixture person");
  return person;
};
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("account-scoped shortlist", () => {
  it("deduplicates Attio people and resolves exact URLs and aliases", () => {
    const s = snapshot();
    s.people.push({ ...firstPerson(s), id: "p2", urls: [], handles: ["person-one"] });
    const result = matchTargets(s, [row(), row(other, { publicIdentifier: "irrelevant" })]);
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.personIds).toEqual(["p1", "p2"]);
  });
  it("rejects stale identity conflicts, ad-hoc profiles, and left-company records", () => {
    const s = snapshot();
    firstPerson(s).urns = [`urn:li:fsd_profile:${other}`];
    expect(matchTargets(s, [row()]).matches[0]?.outcome).toBe("identity-conflict");
    firstPerson(s).urns = [];
    firstPerson(s).left = true;
    expect(matchTargets(s, [row()]).targets).toEqual([]);
    firstPerson(s).left = false;
    expect(matchTargets(s, [row(id, { source: "enrich" })]).targets).toEqual([]);
  });
  it("does not use names or headlines as automatic identity matches", () => {
    const s = snapshot();
    firstPerson(s).urls = [];
    expect(
      matchTargets(s, [row(id, { headline: "Person at Target Inc" })]).matches[0]?.outcome
    ).toBe("missing-identity");
  });
  it("checks every current position and distinguishes evidence from hints", () => {
    const p = plan();
    const report = reviewTargets(p, [
      row(id, {
        company: "Board Company",
        companyUrn: "urn:li:fsd_company:9",
        positions: [{ current: true, company: "Target Inc", companyUrn: "urn:li:fsd_company:123" }],
        enrichDepth: "deep",
        enrichedAt: "2026-09-23",
      }),
      row(other, { publicIdentifier: "other", headline: "VP at Target Inc" }),
    ]);
    expect(report.profiles[0]?.employer).toBe("same-company-id");
    expect(report.hints).toHaveLength(1);
    expect(report.hints[0]?.selected).toBe(false);
  });
  it("requires complete snapshots and rejects a run from another account", async () => {
    expect(() => validateTargetSnapshot({ ...snapshot(), complete: false })).toThrow();
    const root = await mkdtemp(join(tmpdir(), "target-plan-"));
    dirs.push(root);
    const p = plan();
    await writePrivate(join(root, "run/plan.json"), { plan: p, hash: planHash(p) });
    await expect(readTargetPlan(root, "run", "wrong", "/store")).rejects.toThrow(
      "different account"
    );
    await expect(readTargetPlan(root, "../run", "account", "/store")).rejects.toThrow(
      "Invalid run"
    );
    await writePrivate(join(root, "run/plan.json"), {
      plan: { ...p, account: "wrong" },
      hash: planHash(p),
    });
    await expect(readTargetPlan(root, "run", "wrong", "/store")).rejects.toThrow("modified");
  });
});

describe("sequential shared-session queue", () => {
  it("skips saved rows, paces only between fetches, respects limit", async () => {
    const events: string[] = [];
    const targets = ["saved", "one", "two", "three"].map((flagshipId) => ({
      flagshipId,
      name: flagshipId,
      personIds: [],
      companyIds: [],
      methods: [],
    }));
    const status = await runTargets(targets, {
      read: async (key) =>
        row(key, key === "saved" ? { enrichDepth: "deep", enrichedAt: "now" } : {}),
      stopped: () => false,
      skip: async (t) => {
        events.push(`skip:${t.flagshipId}`);
      },
      fetch: async (t) => {
        events.push(t.flagshipId);
      },
      pace: async () => {
        events.push("pace");
      },
      limit: 2,
    });
    expect(events).toEqual(["skip:saved", "one", "pace", "two"]);
    expect(status).toBe("limited");
  });
  it("stops immediately on failure and never reaches a later person", async () => {
    const events: string[] = [],
      targets = ["one", "two"].map((flagshipId) => ({
        flagshipId,
        name: flagshipId,
        personIds: [],
        companyIds: [],
        methods: [],
      }));
    await expect(
      runTargets(targets, {
        read: async (key) => row(key),
        stopped: () => false,
        skip: async () => {},
        pace: async () => {},
        fetch: async (t) => {
          events.push(t.flagshipId);
          throw new Error("429");
        },
      })
    ).rejects.toThrow("429");
    expect(events).toEqual(["one"]);
  });
  it("honors interruption during pacing before making the next request", async () => {
    let stopped = false;
    const events: string[] = [];
    const targets = ["one", "two"].map((flagshipId) => ({
      flagshipId,
      name: flagshipId,
      personIds: [],
      companyIds: [],
      methods: [],
    }));
    await expect(
      runTargets(targets, {
        read: async (key) => row(key),
        stopped: () => stopped,
        skip: async () => {},
        pace: async () => {
          stopped = true;
        },
        fetch: async (t) => {
          events.push(t.flagshipId);
        },
      })
    ).rejects.toThrow("safe boundary");
    expect(events).toEqual(["one"]);
  });
});

it("paginates Attio reads and splits company constraints into batches of 50", async () => {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const ids = Array.from({ length: 101 }, (_, i) => `c${i}`);
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input),
      body = JSON.parse(String(init?.body || "{}"));
    calls.push({ path, body });
    let data: unknown[] = [];
    if (path.endsWith("/lists"))
      data = [{ id: { list_id: "list" }, name: "Targets", parent_object: ["companies"] }];
    if (path.includes("entries/query"))
      data = ids
        .slice(body.offset, body.offset + body.limit)
        .map((id) => ({ parent_object: "companies", parent_record_id: id }));
    if (path.includes("companies/records/query"))
      data = body.filter.record_id.$in.map((id: string) => ({
        id: { record_id: id },
        values: { name: [{ value: id }] },
      }));
    return new Response(JSON.stringify({ data }));
  }) as typeof fetch;
  const result = await new AttioListSource("private", fetcher).snapshot("list");
  expect(result.companies).toHaveLength(101);
  expect(
    calls
      .filter((c) => c.path.includes("companies/records/query"))
      .map((c) => (c.body.filter as { record_id: { $in: string[] } }).record_id.$in.length)
  ).toEqual([50, 50, 1]);
  expect(calls.filter((c) => c.path.includes("entries/query")).map((c) => c.body.offset)).toEqual([
    0, 100,
  ]);
});

it("retains official Attio URLs, links current company IDs, and keeps scope sealed", () => {
  const p = plan();
  const links = snapshot();
  links.people[0] = { ...firstPerson(links), webUrl: "https://app.attio.com/example/person/p1" };
  const company = links.companies[0];
  if (!company) throw new Error("Missing fixture company");
  company.webUrl = "https://app.attio.com/example/company/company";
  company.domains = ["target.example"];
  const report = reviewTargets(
    p,
    [row(id, { company: "New Company", companyUrn: "urn:li:fsd_company:456" })],
    links
  );
  expect(report.profiles[0]?.attioUrls).toEqual(["https://app.attio.com/example/person/p1"]);
  expect(report.profiles[0]?.companyEntities[0]).toMatchObject({
    attioUrl: company.webUrl,
    linkedinUrl: "https://www.linkedin.com/company/123/",
    website: "https://target.example",
  });
  expect(report.profiles[0]?.currentEntities[0]).toEqual({
    name: "New Company",
    linkedinUrl: "https://www.linkedin.com/company/456/",
  });
  expect(report.summary.selected).toBe(1);
  expect(p.snapshot.companies[0]?.webUrl).toBeUndefined();
});
