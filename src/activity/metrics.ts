import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { hasSalesNavSeat } from "../commands/connections-of.js";
import type { AccountConfig } from "../store/types.js";
import { resolveQuotaWindow } from "../utils/account-quota.js";
import { describeWindow, Quota } from "../utils/quota.js";
import type { ActivityEvent } from "./journal.js";

type Row = Record<string, unknown>;
const string = (value: unknown): string => (typeof value === "string" ? value : "");
const memberId = (row: Row): string => {
  const id = string(row.memberId) || string(row.objectUrn).replace(/^urn:li:member:/, "");
  return /^\d+$/.test(id) ? id : "";
};
const flagshipId = (row: Row): string => string(row.flagshipId) || string(row.profileId);
const fields = ["connectionObservedAt", "enrichedAt", "fetchedAt", "firstSeenAt", "lastSeenAt"];

export interface ActivityMetrics {
  date: string;
  timezone: string;
  asOf: string;
  inventory: {
    people: number;
    firstDegree: number;
    salesnav: number;
    unlinkedSalesnav: number;
    deep: number;
    companies: number;
    referencedCompanies: number;
  };
  today: {
    people: number;
    unlinkedSalesnav: number;
    companies: number;
    deep: number;
    saves: number;
    repeatSaves: number;
    failed: number;
    skipped: number;
    enrichmentAttempts: number;
    companyAttempts: number;
    requests: number;
    salesnavRequests: number;
    requestFailures: number;
    rateLimited: number;
  };
  coverage: {
    activitySince: string | null;
    requestsSince: string | null;
    retainedQuotaAttempts: number;
    unreadable: number;
    identityConflicts: number;
  };
  seat: "salesnav-credential" | "no-salesnav-credential" | "unknown";
  quotas: Array<{
    kind: "enrichment" | "company";
    used: number;
    max: number;
    remaining: number;
    windowMs: number;
    label: string;
    nextFreeAt: number | null;
    level: "ok" | "warning" | "blocked";
    source: "override" | "default";
  }>;
}

/** Local calendar day, including DST. Rolling quotas intentionally use a different window. */
export function localDay(now: number) {
  const date = new Date(now);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
  return {
    start,
    end,
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
  };
}

