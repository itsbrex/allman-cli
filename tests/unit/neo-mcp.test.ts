import { createHash, webcrypto } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readNeoConnections } from "@/linkedin/auth/neo-mcp.js";

const h = vi.hoisted(() => ({
  browser: {} as Record<string, unknown>,
  closed: vi.fn(),
  calls: [] as string[],
  root: "",
  spill: false,
  outside: false,
  origin: "https://www.linkedin.com",
}));
vi.mock("node:os", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  homedir: () => h.root,
}));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = async () => {};
    close = h.closed;
    async callTool(input: { name: string; arguments: { code?: string } }) {
      if (input.name !== "run") return { content: [] };
      h.calls.push(input.arguments.code ?? "");
      try {
        const value = await runInNewContext(`(async () => {${input.arguments.code}})()`, {
          browser: h.browser,
        });
        return { structuredContent: { ok: true, value } };
      } catch (error) {
        return { isError: true, structuredContent: { ok: false, error: String(error) } };
      }
    }
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {},
}));
vi.mock("@/linkedin/auth/shield.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readShieldPackage: async () => ({
    extensionId: "test-shield",
    version: "3.4.0",
    popup: "popup.html",
    hashes: { "manifest.json": createHash("sha256").update("fixture").digest("hex") },
    rulesets: ["linkedin_blocklist"],
  }),
}));

const resources = new Set<string | number>();
const requests: Array<{ url: string; init: RequestInit }> = [];
let enabled: boolean;
let failFetch: boolean;
let incomplete: boolean;
let owner: string;
beforeEach(async () => {
  h.root = await mkdtemp(join(tmpdir(), "allman-neo-spill-"));
  h.spill = false;
  h.outside = false;
  h.origin = "https://www.linkedin.com";
  vi.clearAllMocks();
  h.calls.length = 0;
  resources.clear();
  requests.length = 0;
  enabled = true;
  failFetch = false;
  incomplete = false;
  owner = "ACoOwner";
  const chrome = {
    runtime: {
      id: "test-shield",
      getManifest: () => ({ name: "LinkedIn Shield", version: "3.4.0" }),
      getURL: (file: string) => `chrome-extension://test-shield/${file}`,
      sendMessage: async () => ({}),
    },
    declarativeNetRequest: {
      getEnabledRulesets: async () => (enabled ? ["linkedin_blocklist"] : []),
    },
    permissions: { contains: async () => true },
  };
  h.browser = {
    async cdp(method: string, params: { expression?: string; targetId?: string }) {
      if (method === "Target.createTarget") {
        resources.add("owned-target");
        return { targetId: "owned-target" };
      }
      if (method === "Target.attachToTarget") return { sessionId: "owned-session" };
      if (method === "Target.closeTarget") {
        resources.delete(params.targetId ?? "");
        return { success: true };
      }
      if (method === "Runtime.evaluate")
        return {
          result: {
            value: await runInNewContext(params.expression ?? "", {
              chrome,
              crypto: webcrypto,
              fetch: async () => new Response("fixture"),
              document: { readyState: "complete" },
            }),
          },
        };
      return {};
    },
    pages: {
      newPage: async () => {
        resources.add(7);
        return 7;
      },
      close: async (id: number) => {
        resources.delete(id);
      },
    },
    async evaluate(page: number, { code }: { code: string }) {
      const result = {
        page,
        value: await runInNewContext(`(async () => {${code}})()`, {
          location: { origin: "https://www.linkedin.com" },
          document: { cookie: 'JSESSIONID="csrf-fixture"' },
          URL,
          URLSearchParams,
          AbortSignal,
          fetch: async (url: string, init: RequestInit) => {
            requests.push({ url, init });
            if (failFetch) return new Response("private error body", { status: 401 });
            const data = url.endsWith("/me")
              ? {
                  data: { "*miniProfile": `urn:li:fs_miniProfile:${owner}` },
                  included: [
                    {
                      entityUrn: `urn:li:fs_miniProfile:${owner}`,
                      publicIdentifier: "owner",
                      firstName: "Test",
                      lastName: "Owner",
                    },
                  ],
                }
              : {
                  data: { "*elements": ["urn:li:fsd_connection:edge"], paging: { count: 1 } },
                  included: [
                    {
                      entityUrn: "urn:li:fsd_connection:edge",
                      connectedMember: "urn:li:fsd_profile:ACoFriend",
                    },
                    {
                      entityUrn: "urn:li:fsd_profile:ACoFriend",
                      publicIdentifier: "friend",
                      firstName: "Test",
                      lastName: "Friend",
                    },
                  ],
                };
            if (incomplete && !url.endsWith("/me")) data.included = [];
            return new Response(JSON.stringify(data));
          },
        }),
      };
      if (!h.spill) return result;
      const directory = join(h.root, ".browseros", "tool-output");
      await mkdir(directory, { recursive: true });
      const path = join(h.outside ? h.root : directory, "evaluate-fixture.txt");
      await writeFile(
        path,
        `[UNTRUSTED_PAGE_CONTENT nonce=0123456789abcdef origin=${h.origin}] Untrusted page content follows.\n${JSON.stringify(result.value)}\n[END_UNTRUSTED_PAGE_CONTENT nonce=0123456789abcdef]\n`
      );
      return { page, writtenToFile: true, path };
    },
  };
});
afterEach(async () => {
  await rm(h.root, { recursive: true, force: true });
});

