/**
 * `allman connections --geo` — the local structured-geo query (ADR-0001).
 *
 * Runs against a real temp store (records written through the real stores).
 * The whole point of the query is that it never touches the network, so no
 * session or API client is mocked — a network call would simply crash.
 * All ids/slugs are synthetic.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsStore } from "@/store/connections-store.js";
import type { StoreGit } from "@/store/git.js";
import { observationsFrom, PeopleStore } from "@/store/people.js";

const h = vi.hoisted(() => ({
  out: {
    errors: [] as string[],
    successes: [] as string[],
    infos: [] as string[],
    warns: [] as string[],
    events: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("@/utils/output.js", () => ({
  error: (m: string) => h.out.errors.push(m),
  success: (m: string) => h.out.successes.push(m),
  info: (m: string) => h.out.infos.push(m),
  warn: (m: string) => h.out.warns.push(m),
  debug: () => {},
  printData: () => {},
  emitEvent: (e: Record<string, unknown>) => h.out.events.push(e),
  setJsonMode: () => {},
  setDebugMode: () => {},
}));

import { connectionsGeoQuery } from "@/commands/connections-geo.js";

const FAKE_GIT = { scheduleCommit: () => {} } as unknown as StoreGit;
const SELF = "ACoSYNTHSELF00000000000000000000000000";
const ID_METRO = "ACoAAB0000000000000000000000000000000001";
const ID_COUNTRY = "ACoAAB0000000000000000000000000000000002";
const ID_BARE = "ACoAAB0000000000000000000000000000000003";
const GEO_METRO = "urn:li:fsd_geo:90000064";
const GEO_COUNTRY = "urn:li:fsd_geo:103644278";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-geo-"));
  const accountDir = join(root, SELF);
  const connections = new ConnectionsStore(accountDir, FAKE_GIT);
  const people = new PeopleStore(accountDir, FAKE_GIT);

  await connections.upsertConnection(
    {
      memberUrn: `urn:li:fsd_profile:${ID_BARE}`,
      flagshipId: ID_BARE,
      publicIdentifier: "bare-user",
      firstName: "Bare",
      lastName: "User",
      headline: null,
    },
    "2026-06-01T00:00:00.000Z"
  );
  await writeFile(
    join(accountDir, "AUTH.json"),
    `${JSON.stringify({ status: "authenticated", urn: `urn:li:fsd_profile:${SELF}` })}\n`,
    "utf8"
  );

  // One metro person (via a people/ record), one country person (mirror only).
  await people.applyObservations(
    { flagshipId: ID_METRO },
    observationsFrom(
      {
        publicIdentifier: "metro-user",
        firstName: "Metro",
        lastName: "User",
        title: "Engineer",
        company: "Austin Co",
        location: "Austin, Texas Metropolitan Area",
        geoUrn: GEO_METRO,
        geoName: "Austin, Texas Metropolitan Area",
        geoGranularity: "metro",
      },
      { source: "linkedin/enrich-core", observedAt: "2026-06-01T00:00:00.000Z" }
    ),
    "2026-06-01T00:00:00.000Z"
  );
  await connections.upsertConnection(
    {
      memberUrn: `urn:li:fsd_profile:${ID_COUNTRY}`,
      flagshipId: ID_COUNTRY,
      publicIdentifier: "country-user",
      firstName: "Country",
      lastName: "User",
      headline: null,
      geoUrn: GEO_COUNTRY,
      geoName: "United States",
      geoGranularity: "country",
    },
    "2026-06-01T00:00:00.000Z"
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  for (const k of Object.keys(h.out) as Array<keyof typeof h.out>) h.out[k].length = 0;
});

describe("connections --geo", () => {
  it("matches by geo-name substring, case-insensitively, and reports coverage", async () => {
    await connectionsGeoQuery({ store: root, geo: ["austin"], json: true });
    expect(h.out.events).toHaveLength(1);
    expect(h.out.events[0]).toMatchObject({
      flagshipId: ID_METRO,
      geoUrn: GEO_METRO,
      geoName: "Austin, Texas Metropolitan Area",
      geoGranularity: "metro",
    });
    // 2 of 3 records carry structured geo — sparse data must be visible.
    expect(h.out.successes.join(" ")).toContain("Geo coverage: 2 structured / 3 total");
  });

  it("matches a urn:li:fsd_geo urn exactly", async () => {
    await connectionsGeoQuery({ store: root, geo: [GEO_COUNTRY], json: true });
    expect(h.out.events).toHaveLength(1);
    expect(h.out.events[0]?.flagshipId).toBe(ID_COUNTRY);
  });

  it("ORs repeated --geo filters", async () => {
    await connectionsGeoQuery({ store: root, geo: ["austin", GEO_COUNTRY], json: true });
    expect(h.out.events.map((e) => e.flagshipId).sort()).toEqual([ID_METRO, ID_COUNTRY]);
  });

  it("filters by granularity, treating stamp-less records as unknown", async () => {
    await connectionsGeoQuery({ store: root, geo: [], granularity: "country", json: true });
    expect(h.out.events.map((e) => e.flagshipId)).toEqual([ID_COUNTRY]);

    h.out.events.length = 0;
    await connectionsGeoQuery({ store: root, geo: [], granularity: "unknown", json: true });
    expect(h.out.events.map((e) => e.flagshipId)).toEqual([ID_BARE]);
  });

  it("rejects a bogus granularity", async () => {
    await connectionsGeoQuery({ store: root, geo: [], granularity: "city", json: true });
    expect(h.out.errors.join(" ")).toContain("--geo-granularity must be one of");
    expect(h.out.events).toHaveLength(0);
  });
});