/** Counts only observed identities. Unlinked Sales Navigator rows are never added as new people. */
export function readActivityMetrics(
  accountDir: string,
  activityRoot: string,
  now = Date.now()
): ActivityMetrics {
  const day = localDay(now);
  let unreadable = 0;
  const inDay = (value: unknown) => {
    const timestamp = typeof value === "number" ? value : Date.parse(string(value));
    return timestamp >= day.start && timestamp < day.end && timestamp <= now;
  };
  const read = (path: string): Row | null => {
    try {
      const row: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid record");
      return row as Row;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") unreadable++;
      return null;
    }
  };
  const entries = (path: string) => {
    try {
      return readdirSync(path, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") unreadable++;
      return [];
    }
  };
  const rows = (path: string): Row[] =>
    entries(path)
      .filter((file) => file.isFile() && file.name.endsWith(".json") && file.name !== "RECORD.json")
      .flatMap((file) => {
        const row = read(join(path, file.name));
        return row ? [row] : [];
      });

  const connections = rows(join(accountDir, "connections"));
  const people = rows(join(accountDir, "people"));
  const salesnav = rows(join(accountDir, "connections-salesnav"));
  const companies = rows(join(accountDir, "companies"));
  const network = entries(join(accountDir, "connections-of"))
    .filter((file) => file.isDirectory())
    .flatMap((file) => rows(join(accountDir, "connections-of", file.name)));
  const conversations = entries(accountDir)
    .filter((file) => file.isDirectory())
    .flatMap((file) => {
      const row = read(join(accountDir, file.name, "RECORD.json"));
      return row?.profileId ? [row] : [];
    });
  const allPeople = [...connections, ...people, ...salesnav, ...network, ...conversations];
  const memberToFlagship = new Map<string, Set<string>>();
  const flagshipToMember = new Map<string, Set<string>>();
  const salesnavToMember = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, value: string) => {
    if (!key || !value) return;
    const values = map.get(key) ?? new Set<string>();
    values.add(value);
    map.set(key, values);
  };
  for (const row of allPeople) {
    add(memberToFlagship, memberId(row), flagshipId(row));
    add(flagshipToMember, flagshipId(row), memberId(row));
    add(salesnavToMember, string(row.salesnavId), memberId(row));
  }
  const linkedFlagship = (member: string) => {
    const matches = memberToFlagship.get(member);
    const id = matches?.size === 1 ? [...matches][0] : undefined;
    return id && flagshipToMember.get(id)?.size === 1 ? id : "";
  };
  const resolvePerson = (id: string): string => {
    const members = salesnavToMember.get(id);
    const member = members?.size === 1 ? ([...members][0] ?? "") : /^\d+$/.test(id) ? id : "";
    return member
      ? linkedFlagship(member) || `salesnav:${member}`
      : id.startsWith("ACw")
        ? `salesnav:${id}`
        : id;
  };
  const rowKey = (row: Row) =>
    flagshipId(row) || resolvePerson(string(row.salesnavId) || memberId(row));
  const personIds = new Set<string>(),
    unlinked = new Set<string>();
  const todayPeople = new Set<string>(),
    todayUnlinked = new Set<string>(),
    todayCompanies = new Set<string>(),
    deepToday = new Set<string>();
  const addPerson = (key: string, today: boolean) => {
    if (!key) return;
    const unresolved = key.startsWith("salesnav:");
    (unresolved ? unlinked : personIds).add(key);
    if (today) (unresolved ? todayUnlinked : todayPeople).add(key);
  };
  const referencedCompanies = new Set<string>();
  for (const row of allPeople) {
    addPerson(
      rowKey(row),
      fields.some((field) => inDay(row[field]))
    );
    if (row.enrichDepth === "deep" && inDay(row.enrichedAt)) deepToday.add(rowKey(row));
    const roles = [
      row,
      ...[row.positions, row.currentPositions, row.pastPositions].flatMap((value) =>
        Array.isArray(value) ? value : []
      ),
    ];
    for (const role of roles) {
      const id = string(role?.companyUrn).match(
        /^urn:li:(?:fsd_company|fs_salesCompany|company):(\d+)$/
      )?.[1];
      if (id) referencedCompanies.add(id);
    }
  }
  for (const row of companies) if (inDay(row.fetchedAt)) todayCompanies.add(string(row.id));

  const attempts = { enrichment: new Map<number, number>(), company: new Map<number, number>() };
  const retained = { enrichment: new Map<number, number>(), company: new Map<number, number>() };
  const increment = (map: Map<number, number>, timestamp: number) =>
    map.set(timestamp, (map.get(timestamp) ?? 0) + 1);
  const retain = (kind: "enrichment" | "company", timestamps: number[]) => {
    const counts = new Map<number, number>();
    for (const timestamp of timestamps) if (inDay(timestamp)) increment(counts, timestamp);
    for (const [timestamp, count] of counts)
      retained[kind].set(timestamp, Math.max(count, retained[kind].get(timestamp) ?? 0));
  };
  const requests = new Map<string, ActivityEvent["request"]>();
  const savedKeys = new Set<string>();
  let saves = 0,
    repeatSaves = 0,
    failed = 0,
    skipped = 0;
  let activitySince: string | null = null,
    requestsSince: string | null = null;
  // Full journals, not the browser's 200-event tail or 20-run selector.
  for (const file of entries(activityRoot).filter(
    (file) => file.isFile() && /^run-\d{13}-[a-f0-9-]{36}\.jsonl$/.test(file.name)
  )) {
    try {
      const path = join(activityRoot, file.name);
      // A damaged/unbounded file must not freeze the observer. Report incomplete coverage.
      if (statSync(path).size > 64_000_000) {
        unreadable++;
        continue;
      }
      const lines = readFileSync(path, "utf8").split("\n");
      for (const [index, line] of lines.entries()) {
        if (!line) continue;
        let event: ActivityEvent;
        try {
          event = JSON.parse(line) as ActivityEvent;
        } catch {
          if (index < lines.length - 1) unreadable++;
          continue;
        } // concurrent partial append
        if (!Number.isFinite(Date.parse(event.at))) {
          unreadable++;
          continue;
        }
        if (activitySince === null || event.at < activitySince) activitySince = event.at;
        if (
          event.note === "Run started; request accounting enabled" &&
          (requestsSince === null || event.at < requestsSince)
        )
          requestsSince = event.at;
        if (event.quotaBaseline) {
          retain("enrichment", event.quotaBaseline.enrichment);
          retain("company", event.quotaBaseline.company);
        }
        if (!inDay(event.at)) continue;
        if (event.attempt && attempts[event.attempt.kind] && inDay(event.attempt.timestamp))
          increment(attempts[event.attempt.kind], event.attempt.timestamp);
        if (event.request?.id) {
          const previous = requests.get(event.request.id);
          if (!previous || event.request.outcome !== "started")
            requests.set(event.request.id, event.request);
        }
        if (!event.person) continue;
        const company = event.person.kind === "company";
        const key = company ? `company:${event.person.id}` : resolvePerson(event.person.id);
        if (event.status === "found" || event.status === "saved") {
          if (company) todayCompanies.add(event.person.id);
          else {
            // An event proves processing, not that a person remains in the store.
            if (key.startsWith("salesnav:")) todayUnlinked.add(key);
            else todayPeople.add(key);
          }
        }
        if (event.status === "saved") {
          saves++;
          if (savedKeys.has(key)) repeatSaves++;
          savedKeys.add(key);
        }
        if (event.status === "failed") failed++;
        if (event.status === "skipped") skipped++;
      }
    } catch {
      unreadable++;
    }
  }
  const beforeQuotaRead = unreadable;
  const config = read(join(accountDir, "config.json"));
  const rate = read(join(accountDir, "rate-state.json")) ?? {};
  const cookies = read(join(accountDir, "COOKIES.json"));
  const quotaInputsReadable = unreadable === beforeQuotaRead;
  const hasSeat = hasSalesNavSeat(cookies?.cookieJar);
  const quotaKinds = ["enrichment", "company"] as const;
  let retainedQuotaAttempts = 0;
  const quotas: ActivityMetrics["quotas"] = [];
  for (const kind of quotaKinds) {
    const value = rate[`${kind}Timestamps`];
    const timestamps = Array.isArray(value)
      ? value.filter((t): t is number => typeof t === "number" && Number.isFinite(t))
      : [];
    retain(kind, timestamps);
    for (const [timestamp, count] of retained[kind]) {
      const recorded = attempts[kind].get(timestamp) ?? 0;
      retainedQuotaAttempts += Math.max(0, count - recorded);
      attempts[kind].set(timestamp, Math.max(count, recorded)); // ledger and journal describe the same charged slot
    }
    if (!quotaInputsReadable) continue;
    const accountConfig = (config ?? {}) as unknown as AccountConfig;
    const window = resolveQuotaWindow(kind, accountConfig, hasSeat);
    if (
      !Number.isFinite(window.max) ||
      window.max < 0 ||
      !Number.isFinite(window.windowMs) ||
      window.windowMs <= 0
    ) {
      unreadable++;
      continue;
    }
    const status = new Quota(window, { timestamps }).status(now);
    const limits = accountConfig.rateLimit;
    const overridden =
      kind === "enrichment"
        ? limits?.maxEnrichments != null || limits?.enrichmentWindowMs != null
        : limits?.maxCompanyLookups != null || limits?.companyWindowMs != null;
    quotas.push({
      kind,
      ...status,
      windowMs: window.windowMs,
      label: describeWindow(window),
      source: overridden ? "override" : "default",
      level:
        status.remaining === 0 ? "blocked" : status.used / status.max >= 0.8 ? "warning" : "ok",
    });
  }
  const count = (map: Map<number, number>) => [...map.values()].reduce((a, b) => a + b, 0);
  const requestValues = [...requests.values()];
  return {
    date: day.date,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    asOf: new Date(now).toISOString(),
    inventory: {
      people: personIds.size,
      firstDegree: connections.filter((row) => row.source !== "enrich").length,
      salesnav: salesnav.length,
      unlinkedSalesnav: unlinked.size,
      deep: new Set(connections.filter((row) => row.enrichDepth === "deep").map(flagshipId)).size,
      companies: companies.length,
      referencedCompanies: referencedCompanies.size,
    },
    today: {
      people: todayPeople.size,
      unlinkedSalesnav: todayUnlinked.size,
      companies: todayCompanies.size,
      deep: deepToday.size,
      saves,
      repeatSaves,
      failed,
      skipped,
      enrichmentAttempts: count(attempts.enrichment),
      companyAttempts: count(attempts.company),
      requests: requests.size,
      salesnavRequests: requestValues.filter((r) => r?.backend === "salesnav").length,
      requestFailures: requestValues.filter(
        (r) =>
          r?.outcome === "network-error" || ((r?.statusCode ?? 0) >= 300 && r?.statusCode !== 304)
      ).length,
      rateLimited: requestValues.filter((r) => r?.statusCode === 429).length,
    },
    coverage: {
      activitySince,
      requestsSince,
      retainedQuotaAttempts,
      unreadable,
      identityConflicts: [
        ...memberToFlagship.values(),
        ...flagshipToMember.values(),
        ...salesnavToMember.values(),
      ].filter((values) => values.size > 1).length,
    },
    seat: cookies ? (hasSeat ? "salesnav-credential" : "no-salesnav-credential") : "unknown",
    quotas,
  };
}

/** Each viewer scans one account at most once per five seconds, regardless of SSE clients. */
export function createMetricsReader(accountDir: string, activityRoot: string) {
  let cached: ActivityMetrics | undefined,
    updated = 0;
  return () => {
    const now = Date.now();
    if (!cached || now - updated >= 5000 || cached.date !== localDay(now).date) {
      cached = readActivityMetrics(accountDir, activityRoot, now);
      updated = now;
    }
    return cached;
  };
}
