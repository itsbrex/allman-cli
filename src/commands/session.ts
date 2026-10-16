import {
  browserEnvDefaults,
  browserWorkspace,
  mergeBrowserConfig,
  readBrowserConfig,
} from "../linkedin/auth/browser-config.js";
import { assertSameBrowser } from "../linkedin/auth/neo-binding.js";
import { profilePause } from "../linkedin/auth/profile-pause.js";
import {
  acquireLinkedInLock,
  assertMcpEndpoint,
  canonicalPath,
  type ManagedProfile,
  readSessionRegistry,
  type SessionRegistry,
  saveSessionRegistry,
  validateProfile,
} from "../linkedin/session-control.js";
import { prepareSessionDevelopment } from "../linkedin/session-development.js";
import { runGuardedChild } from "../linkedin/session-run.js";
import { resolveStorePath, Store } from "../store/index.js";
import { printData } from "../utils/output.js";

const ACTIONS = ["register", "activate", "pause", "bind-mcp", "run"];

function mcpTaken(registry: SessionRegistry, endpoint: string, except?: ManagedProfile): boolean {
  const href = new URL(endpoint).href;
  return registry.profiles.some(
    (p) => p !== except && p.browser.mcpEndpoint && new URL(p.browser.mcpEndpoint).href === href
  );
}

/** Make `target` the only unpaused profile, or pause every profile when it is undefined. */
async function switchActive(
  registry: SessionRegistry,
  target: ManagedProfile | undefined
): Promise<void> {
  // Persist the fail-closed state before changing either browser.
  registry.active = null;
  saveSessionRegistry(registry);
  try {
    for (const profile of registry.profiles)
      if (profile !== target) await profilePause(profile, true);
    if (target && (await prepareSessionDevelopment(registry.profiles))) {
      // A rebuilt extension may have reloaded. Verify its persisted gate again.
      for (const profile of registry.profiles)
        if (profile !== target) await profilePause(profile, true, true);
    }
    if (target) await profilePause(target, false);
    registry.active = target?.name ?? null;
    saveSessionRegistry(registry);
  } catch (error) {
    // A development reload may have changed any gate. Best-effort pause all
    // browsers, preserve the original failure, and keep CLI access closed.
    for (const profile of registry.profiles) await profilePause(profile, true).catch(() => {});
    throw error;
  }
}

export async function sessionCommand(
  action: string,
  name: string | undefined,
  options: Record<string, unknown>,
  command: string[] = []
): Promise<void> {
  if (action === "status") {
    const registry = readSessionRegistry();
    printData({
      enabled: Boolean(registry),
      active: registry?.active ?? null,
      profiles: registry?.profiles ?? [],
    });
    return;
  }
  if (!ACTIONS.includes(action))
    throw new Error(
      "Use session status, register <name>, activate <name>, pause, bind-mcp <name> --mcp <url>, or run <name> -- <command...>"
    );
  const release = acquireLinkedInLock(`session ${action}`);
  try {
    const registry = readSessionRegistry() ?? { version: 1 as const, active: null, profiles: [] };
    if (action === "register") {
      if (!name) throw new Error("A profile name is required");
      if (registry.profiles.some((p) => p.name === name))
        throw new Error(
          `Profile "${name}" already registered; its browser binding cannot be silently replaced.`
        );
      const store = canonicalPath(resolveStorePath(options.store as string | undefined));
      const account =
        (options.account as string | undefined) ||
        process.env.ALLMAN_ACCOUNT ||
        (await new Store({ path: store }).accounts.getDefault());
      const workspace = canonicalPath(browserWorkspace());
      const browser = mergeBrowserConfig(readBrowserConfig(workspace), browserEnvDefaults());
      const profile = { name, store, account, workspace, browser } as ManagedProfile;
      if (options.mcp !== undefined) {
        assertMcpEndpoint(options.mcp);
        if (mcpTaken(registry, options.mcp))
          throw new Error("That MCP endpoint is already bound to another registered profile");
        profile.browser.mcpEndpoint = options.mcp;
      }
      validateProfile(profile);
      if (
        registry.profiles.some(
          (p) =>
            new URL(p.browser.cdpEndpoint).href === new URL(profile.browser.cdpEndpoint).href ||
            (browser.profileDir &&
              p.browser.profileDir &&
              canonicalPath(browser.profileDir) === canonicalPath(p.browser.profileDir))
        )
      )
        throw new Error("That browser is already bound to another registered profile");
      if (profile.browser.mcpEndpoint) await assertSameBrowser(profile);
      await profilePause(profile, true);
      registry.profiles.push(profile);
      saveSessionRegistry(registry);
    } else if (action === "bind-mcp") {
      const target = registry.profiles.find((p) => p.name === name);
      if (!target) throw new Error(`Unknown profile "${name}". Register it first.`);
      assertMcpEndpoint(options.mcp);
      if (mcpTaken(registry, options.mcp, target))
        throw new Error("That MCP endpoint is already bound to another registered profile");
      const browser = { ...target.browser, mcpEndpoint: options.mcp };
      await assertSameBrowser({ ...target, browser });
      target.browser = browser;
      saveSessionRegistry(registry);
    } else if (action === "run") {
      const target = registry.profiles.find((p) => p.name === name);
      if (!target) throw new Error(`Unknown profile "${name}". Register it first.`);
      if (command.length === 0) throw new Error("Use session run <name> -- <command...>");
      const mcp = target.browser.mcpEndpoint;
      if (!mcp)
        throw new Error(
          `Profile "${target.name}" has no MCP endpoint. Run \`allman session bind-mcp ${target.name} --mcp <url>\` first. No LinkedIn request was made.`
        );
      await assertSameBrowser(target);
      const memberId =
        (await new Store({ path: target.store }).accounts.resolveId(target.account)) ??
        target.account;
      if (!/^ACo[A-Za-z0-9_-]+$/.test(memberId))
        throw new Error(
          `Cannot resolve the LinkedIn member ID for profile "${target.name}". No LinkedIn request was made.`
        );
      await switchActive(registry, target);
      if (readSessionRegistry()?.active !== target.name)
        throw new Error(
          "Session selection changed during activation; the command was not started."
        );
      process.exitCode = await runGuardedChild(command, {
        ALLMAN_PROFILE: target.name,
        ALLMAN_NEO_MCP_URL: mcp,
        ALLMAN_EXPECTED_MEMBER_ID: memberId,
        ALLMAN_SESSION_RUN: "1",
      });
      return;
    } else {
      const target =
        action === "activate" ? registry.profiles.find((p) => p.name === name) : undefined;
      if (action === "activate" && !target)
        throw new Error(`Unknown profile "${name}". Register it first.`);
      await switchActive(registry, target);
    }
    printData({ active: registry.active, profiles: registry.profiles.map((p) => p.name) });
  } finally {
    release();
  }
}
