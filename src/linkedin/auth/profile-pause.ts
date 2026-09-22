import type { ManagedProfile } from "../session-control.js";
import { openBrowserContext } from "./browser.js";

/** Reserved dynamic rule; never alter Shield's static privacy rules or unrelated rules. */
export const PROFILE_PAUSE_RULE = {
  id: 2000000001,
  priority: 1000000,
  action: { type: "block" },
  condition: {
    requestDomains: ["linkedin.com", "licdn.com"],
    resourceTypes: [
      "main_frame",
      "sub_frame",
      "stylesheet",
      "script",
      "image",
      "font",
      "object",
      "xmlhttprequest",
      "ping",
      "csp_report",
      "media",
      "websocket",
      "webtransport",
      "webbundle",
      "other",
    ],
  },
};

export async function profilePause(
  profile: ManagedProfile,
  paused: boolean,
  verifyOnly = false
): Promise<void> {
  const session = await openBrowserContext({
    ...profile.browser,
    workspace: profile.workspace,
    headless: true,
  });
  try {
    const page = await session.context.newPage();
    try {
      await page.goto(`chrome-extension://${session.shield.id}/popup.html`, { timeout: 10000 });
      await page.evaluate(
        async ({ rule, paused, verifyOnly }) => {
          type Rule = typeof rule;
          const chrome = (
            globalThis as unknown as {
              chrome: {
                declarativeNetRequest: {
                  getDynamicRules(): Promise<Rule[]>;
                  updateDynamicRules(options: {
                    removeRuleIds: number[];
                    addRules: Rule[];
                  }): Promise<void>;
                  testMatchOutcome(request: {
                    url: string;
                    type: string;
                  }): Promise<{ matchedRules: Array<{ ruleId: number }> }>;
                };
              };
            }
          ).chrome;
          const dnr = chrome.declarativeNetRequest;
          const existing = (await dnr.getDynamicRules()).find((r) => r.id === rule.id);
          if (
            existing &&
            (existing.action.type !== "block" ||
              existing.priority !== rule.priority ||
              JSON.stringify(existing.condition.requestDomains?.slice().sort()) !==
                JSON.stringify(rule.condition.requestDomains.slice().sort()) ||
              JSON.stringify(existing.condition.resourceTypes?.slice().sort()) !==
                JSON.stringify(rule.condition.resourceTypes.slice().sort()))
          )
            throw new Error(
              "Profile pause rule ID conflicts with an existing rule; nothing changed."
            );
          if (!verifyOnly)
            await dnr.updateDynamicRules({
              removeRuleIds: [rule.id],
              addRules: paused ? [rule] : [],
            });
          const present = (await dnr.getDynamicRules()).some((r) => r.id === rule.id);
          if (present !== paused)
            throw new Error(
              `Browser LinkedIn pause state differs from active profile. Run allman session activate <name>.`
            );
          if (paused) {
            for (const type of ["main_frame", "xmlhttprequest", "websocket"]) {
              const url =
                type === "websocket"
                  ? "wss://www.linkedin.com/realtime/connect"
                  : "https://www.linkedin.com/voyager/api/me";
              const result = await dnr.testMatchOutcome({ url, type });
              if (!result.matchedRules.some((r) => r.ruleId === rule.id))
                throw new Error(`Inactive profile does not block ${type}`);
            }
          }
        },
        { rule: PROFILE_PAUSE_RULE, paused, verifyOnly }
      );
    } finally {
      await page.close();
    }
    if (paused && !verifyOnly) {
      const browser = session.context.browser();
      if (!browser)
        throw new Error("Cannot close inactive LinkedIn tabs without a browser connection");
      const cdp = await browser.newBrowserCDPSession();
      try {
        const { targetInfos } = await cdp.send("Target.getTargets");
        for (const target of targetInfos) {
          let hostname = "";
          try {
            hostname = new URL(target.url).hostname;
          } catch {
            /* internal browser target */
          }
          if (target.type === "page" && /(^|\.)linkedin\.com$/.test(hostname)) {
            const result = await cdp.send("Target.closeTarget", { targetId: target.targetId });
            if (!result.success) throw new Error("Failed to close an inactive LinkedIn tab");
          }
        }
      } finally {
        await cdp.detach();
      }
    }
  } finally {
    await session.close();
  }
}
