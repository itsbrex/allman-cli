import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { writePrivate } from "../../src/store/private-workspace.js";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  session: vi.fn(),
  begin: vi.fn(),
  output: vi.fn(),
}));
vi.mock("../../src/linkedin/api/session.js", () => ({ loadSession: mocks.session }));
vi.mock("../../src/linkedin/session-control.js", () => ({
  canonicalPath: (s: string) => s,
  assertActiveProfile: vi.fn(),
  beginLinkedInCommand: mocks.begin,
}));
vi.mock("../../src/utils/output.js", () => ({ printData: mocks.output }));
vi.mock("../../src/store/index.js", () => ({
  resolveStorePath: () => "/fixture-store",
  Store: class {
    root = "/fixture-store";
    accounts = { getDefault: async () => "jp", readAuth: async () => ({ name: "JP" }) };
    connectionsFor() {
      return { listConnectionIds: async () => [] };
    }
  },
}));

import { enrichListCommand } from "../../src/commands/enrich-list.js";

let root: string;
const url = "https://www.linkedin.com/sales/lists/people/123";
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), "allman-import-"));
  vi.stubEnv("ALLMAN_RELATIONSHIP_STORE", root);
  mocks.begin.mockResolvedValue(vi.fn());
  mocks.session.mockResolvedValue({ profileId: "jp", apiClient: { request: mocks.request } });
  mocks.request.mockImplementation(async ({ url }: { url: string }) => {
    if (!url.includes("salesApiPeopleSearch?")) throw new Error("Unexpected identity request");
    return {
      paging: { start: 0, total: 1 },
      metadata: {
        pivot: {
          "com.linkedin.sales.search.ListPivotResponse": { name: "Clients", totalCount: 1 },
        },
      },
      elements: [
        {
          entityUrn: "urn:li:fs_salesProfile:(ACw000000000001,NAME_SEARCH,token)",
          fullName: "=Person",
          currentPositions: [],
        },
      ],
    };
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
it("prepares without mapping requests, saves all rows privately, and reimports offline", async () => {
  await enrichListCommand("prepare", url, {});
  expect(mocks.request).toHaveBeenCalledTimes(1);
  const result = mocks.output.mock.calls[0]?.[0];
  expect(result).toMatchObject({ imported: 1, identitiesDeferred: 1, selected: 0 });
  const imported = JSON.parse(await readFile(result.importPath, "utf8"));
  expect(imported.list.leads[0].raw.fullName).toBe("=Person");
  expect(await readFile(result.csvPath, "utf8")).toContain("'=Person");
  expect((await stat(result.importPath)).mode & 0o777).toBe(0o600);
  await enrichListCommand("prepare", url, { import: result.importPath });
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.session).toHaveBeenCalledTimes(1);
});
it("retains import even when a malformed cache blocks matching, and history skips incomplete plans", async () => {
  const path = join(root, "target-enrichment/jp");
  await writePrivate(join(path, "salesnav-identities.json"), {
    version: 1,
    account: "brian",
    mappings: {},
  });
  await expect(enrichListCommand("prepare", url, {})).rejects.toThrow("account-scoped");
  const dirs = await readdir(path, { withFileTypes: true });
  const run = dirs.find((d) => d.isDirectory());
  const imported = JSON.parse(await readFile(join(path, run?.name ?? "", "import.json"), "utf8"));
  expect(imported.list.leads).toHaveLength(1);
  expect(mocks.request).toHaveBeenCalledTimes(1);
  await enrichListCommand("history", undefined, {});
  expect(mocks.output).toHaveBeenLastCalledWith([]);
});
it("rejects cross-account saved imports without opening a session", async () => {
  const file = join(root, "import.json");
  await writePrivate(file, {
    version: 1,
    account: "brian",
    store: "/fixture-store",
    list: { url, id: "123" },
  });
  await expect(enrichListCommand("prepare", url, { import: file })).rejects.toThrow(
    "different source, account or store"
  );
  expect(mocks.session).not.toHaveBeenCalled();
});
