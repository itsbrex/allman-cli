import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ok: true,
  value: [] as unknown,
  closed: vi.fn(),
  codes: [] as string[],
}));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = async () => {};
    close = h.closed;
    async callTool(input: { arguments: { code: string } }) {
      h.codes.push(input.arguments.code);
      return { structuredContent: { ok: h.ok, value: h.value, error: h.ok ? undefined : "boom" } };
    }
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {},
}));

import {
  assertSameBrowser,
  cdpPageTargetIds,
  neoPageTargetIds,
} from "@/linkedin/auth/neo-binding.js";

const brian = {
  name: "brian",
  browser: {
    cdpEndpoint: "http://127.0.0.1:9222",
    shieldPath: "/fixture/shield",
    mcpEndpoint: "http://127.0.0.1:9010/mcp",
  },
};

describe("neoPageTargetIds", () => {
  it("lists page targets through neo run and closes the client", async () => {
    h.ok = true;
    h.value = ["A", "B"];
    h.closed.mockClear();
    expect(await neoPageTargetIds("http://127.0.0.1:9010/mcp")).toEqual(new Set(["A", "B"]));
    expect(h.codes.at(-1)).toContain('browser.cdp("Target.getTargets"');
    expect(h.closed).toHaveBeenCalledOnce();
  });

  it("rejects an unsuccessful or malformed result", async () => {
    h.ok = false;
    await expect(neoPageTargetIds("http://127.0.0.1:9010/mcp")).rejects.toThrow(/boom/);
    h.ok = true;
    h.value = [1, 2];
    await expect(neoPageTargetIds("http://127.0.0.1:9010/mcp")).rejects.toThrow(
      /unexpected result/
    );
  });
});

describe("cdpPageTargetIds", () => {
  it("keeps only page targets from /json/list", async () => {
    const fetcher = vi.fn(async (url: URL | string | Request) => {
      expect(String(url)).toBe("http://127.0.0.1:9222/json/list");
      return new Response(
        JSON.stringify([
          { id: "A", type: "page" },
          { id: "W", type: "service_worker" },
          { id: "B", type: "page" },
        ])
      );
    }) as unknown as typeof fetch;
    expect(await cdpPageTargetIds("http://127.0.0.1:9222", fetcher)).toEqual(new Set(["A", "B"]));
  });

  it("rejects an HTTP failure", async () => {
    const fetcher = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(cdpPageTargetIds("http://127.0.0.1:9222", fetcher)).rejects.toThrow(/HTTP 500/);
  });
});

describe("assertSameBrowser", () => {
  const deps = (neo: string[], cdp: string[]) => ({
    neo: async () => new Set(neo),
    cdp: async () => new Set(cdp),
  });

  it("passes when the two endpoints share a page target", async () => {
    await expect(assertSameBrowser(brian, deps(["A", "B"], ["B", "C"]))).resolves.toBeUndefined();
  });

  it("refuses endpoints with no shared page target", async () => {
    await expect(assertSameBrowser(brian, deps(["A"], ["C"]))).rejects.toThrow(
      /is not the browser at http:\/\/127.0.0.1:9222.*No LinkedIn request was made/
    );
  });

  it("refuses a browser with no open pages and says to open a tab", async () => {
    await expect(assertSameBrowser(brian, deps([], []))).rejects.toThrow(/Open a tab/);
  });

  it("refuses a profile without an MCP endpoint", async () => {
    const { mcpEndpoint: _drop, ...browser } = brian.browser;
    await expect(assertSameBrowser({ name: "brian", browser }, deps(["A"], ["A"]))).rejects.toThrow(
      /has no MCP endpoint/
    );
  });
});
