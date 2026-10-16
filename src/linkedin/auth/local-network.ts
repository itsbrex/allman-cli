import { realpathSync } from "node:fs";
import type { ManagedProfile } from "../session-control.js";
import { openBrowserContext } from "./browser.js";

/** Persist exact extension-origin settings through Chromium's own settings API. */
export async function allowExtensionLocalNetwork(
  profile: ManagedProfile,
  extensionPaths: string[]
): Promise<void> {
  const session = await openBrowserContext({
    ...profile.browser,
    workspace: profile.workspace,
    headless: true,
  });
  try {
    const page = await session.context.newPage();
    await page.goto("chrome://extensions/", { timeout: 10000 });
    const installed = await page.evaluate(async () => {
      const chrome = (
        globalThis as unknown as {
          chrome: {
            developerPrivate: {
              getExtensionsInfo(options: {
                includeDisabled: boolean;
                includeTerminated: boolean;
              }): Promise<Array<{ id: string; path?: string; state: string }>>;
            };
          };
        }
      ).chrome;
      return (
        await chrome.developerPrivate.getExtensionsInfo({
          includeDisabled: true,
          includeTerminated: true,
        })
      ).map(({ id, path, state }) => ({ id, path, state }));
    });
    const origins = extensionPaths.map((path) => {
      const extension = installed.find((item) => {
        try {
          return item.path && realpathSync(item.path) === realpathSync(path);
        } catch {
          return false;
        }
      });
      if (!extension || extension.state !== "ENABLED" || !/^[a-p]{32}$/.test(extension.id))
        throw new Error(`Enabled development extension missing in "${profile.name}": ${path}`);
      return `chrome-extension://${extension.id}`;
    });
    const firstOrigin = origins[0];
    if (!firstOrigin) throw new Error("No development extensions configured");
    await page.goto(
      `chrome://settings/content/siteDetails?site=${encodeURIComponent(firstOrigin)}`,
      { timeout: 10000 }
    );
    await page.evaluate(async (origins) => {
      // Use the browser's shipped enum: older Chromium has one permission;
      // newer Chromium splits local-device and loopback access. Never grant '*'.
      const modulePath = "chrome://settings/lazy_load.js";
      const settings = await import(modulePath);
      const proxy = settings.SiteSettingsBrowserProxyImpl?.getInstance();
      const types = ["LOCAL_NETWORK_ACCESS", "LOCAL_NETWORK", "LOOPBACK_NETWORK"]
        .map((key) => settings.ContentSettingsTypes?.[key])
        .filter((type): type is string => typeof type === "string");
      if (!proxy || types.length === 0)
        throw new Error("This browser does not expose persistent local-network settings");
      for (const origin of origins) {
        if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin))
          throw new Error("Local-network grants require an exact extension origin");
        const before = await proxy.getOriginPermissions(origin, types);
        if (before.length !== types.length)
          throw new Error("Browser did not return every local-network permission");
        for (let i = 0; i < types.length; i++) {
          if (before[i].setting === "allow") continue;
          if (before[i].source === "policy")
            throw new Error("Local-network permission is blocked by browser policy");
          proxy.setOriginPermissions(origin, types[i], "allow");
        }
        const after = await proxy.getOriginPermissions(origin, types);
        if (
          after.length !== types.length ||
          after.some((item: { setting: string }) => item.setting !== "allow")
        )
          throw new Error("Browser did not save the extension local-network permissions");
      }
    }, origins);
  } finally {
    // Scoped CDP closes only this function's temporary pages, not user tabs.
    await session.close();
  }
}
