import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sessionCommand } from "@/commands/session.js";
import { profilePause } from "@/linkedin/auth/profile-pause.js";
import {
  acquireLinkedInLock,
  type ManagedProfile,
  readSessionRegistry,
  saveSessionRegistry,
} from "@/linkedin/session-control.js";

const open = vi.hoisted(() => vi.fn());
const development = vi.hoisted(() => vi.fn());
vi.mock("@/linkedin/auth/browser.js", () => ({ openBrowserContext: open }));
vi.mock("@/linkedin/session-development.js", () => ({ prepareSessionDevelopment: development }));
vi.mock("@/utils/output.js", () => ({ printData: vi.fn() }));
let root: string;
let rules: Map<string, Map<number, { id: number; action: { type: string } }>>;
let operations: Array<[string, boolean]>;
let closed: string[];
let failing: string | null;
const gateId = 2000000001;
function browserRules(endpoint = "http://127.0.0.1:9222") {
  const value = rules.get(endpoint);
  if (!value) throw new Error("Unknown fixture browser");
  return value;
}
function profile(name: string, port: number): ManagedProfile {
  return {
    name,
    store: join(root, name),
    account: `ACo${name}`,
    workspace: join(root, `${name}-browser`),
    browser: { cdpEndpoint: `http://127.0.0.1:${port}`, shieldPath: "/fixture/shield" },
  };
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-session-switch-"));
  vi.stubEnv("XDG_CONFIG_HOME", root);
  rules = new Map([
    ["http://127.0.0.1:9222", new Map()],
    ["http://127.0.0.1:9233", new Map()],
  ]);
  operations = [];
  closed = [];
  failing = null;
  development.mockReset().mockResolvedValue(false);
  saveSessionRegistry({
    version: 1,
    active: "brian",
    profiles: [profile("brian", 9222), profile("jp", 9233)],
  });
  open.mockImplementation(async (options: { cdpEndpoint: string }) => {
    const endpoint = options.cdpEndpoint;
    if (failing === endpoint) throw new Error("Shield unavailable");
    const current = browserRules(endpoint);
    return {
      shield: { id: "shield", version: "3.4.0", rulesets: ["linkedin_blocklist"] },
      context: {
        newPage: async () => ({
          goto: async () => {},
          close: async () => {},
          evaluate: async (fn: (arg: unknown) => Promise<unknown>, arg: unknown) => {
            vi.stubGlobal("chrome", {
              declarativeNetRequest: {
                getDynamicRules: async () => [...current.values()],
                updateDynamicRules: async ({
                  removeRuleIds = [],
                  addRules = [],
                }: {
                  removeRuleIds?: number[];
                  addRules?: Array<{ id: number; action: { type: string } }>;
                }) => {
                  for (const id of removeRuleIds) current.delete(id);
                  for (const rule of addRules) current.set(rule.id, rule);
                  operations.push([endpoint, current.has(gateId)]);
                },
                testMatchOutcome: async () => ({
                  matchedRules: current.has(gateId) ? [{ ruleId: gateId }] : [],
                }),
              },
            });
            return fn(arg);
          },
        }),
        browser: () => ({
          newBrowserCDPSession: async () => ({
            send: async (method: string, args?: { targetId: string }) => {
              if (method === "Target.getTargets")
                return {
                  targetInfos: [
                    { targetId: "linkedin", type: "page", url: "https://www.linkedin.com/feed/" },
                    { targetId: "other", type: "page", url: "https://example.com/" },
                  ],
                };
              if (method === "Target.closeTarget") {
                if (!args) throw new Error("Missing target ID");
                closed.push(args.targetId);
                return { success: true };
              }
            },
            detach: async () => {},
          }),
        }),
      },
      close: async () => {},
    };
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});

it("blocks the old browser before allowing the new profile and preserves unrelated rules/tabs", async () => {
  browserRules().set(7, { id: 7, action: { type: "block" } });
  await sessionCommand("activate", "jp", {});
  expect(operations).toEqual([
    ["http://127.0.0.1:9222", true],
    ["http://127.0.0.1:9233", false],
  ]);
  expect(readSessionRegistry()?.active).toBe("jp");
  expect(browserRules().has(7)).toBe(true);
  expect(closed).toEqual(["linkedin"]);
});
it("prepares development under the shared lock before enabling the selected browser", async () => {
  development.mockImplementation(async () => {
    expect(readSessionRegistry()?.active).toBeNull();
    expect(operations).toEqual([["http://127.0.0.1:9222", true]]);
    expect(() => acquireLinkedInLock("competing switch")).toThrow("already running");
    return true;
  });
  await sessionCommand("activate", "jp", {});
  expect(development).toHaveBeenCalledExactlyOnceWith(readSessionRegistry()?.profiles);
  expect(operations.at(-1)).toEqual(["http://127.0.0.1:9233", false]);
  expect(readSessionRegistry()?.active).toBe("jp");
});
it("keeps both browsers paused when the development restart fails", async () => {
  development.mockRejectedValue(new Error("unrecognized port owner"));
  await expect(sessionCommand("activate", "jp", {})).rejects.toThrow("unrecognized port owner");
  expect(readSessionRegistry()?.active).toBeNull();
  expect(operations).toEqual([
    ["http://127.0.0.1:9222", true],
    ["http://127.0.0.1:9222", true],
    ["http://127.0.0.1:9233", true],
  ]);
  const release = acquireLinkedInLock("recovery");
  release();
});
it("refuses to enable the target if a development reload lost an inactive gate", async () => {
  development.mockImplementation(async () => {
    browserRules().delete(gateId);
    return true;
  });
  await expect(sessionCommand("activate", "jp", {})).rejects.toThrow("pause state differs");
  expect(readSessionRegistry()?.active).toBeNull();
  expect(operations).not.toContainEqual(["http://127.0.0.1:9233", false]);
  expect(browserRules().has(gateId)).toBe(true);
  expect(browserRules("http://127.0.0.1:9233").has(gateId)).toBe(true);
});
it("does not restart development for read-only status or pause", async () => {
  await sessionCommand("status", undefined, {});
  await sessionCommand("pause", undefined, {});
  expect(development).not.toHaveBeenCalled();
});
it("leaves all CLI access paused when an inactive browser cannot be protected", async () => {
  failing = "http://127.0.0.1:9222";
  await expect(sessionCommand("activate", "jp", {})).rejects.toThrow("Shield unavailable");
  expect(readSessionRegistry()?.active).toBeNull();
  expect(operations.some(([, paused]) => !paused)).toBe(false);
});
it("refuses account switching during another LinkedIn command", async () => {
  const release = acquireLinkedInLock("listen");
  try {
    await expect(sessionCommand("activate", "jp", {})).rejects.toThrow("already running");
  } finally {
    release();
  }
  expect(readSessionRegistry()?.active).toBe("brian");
  expect(open).not.toHaveBeenCalled();
});
it("pauses all managed browsers without enabling another account", async () => {
  await sessionCommand("pause", undefined, {});
  expect(readSessionRegistry()?.active).toBeNull();
  expect(operations.every(([, paused]) => paused)).toBe(true);
  expect(closed).toEqual(["linkedin", "linkedin"]);
});
it("detects missing browser protection without mutating it during preflight", async () => {
  await expect(profilePause(profile("brian", 9222), true, true)).rejects.toThrow(
    "pause state differs"
  );
  expect(operations).toEqual([]);
});
it("refuses a conflicting dynamic rule without replacing unrelated protection", async () => {
  browserRules().set(gateId, { id: gateId, action: { type: "allow" } });
  await expect(sessionCommand("activate", "jp", {})).rejects.toThrow("conflicts");
  expect(readSessionRegistry()?.active).toBeNull();
  expect(browserRules().get(gateId)?.action.type).toBe("allow");
});

it("registers a new isolated profile as paused while preserving the selected profile", async () => {
  saveSessionRegistry({ version: 1, active: "brian", profiles: [profile("brian", 9222)] });
  const candidate = profile("jp", 9233);
  await mkdir(candidate.workspace);
  await writeFile(join(candidate.workspace, "config.json"), JSON.stringify(candidate.browser));
  vi.stubEnv("ALLMAN_BROWSER_WORKSPACE", candidate.workspace);
  for (const key of [
    "ALLMAN_CDP_URL",
    "ALLMAN_BROWSER",
    "ALLMAN_BROWSER_PROFILE",
    "ALLMAN_SHIELD_PATH",
    "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
  ])
    vi.stubEnv(key, "");
  await sessionCommand("register", "jp", { store: candidate.store, account: candidate.account });
  expect(readSessionRegistry()?.active).toBe("brian");
  expect(readSessionRegistry()?.profiles.map((p) => p.name)).toEqual(["brian", "jp"]);
  expect(operations).toEqual([[candidate.browser.cdpEndpoint, true]]);
  await expect(
    sessionCommand("register", "jp", { store: candidate.store, account: candidate.account })
  ).rejects.toThrow("already registered");
  await expect(
    sessionCommand("register", "another", { store: candidate.store, account: candidate.account })
  ).rejects.toThrow("already bound");
});
