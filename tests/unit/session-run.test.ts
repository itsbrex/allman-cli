import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCommand } from "@/commands/session.js";
import {
  type ManagedProfile,
  readSessionRegistry,
  saveSessionRegistry,
} from "@/linkedin/session-control.js";

const h = vi.hoisted(() => ({
  calls: [] as string[],
  pause: vi.fn(),
  sameBrowser: vi.fn(),
  child: vi.fn(),
  resolveId: vi.fn(),
}));
vi.mock("@/linkedin/auth/profile-pause.js", () => ({ profilePause: h.pause }));
vi.mock("@/linkedin/auth/neo-binding.js", () => ({ assertSameBrowser: h.sameBrowser }));
vi.mock("@/linkedin/session-run.js", () => ({ runGuardedChild: h.child }));
vi.mock("@/store/index.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Store: class {
    accounts = { resolveId: h.resolveId, getDefault: async () => "ACoDefault" };
  },
}));
vi.mock("@/utils/output.js", () => ({ printData: vi.fn() }));

let root: string;
const lock = () => join(root, "allman", "linkedin-command.lock");

function profile(name: string, port: number, mcpPort?: number): ManagedProfile {
  return {
    name,
    store: join(root, name),
    account: `${name}-slug`,
    workspace: join(root, `${name}-browser`),
    browser: {
      cdpEndpoint: `http://127.0.0.1:${port}`,
      shieldPath: "/fixture/shield",
      ...(mcpPort ? { mcpEndpoint: `http://127.0.0.1:${mcpPort}/mcp` } : {}),
    },
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-session-run-"));
  vi.stubEnv("XDG_CONFIG_HOME", root);
  h.calls.length = 0;
  h.pause.mockReset().mockImplementation(async (p: ManagedProfile, paused: boolean) => {
    h.calls.push(`${paused ? "pause" : "resume"}:${p.name}`);
  });
  h.sameBrowser.mockReset().mockImplementation(async (p: ManagedProfile) => {
    h.calls.push(`bind:${p.name}:${p.browser.mcpEndpoint}`);
  });
  h.child.mockReset().mockImplementation(async (command: string[]) => {
    h.calls.push(`spawn:${command.join(" ")}:locked=${existsSync(lock())}`);
    return 0;
  });
  h.resolveId.mockReset().mockResolvedValue("ACoJp123");
  saveSessionRegistry({
    version: 1,
    active: "brian",
    profiles: [profile("brian", 9222, 9010), profile("jp", 9223)],
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  await rm(root, { recursive: true, force: true });
});

describe("session bind-mcp", () => {
  it("binds a verified endpoint to an existing profile", async () => {
    await sessionCommand("bind-mcp", "jp", { mcp: "http://127.0.0.1:9012/mcp" });
    expect(h.calls).toEqual(["bind:jp:http://127.0.0.1:9012/mcp"]);
    expect(readSessionRegistry()?.profiles[1]?.browser.mcpEndpoint).toBe(
      "http://127.0.0.1:9012/mcp"
    );
    expect(existsSync(lock())).toBe(false);
  });

  it("rejects a non-loopback endpoint before checking the browser", async () => {
    await expect(
      sessionCommand("bind-mcp", "jp", { mcp: "http://10.0.0.5:9012/mcp" })
    ).rejects.toThrow(/loopback HTTP MCP endpoint/);
    expect(h.sameBrowser).not.toHaveBeenCalled();
  });

  it("rejects an endpoint already bound to another profile", async () => {
    await expect(
      sessionCommand("bind-mcp", "jp", { mcp: "http://127.0.0.1:9010/mcp" })
    ).rejects.toThrow(/already bound to another registered profile/);
  });

  it("does not save when the browser check fails", async () => {
    h.sameBrowser.mockRejectedValueOnce(new Error("not the browser"));
    await expect(
      sessionCommand("bind-mcp", "jp", { mcp: "http://127.0.0.1:9012/mcp" })
    ).rejects.toThrow(/not the browser/);
    expect(readSessionRegistry()?.profiles[1]?.browser.mcpEndpoint).toBeUndefined();
    expect(existsSync(lock())).toBe(false);
  });

  it("rejects an unknown profile", async () => {
    await expect(
      sessionCommand("bind-mcp", "nobody", { mcp: "http://127.0.0.1:9012/mcp" })
    ).rejects.toThrow(/Unknown profile "nobody"/);
  });
});

describe("session run", () => {
  beforeEach(() => {
    saveSessionRegistry({
      version: 1,
      active: "brian",
      profiles: [profile("brian", 9222, 9010), profile("jp", 9223, 9012)],
    });
  });

  it("binds, activates, then starts the child with the guard env while holding the lock", async () => {
    h.child.mockImplementation(async (command: string[], env: Record<string, string>) => {
      h.calls.push(`spawn:${command.join(" ")}:locked=${existsSync(lock())}`);
      expect(env).toEqual({
        ALLMAN_PROFILE: "jp",
        ALLMAN_NEO_MCP_URL: "http://127.0.0.1:9012/mcp",
        ALLMAN_EXPECTED_MEMBER_ID: "ACoJp123",
        ALLMAN_SESSION_RUN: "1",
      });
      return 0;
    });
    await sessionCommand("run", "jp", {}, ["lmc", "mutuals", "x.xlsx"]);
    expect(h.calls).toEqual([
      "bind:jp:http://127.0.0.1:9012/mcp",
      "pause:brian",
      "resume:jp",
      "spawn:lmc mutuals x.xlsx:locked=true",
    ]);
    expect(h.resolveId).toHaveBeenCalledWith("jp-slug");
    expect(readSessionRegistry()?.active).toBe("jp");
    expect(existsSync(lock())).toBe(false);
    expect(process.exitCode).toBe(0);
  });

  it("exits with the child's exit code", async () => {
    h.child.mockResolvedValueOnce(7);
    await sessionCommand("run", "jp", {}, ["lmc"]);
    expect(process.exitCode).toBe(7);
  });

  it("releases the lock when the child cannot start", async () => {
    h.child.mockRejectedValueOnce(new Error("spawn lmc ENOENT"));
    await expect(sessionCommand("run", "jp", {}, ["lmc"])).rejects.toThrow(/spawn lmc ENOENT/);
    expect(existsSync(lock())).toBe(false);
  });

  it("refuses a profile without an MCP endpoint before changing anything", async () => {
    saveSessionRegistry({
      version: 1,
      active: "brian",
      profiles: [profile("brian", 9222, 9010), profile("jp", 9223)],
    });
    await expect(sessionCommand("run", "jp", {}, ["lmc"])).rejects.toThrow(
      /has no MCP endpoint.*No LinkedIn request was made/
    );
    expect(h.sameBrowser).not.toHaveBeenCalled();
    expect(h.pause).not.toHaveBeenCalled();
    expect(h.child).not.toHaveBeenCalled();
    expect(readSessionRegistry()?.active).toBe("brian");
  });

  it("refuses an MCP/CDP mismatch before changing anything", async () => {
    h.sameBrowser.mockRejectedValueOnce(new Error("MCP endpoint is not the browser"));
    await expect(sessionCommand("run", "jp", {}, ["lmc"])).rejects.toThrow(/not the browser/);
    expect(h.pause).not.toHaveBeenCalled();
    expect(h.child).not.toHaveBeenCalled();
    expect(readSessionRegistry()?.active).toBe("brian");
  });

  it("refuses when the member ID cannot be resolved, before changing anything", async () => {
    h.resolveId.mockResolvedValueOnce(null);
    await expect(sessionCommand("run", "jp", {}, ["lmc"])).rejects.toThrow(
      /Cannot resolve the LinkedIn member ID for profile "jp"/
    );
    expect(h.pause).not.toHaveBeenCalled();
    expect(readSessionRegistry()?.active).toBe("brian");
  });

  it("requires a command", async () => {
    await expect(sessionCommand("run", "jp", {}, [])).rejects.toThrow(
      /Use session run <name> -- <command...>/
    );
  });

  it("rejects an unknown profile", async () => {
    await expect(sessionCommand("run", "nobody", {}, ["lmc"])).rejects.toThrow(
      /Unknown profile "nobody"/
    );
  });
});
