import { Command } from "commander";
import { finishActivity } from "../activity/journal.js";
import { beginCommandActivity } from "../commands/activity.js";
import { hasSalesNavSeat } from "../commands/connections-of.js";
import { enrichConnections } from "../commands/enrich.js";
import { beginAutomaticExports } from "../exports/automatic.js";
import type { ApiRequestOptions, LinkedInApiClient } from "../linkedin/api/client.js";
import { parseProfileCore } from "../linkedin/api/endpoints/profile-detail.js";
import { loadSession } from "../linkedin/api/session.js";
import { assertActiveProfile, beginLinkedInCommand } from "../linkedin/session-control.js";
import type { StoredConnection } from "../store/connections-store.js";
import type { Store } from "../store/index.js";
import { setRawCapture } from "../store/raw-archive.js";
import { AccountQuota } from "../utils/account-quota.js";
import { DEFAULT_PAGE_DELAY, randomPageSleep } from "../utils/random-delay.js";
import { adequateDeep, type EnrichmentPlan, type EnrichmentTarget } from "./target-matches.js";

export interface TargetRunState {
  status: "running" | "complete" | "stopped" | "limited";
  startedAt: string;
  updatedAt: string;
  total: number;
  attempted: number;
  enriched: number;
  skipped: number;
  current: string | null;
  browserPreflights: number;
  sessionLoads: number;
  successfulRequests: number;
  error?: string;
}

/** One sequential queue. Failures bubble immediately; saved records spend no quota. */
export async function runTargets(
  targets: EnrichmentTarget[],
  deps: {
    read: (id: string) => Promise<StoredConnection>;
    stopped: () => boolean;
    skip: (target: EnrichmentTarget) => Promise<void>;
    pace: () => Promise<void>;
    fetch: (target: EnrichmentTarget) => Promise<void>;
    limit?: number;
  }
) {
  let fetched = 0;
  for (const target of targets) {
    if (deps.stopped()) throw new Error("Stopped at a safe boundary");
    if (adequateDeep(await deps.read(target.flagshipId))) {
      await deps.skip(target);
      continue;
    }
    if (fetched >= (deps.limit ?? Infinity)) return "limited" as const;
    if (fetched) await deps.pace();
    if (deps.stopped()) throw new Error("Stopped at a safe boundary");
    await deps.fetch(target);
    fetched++;
  }
  return "complete" as const;
}

