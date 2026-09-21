import { access, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionsNeoCommand } from "@/commands/connections-neo.js";
import { readNeoConnections } from "@/linkedin/auth/neo-mcp.js";
import { Store } from "@/store/index.js";

vi.mock("@/linkedin/auth/neo-mcp.js", () => ({ readNeoConnections: vi.fn() }));
vi.mock("@/utils/output.js", () => ({
  printData: vi.fn(),
  emitEvent: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}));
const snapshot = {
  owner: { profileId: "ACoOwner", profileSlug: "test-owner", name: "Test Owner" },
  page: {
    isLastPage: false,
    pageSize: 1,
    records: [
      {
        memberUrn: "urn:li:fsd_profile:ACoFriend",
        publicIdentifier: "test-friend",
        firstName: "Test",
        lastName: "Friend",
        headline: "Tester",
        connectedAt: null,
        profilePictureUrl: null,
        memorialized: false,
        connectionUrn: null,
      },
    ],
  },
  shield: { id: "test", version: "3.4.0", rulesets: ["linkedin_blocklist"] },
};
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-neo-command-"));
  vi.stubEnv("ALLMAN_ACCOUNT", "");
  vi.mocked(readNeoConnections).mockResolvedValue(structuredClone(snapshot));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("connections via Neo MCP", () => {
  it("creates a private store and owner without storing browser credentials", async () => {
    const path = join(root, "store");
    await connectionsNeoCommand({
      browserosMcp: "http://127.0.0.1:9010/mcp",
      store: path,
      limit: 1,
    });
    const store = new Store({ path });
    expect((await store.accounts.readAuth("ACoOwner"))?.status).toBe("unauthenticated");
    expect(await store.accounts.resolveId("test-owner")).toBe("ACoOwner");
    expect(await store.connectionsFor("ACoOwner").listConnectionIds()).toHaveLength(1);
    await expect(access(join(path, "ACoOwner", "COOKIES.json"))).rejects.toThrow();
    expect((await stat(path)).mode & 0o777).toBe(0o700);
  });
  it("passes stored identity for browser account verification on later batches", async () => {
    const options = {
      browserosMcp: "http://127.0.0.1:9010/mcp",
      store: join(root, "store"),
      limit: 1,
    };
    await connectionsNeoCommand(options);
    await connectionsNeoCommand({ ...options, account: "test-owner", start: 1 });
    expect(readNeoConnections).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedProfileId: "ACoOwner", start: 1 })
    );
    expect(
      await new Store({ path: options.store }).connectionsFor("ACoOwner").listConnectionIds()
    ).toHaveLength(1);
  });
  it("keeps JSON exports ephemeral", async () => {
    const path = join(root, "absent");
    await connectionsNeoCommand({
      browserosMcp: "http://127.0.0.1:9010/mcp",
      store: path,
      json: true,
    });
    await expect(access(path)).rejects.toThrow();
  });
  it("rejects unsupported enrichment before browser access", async () => {
    await expect(
      connectionsNeoCommand({ browserosMcp: "http://127.0.0.1:9010/mcp", enrich: true })
    ).rejects.toThrow("--enrich");
    expect(readNeoConnections).not.toHaveBeenCalled();
  });
});
