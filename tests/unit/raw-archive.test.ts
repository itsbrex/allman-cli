import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import axios from "axios";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LinkedInApiClient } from "@/linkedin/api/client.js";
import { Store } from "@/store/index.js";
import { archiveRaw, rawCaptureEnabled, setRawCapture } from "@/store/raw-archive.js";
import type { AccountRecord } from "@/store/types.js";

vi.mock("axios", () => ({ default: vi.fn() }));
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-raw-"));
});
afterEach(async () => {
  setRawCapture(undefined);
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});
it("preserves distinct raw versions and reuses identical evidence without overwrite", async () => {
  const a = await archiveRaw(root, "account", "profile/A", { first: 1 }, "2026-01-01");
  const b = await archiveRaw(root, "account", "profile/A", { first: 2 });
  expect(a).not.toBe(b);
  expect(await archiveRaw(root, "account", "profile/A", { first: 1 }, "2026-09-01")).toBe(a);
  expect(JSON.parse(await readFile(a, "utf8"))).toMatchObject({
    observedAt: "2026-01-01",
    payload: { first: 1 },
  });
  expect((await stat(a)).mode & 0o777).toBe(0o600);
});
it("honors raw environment and explicit overrides, rejecting invalid values", () => {
  vi.stubEnv("ALLMAN_RAW", "yes");
  expect(rawCaptureEnabled()).toBe(true);
  setRawCapture(false);
  expect(rawCaptureEnabled()).toBe(false);
  setRawCapture(undefined);
  vi.stubEnv("ALLMAN_RAW", "typo");
  expect(() => rawCaptureEnabled()).toThrow();
});
it("archives each API page before returning, without request credentials or headers", async () => {
  const client = new LinkedInApiClient({ account: { cookieJar: null } as AccountRecord });
  client.setRawArchive(root, "account");
  vi.mocked(axios).mockResolvedValue({
    status: 200,
    headers: { authorization: "secret-response" },
    data: { raw: [1, 2] },
  });
  for (const start of ["0", "100"])
    await client.request({
      method: "GET",
      url: "https://www.linkedin.com/voyager/api/fixture",
      params: { start },
      headers: { authorization: "secret-request" },
    });
  const accounts = await readdir(join(root, "raw"));
  const files = await readdir(join(root, "raw", accounts[0] ?? ""));
  expect(files).toHaveLength(2);
  for (const file of files) {
    const value = await readFile(join(root, "raw", accounts[0] ?? "", file), "utf8");
    expect(value).not.toContain("secret-");
    expect(JSON.parse(value).payload.data).toEqual({ raw: [1, 2] });
  }
});

it("keeps prior raw revisions and deep coverage through later core and non-raw updates", async () => {
  const workspace = join(root, "private");
  vi.stubEnv("ALLMAN_RELATIONSHIP_STORE", workspace);
  const connections = new Store({ path: join(root, "store") }).connectionsFor("ACoOwner");
  const oldRaw = {
    profile: { version: "old", extra: "preserve me" },
    positions: [],
    educations: [],
    skills: [],
  };
  const newRaw = { ...oldRaw, profile: { version: "new", extra: "preserve me too" } };
  await connections.upsertConnection(
    {
      flagshipId: "ACoPerson",
      memberUrn: "urn:li:fsd_profile:ACoPerson",
      publicIdentifier: "fixture",
      firstName: "Fixture",
      lastName: "Person",
      headline: null,
      connectedAt: null,
      raw: oldRaw,
      enrichedAt: "2026-01-01T00:00:00Z",
      enrichDepth: "deep",
    },
    "2026-01-01T00:00:00Z"
  );
  await connections.enrichConnection("ACoPerson", { raw: newRaw }, "core", "2026-02-01T00:00:00Z");
  await connections.enrichConnection(
    "ACoPerson",
    { raw: null, title: "Updated" },
    "core",
    "2026-03-01T00:00:00Z"
  );
  expect(await connections.readConnection("ACoPerson")).toMatchObject({
    raw: newRaw,
    enrichDepth: "deep",
    title: "Updated",
  });
  const accounts = await readdir(join(workspace, "raw"));
  const files = await readdir(join(workspace, "raw", accounts[0] ?? ""));
  expect(files).toHaveLength(2);
  const revisions = await Promise.all(
    files.map(
      async (f) =>
        JSON.parse(await readFile(join(workspace, "raw", accounts[0] ?? "", f), "utf8")).payload
          .profile.version
    )
  );
  expect(revisions.sort()).toEqual(["new", "old"]);
});
