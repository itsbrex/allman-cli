import {
  browserEnvDefaults,
  browserWorkspace,
  mergeBrowserConfig,
  readBrowserConfig,
} from "../linkedin/auth/browser-config.js";
import { profilePause } from "../linkedin/auth/profile-pause.js";
import {
  acquireLinkedInLock,
  canonicalPath,
  type ManagedProfile,
  readSessionRegistry,
  saveSessionRegistry,
  validateProfile,
} from "../linkedin/session-control.js";
import { prepareSessionDevelopment } from "../linkedin/session-development.js";
import { resolveStorePath, Store } from "../store/index.js";
import { printData } from "../utils/output.js";

export async function sessionCommand(
  action: string,
  name: string | undefined,
  options: Record<string, unknown>
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
  if (!["register", "activate", "pause"].includes(action))
    throw new Error("Use session status, register <name>, activate <name>, or pause");
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
      await profilePause(profile, true);
      registry.profiles.push(profile);
      saveSessionRegistry(registry);
    } else {
      const target =
        action === "activate" ? registry.profiles.find((p) => p.name === name) : undefined;
      if (action === "activate" && !target)
        throw new Error(`Unknown profile "${name}". Register it first.`);
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
    printData({ active: registry.active, profiles: registry.profiles.map((p) => p.name) });
  } finally {
    release();
  }
}
