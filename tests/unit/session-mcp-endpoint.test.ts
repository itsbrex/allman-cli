import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertMcpEndpoint,
  type ManagedProfile,
  readSessionRegistry,
  validateProfile,
} from "@/linkedin/session-control.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-mcp-endpoint-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function profile(name: string, port: number, mcp?: string): ManagedProfile {
  return {
    name,
    store: join(root, name),
    account: `ACo${name}`,
    workspace: join(root, `${name}-browser`),
    browser: {
      cdpEndpoint: `http://127.0.0.1:${port}`,
      shieldPath: "/fixture/shield",
      ...(mcp ? { mcpEndpoint: mcp } : {}),
    },
  };
}

describe("assertMcpEndpoint", () => {
  it.each([
    "http://127.0.0.1:9010/mcp",
    "http://localhost:9012/mcp",
    "http://[::1]:9010/mcp",
  ])("accepts %s", (endpoint) => {
    expect(() => assertMcpEndpoint(endpoint)).not.toThrow();
  });

  it.each([
    "https://127.0.0.1:9010/mcp",
    "http://10.0.0.5:9010/mcp",
    "http://user:pw@127.0.0.1:9010/mcp",
    "http://127.0.0.1:9010/mcp?x=1",
    "http://127.0.0.1:9010/mcp#frag",
    "http://127.0.0.1:9010/",
    "http://127.0.0.1:9010/mcp/",
    "not a url",
    42,
    undefined,
  ])("rejects %s", (endpoint) => {
    expect(() => assertMcpEndpoint(endpoint)).toThrow(/loopback HTTP MCP endpoint ending in \/mcp/);
  });
});

describe("registry mcpEndpoint", () => {
  it("validates a profile's optional MCP endpoint", () => {
    expect(() =>
      validateProfile(profile("brian", 9222, "http://127.0.0.1:9010/mcp"))
    ).not.toThrow();
    expect(() => validateProfile(profile("brian", 9222))).not.toThrow();
    expect(() => validateProfile(profile("brian", 9222, "http://10.0.0.5:9010/mcp"))).toThrow(
      /loopback HTTP MCP endpoint/
    );
  });

  it("refuses a registry where two profiles share an MCP endpoint", async () => {
    await writeFile(
      join(root, "session-control.json"),
      JSON.stringify({
        version: 1,
        active: "brian",
        profiles: [
          profile("brian", 9222, "http://127.0.0.1:9010/mcp"),
          profile("jp", 9223, "http://127.0.0.1:9010/mcp"),
        ],
      })
    );
    expect(() => readSessionRegistry(root)).toThrow(/duplicate or unknown profile/);
  });

  it("reads a registry where only some profiles have an MCP endpoint", async () => {
    await writeFile(
      join(root, "session-control.json"),
      JSON.stringify({
        version: 1,
        active: null,
        profiles: [profile("brian", 9222, "http://127.0.0.1:9010/mcp"), profile("jp", 9223)],
      })
    );
    expect(readSessionRegistry(root)?.profiles[0]?.browser.mcpEndpoint).toBe(
      "http://127.0.0.1:9010/mcp"
    );
  });
});