const options = {
  endpoint: "http://127.0.0.1:9010/mcp",
  shieldPath: "/shield",
  count: 25,
  start: 0,
  expectedProfileId: "ACoOwner",
};
describe("Neo MCP read-only connection transport", () => {
  it("reads large evaluation results from Neo's local output file", async () => {
    h.spill = true;
    const result = await readNeoConnections(options);
    expect(result.page.records).toHaveLength(1);
    expect(resources.size).toBe(0);
  });
  it("rejects evaluation files outside Neo's output directory", async () => {
    h.spill = true;
    h.outside = true;
    await expect(readNeoConnections(options)).rejects.toThrow("inside its output directory");
    expect(resources.size).toBe(0);
  });
  it("rejects misleading origins on spilled evaluations", async () => {
    h.spill = true;
    h.origin = "https://www.linkedin.com.untrusted.test";
    await expect(readNeoConnections(options)).rejects.toThrow("invalid content markers");
    expect(resources.size).toBe(0);
  });
  it("reads the browser owner and connections, retaining credentials inside the page", async () => {
    const result = await readNeoConnections(options);
    expect(result.owner.profileId).toBe("ACoOwner");
    expect(result.page.records[0]?.publicIdentifier).toBe("friend");
    expect(result.page.isLastPage).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests.every(({ init }) => init.method === "GET")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("csrf-fixture");
    expect(resources.size).toBe(0);
    expect(h.closed).toHaveBeenCalledOnce();
  });
  it("rejects account mismatch before fetching connections and cleans up", async () => {
    owner = "ACoOther";
    await expect(readNeoConnections(options)).rejects.toThrow("account mismatch");
    expect(requests).toHaveLength(1);
    expect(resources.size).toBe(0);
  });
  it("requires Shield before opening LinkedIn", async () => {
    enabled = false;
    await expect(readNeoConnections(options)).rejects.toThrow("verification failed");
    expect(requests).toHaveLength(0);
    expect(resources.size).toBe(0);
  });
  it("fails on HTTP errors without returning response bodies", async () => {
    failFetch = true;
    await expect(readNeoConnections(options)).rejects.toThrow("HTTP 401");
    expect(resources.size).toBe(0);
  });
  it("rejects unresolved connection references instead of declaring an empty complete batch", async () => {
    incomplete = true;
    await expect(readNeoConnections(options)).rejects.toThrow("incomplete connection records");
    expect(resources.size).toBe(0);
  });
  it.each([0, NaN, 101, 1.5])("rejects invalid batch count %s before connecting", async (count) => {
    await expect(readNeoConnections({ ...options, count })).rejects.toThrow("1–100");
    expect(h.calls).toHaveLength(0);
  });
  it("refuses remote MCP endpoints", async () => {
    await expect(
      readNeoConnections({ ...options, endpoint: "https://remote.test/mcp" })
    ).rejects.toThrow("loopback");
    expect(h.calls).toHaveLength(0);
  });
});