export async function executeTargetPlan(
  plan: EnrichmentPlan,
  store: Store,
  options: {
    account?: string;
    store?: string;
    limit?: number;
  },
  save: (state: TargetRunState) => Promise<void>,
  validateMembership?: (client: LinkedInApiClient) => Promise<void>
) {
  const cstore = store.connectionsFor(plan.account),
    pstore = store.peopleFor(plan.account);
  const allowed = new Set(plan.targets.map((t) => t.flagshipId));
  const member = async (id: string) => {
    const row = allowed.has(id) ? await cstore.readConnection(id) : null;
    if (
      !row ||
      row.flagshipId !== id ||
      row.memberUrn !== `urn:li:fsd_profile:${id}` ||
      (row.source ?? "connections") !== "connections"
    )
      throw new Error(`Target is not a stored connection in this account: ${id}`);
    return row;
  };
  let pending = 0;
  for (const t of plan.targets) if (!adequateDeep(await member(t.flagshipId))) pending++;
  const state: TargetRunState = {
    status: "running",
    startedAt: new Date().toISOString(),
    updatedAt: "",
    total: plan.targets.length,
    attempted: 0,
    enriched: 0,
    skipped: 0,
    current: null,
    browserPreflights: 0,
    sessionLoads: 0,
    successfulRequests: 0,
  };
  const persist = async () => {
    state.updatedAt = new Date().toISOString();
    await save(state);
  };
  if (!pending) {
    state.status = "complete";
    state.skipped = plan.targets.length;
    await persist();
    return state;
  }
  const opts = { ...options, deep: true, raw: true, dashboard: false };
  await assertActiveProfile(opts);
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    process.stderr.write("Stopping after the current profile finishes.\n");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  let release: (() => void) | null = null;
  let finishExports: (() => Promise<void>) | undefined;
  let activity: Awaited<ReturnType<typeof beginCommandActivity>>;
  let initialized = false;
  try {
    const command = new Command("enrich");
    for (const [key, value] of Object.entries(opts)) command.setOptionValue(key, value);
    release = await beginLinkedInCommand(command);
    state.browserPreflights++;
    await persist();
    await store.init();
    initialized = true;
    setRawCapture(true);
    activity = await beginCommandActivity("enrich", opts);
    finishExports = await beginAutomaticExports("enrich", undefined, opts);
    const session = await loadSession(store, options.account);
    state.sessionLoads++;
    if (session.profileId !== plan.account) throw new Error("Authenticated account mismatch");
    await validateMembership?.(session.apiClient);
    const quota = await AccountQuota.load(
      store,
      plan.account,
      "enrichment",
      await store.accounts.readConfig(plan.account),
      hasSalesNavSeat(session.accountRecord.cookieJar)
    );
    let current = "",
      requests = 0,
      requestError: unknown;
    const client = new Proxy(session.apiClient, {
      get(target, property) {
        if (property === "request")
          return async (request: ApiRequestOptions) => {
            if (requestError) throw requestError;
            try {
              const result = await target.request(request);
              if (request.url.includes("/identity/dash/profiles?")) {
                const core = parseProfileCore(result as Parameters<typeof parseProfileCore>[0]);
                if (core?.urn !== `urn:li:fsd_profile:${current}`)
                  throw new Error("Provider returned a different profile identity");
              }
              requests++;
              return result;
            } catch (error) {
              requestError = error;
              throw error;
            }
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const scopedStore = new Proxy(cstore, {
      get(target, property) {
        if (property === "readConnection")
          return async (id: string) => ({ ...(await member(id)), publicIdentifier: null });
        if (property === "enrichConnection")
          return async (...args: Parameters<typeof cstore.enrichConnection>) => {
            if (requestError) throw requestError;
            if (args[0] !== current || requests !== 4)
              throw new Error("Profile identity/request completeness check failed");
            return target.enrichConnection(...args);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    state.status = await runTargets(plan.targets, {
      read: member,
      stopped: () => interrupted,
      limit: options.limit,
      skip: async () => {
        state.skipped++;
        await persist();
      },
      pace: () => randomPageSleep(DEFAULT_PAGE_DELAY),
      fetch: async (target) => {
        await assertActiveProfile(opts);
        await member(target.flagshipId);
        current = target.flagshipId;
        requests = 0;
        requestError = undefined;
        state.current = current;
        state.attempted++;
        await persist();
        process.stderr.write(
          `[${state.attempted}/${pending}] ${target.name}: shared-session deep enrichment\n`
        );
        const result = await enrichConnections({
          apiClient: client,
          cstore: scopedStore,
          pstore,
          ids: [current],
          depth: "deep",
          force: false,
          limit: 1,
          json: false,
          noDelay: true,
          delayConfig: DEFAULT_PAGE_DELAY,
          quota,
          raw: true,
        });
        if (requestError) throw requestError;
        if (result.failed || result.quotaExhausted || result.enriched !== 1)
          throw new Error(
            result.quotaExhausted
              ? "Account enrichment quota exhausted; resume later"
              : "Profile enrichment failed"
          );
        const row = await member(current),
          person = await pstore.readPersonRecord(current);
        if (!adequateDeep(row) || !row.raw || person?.flagshipId !== current)
          throw new Error("Deep/raw/person read-back failed");
        state.enriched++;
        state.successfulRequests += requests;
        await persist();
      },
    });
    state.current = null;
  } catch (error) {
    state.status = "stopped";
    state.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    try {
      if (initialized) {
        store.git.scheduleCommit("✨ feat: enrich selected list profiles");
        await store.git.flush();
        await finishExports?.();
      }
    } finally {
      finishActivity(state.status === "complete" ? "finished" : "interrupted");
      try {
        await activity?.close();
        await persist();
      } finally {
        release?.();
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
      }
    }
  }
  return state;
}
