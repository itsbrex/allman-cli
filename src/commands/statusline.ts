import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalPath, readSessionRegistry } from "../linkedin/session-control.js";
import { resolveStorePath, Store } from "../store/index.js";
import type { AccountConfig } from "../store/types.js";
import { resolveQuotaWindow } from "../utils/account-quota.js";
import { isJsonMode, printData } from "../utils/output.js";
import { Quota } from "../utils/quota.js";
import { activityContext } from "./activity.js";
import { hasSalesNavSeat } from "./connections-of.js";

const clean = (value: string) => value.replace(/\p{C}/gu, " ").replace(/\s+/g, " ").trim();
const duration = (ms: number) =>
  ms >= 86400000
    ? `${Math.ceil(ms / 86400000)}d`
    : ms >= 3600000
      ? `${Math.ceil(ms / 3600000)}h`
      : `${Math.max(1, Math.ceil(ms / 60000))}m`;

/** Read only three quota inputs; never scan contact stores or call LinkedIn. */
export function readStatuslineLimits(accountDir: string, now = Date.now()) {
  const read = (file: string): Record<string, unknown> => {
    try {
      const value = JSON.parse(readFileSync(join(accountDir, file), "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid quota input");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  };
  try {
    const config = read("config.json") as unknown as AccountConfig;
    const rate = read("rate-state.json");
    const cookies = read("COOKIES.json");
    const seat = hasSalesNavSeat(cookies.cookieJar);
    const quotas = (["enrichment", "company", "invite"] as const).map((kind) => {
      const window = resolveQuotaWindow(kind, config, seat);
      const timestamps = rate[`${kind}Timestamps`] ?? [];
      if (
        !Array.isArray(timestamps) ||
        !timestamps.every((t) => typeof t === "number" && Number.isFinite(t)) ||
        !Number.isFinite(window.max) ||
        window.max < 0 ||
        !Number.isFinite(window.windowMs) ||
        window.windowMs <= 0
      )
        throw new Error("Invalid quota inputs");
      return { kind, windowMs: window.windowMs, ...new Quota(window, { timestamps }).status(now) };
    });
    return {
      seat: cookies.cookieJar ? (seat ? "SN credential" : "no SN credential") : "seat unknown",
      quotas,
      available: true,
    };
  } catch {
    return { seat: "seat unknown", quotas: [], available: false };
  }
}

export async function statuslineCommand(options: { store?: string; account?: string }) {
  const context = await activityContext(options);
  const storePath = resolveStorePath(options.store);
  const store = new Store({ path: storePath });
  const auth = await store.accounts.readAuth(context.account);
  const registry = readSessionRegistry();
  const profile = registry?.profiles.find(
    (p) => canonicalPath(p.store) === canonicalPath(storePath)
  );
  const matchingAccount =
    profile && (await store.accounts.getDefault(profile.account)) === context.account;
  const state = !registry
    ? "unmanaged"
    : !registry.active
      ? "paused"
      : matchingAccount && profile?.name === registry.active
        ? "active"
        : "inactive";
  const now = Date.now();
  const limits = readStatuslineLimits(context.accountDir, now);
  const result = {
    account: context.account,
    name: clean(context.label),
    profile: matchingAccount ? profile?.name : null,
    state,
    auth: auth?.status ?? "unknown",
    asOf: new Date(now).toISOString(),
    policy: "local guardrails; not LinkedIn remaining allowance",
    ...limits,
  };
  if (isJsonMode()) return printData(result);
  const quotas = limits.available
    ? limits.quotas
        .map(
          (q) =>
            `${q.kind} ${q.used}/${q.max}/${duration(q.windowMs)} (${q.remaining} left${q.nextFreeAt === null ? "" : `; next ${duration(Math.max(0, q.nextFreeAt - now))}`})`
        )
        .join(" | ")
    : "limits unavailable";
  printData(
    `${result.profile ?? result.account} · ${result.name} | ${state} | stored auth ${clean(result.auth)} | ${limits.seat} | local limits: ${quotas}`
  );
}
