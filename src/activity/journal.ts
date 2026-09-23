import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export type RunStatus = "running" | "finished" | "failed" | "interrupted" | "quota";
export type PersonStatus = "processing" | "found" | "saved" | "skipped" | "failed";
export interface PersonInput {
  name?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  publicIdentifier?: string | null;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  headline?: string | null;
}
export interface ActivityPerson {
  id: string;
  name: string;
  slug?: string;
  title?: string;
  company?: string;
  location?: string;
  kind?: "company";
}
export interface ActivityRequest {
  id: string;
  backend: "flagship" | "salesnav";
  outcome: "started" | "response" | "network-error";
  statusCode?: number;
}
export interface ActivityEvent {
  sequence: number;
  at: string;
  stage: string;
  status: PersonStatus | RunStatus | "phase" | "attempt" | "request" | "quota-baseline";
  person?: ActivityPerson;
  note?: string;
  attempt?: { kind: "enrichment" | "company"; timestamp: number };
  request?: ActivityRequest;
  quotaBaseline?: { enrichment: number[]; company: number[] };
}
export interface ActivityState {
  version: 1;
  id: string;
  pid: number;
  command: string;
  account: string;
  label: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  status: RunStatus;
  stage: string;
  total: number | null;
  phaseDone: number;
  nextFreeAt?: number;
  counts: { found: number; saved: number; skipped: number; failed: number };
  current: ActivityPerson | null;
  sequence: number;
  events: ActivityEvent[];
}
export interface ActivitySnapshot {
  run: ActivityState | null;
  runs: Array<Omit<ActivityState, "events" | "current">>;
}
const RUN_ID = /^run-\d{13}-[a-f0-9-]{36}$/;
const clean = (value: string | null | undefined) =>
  value
    ?.replace(/\p{Cc}/gu, " ")
    .slice(0, 240)
    .trim() || undefined;

/** Explicit projection: never spread API records, cookies, message bodies, or errors. */
function personView(id: string, input: PersonInput): ActivityPerson {
  return {
    id: clean(id) ?? "unknown",
    name:
      clean(
        input.name || input.fullName || [input.firstName, input.lastName].filter(Boolean).join(" ")
      ) ||
      clean(input.publicIdentifier) ||
      clean(id) ||
      "Unknown person",
    slug: clean(input.publicIdentifier),
    title: clean(input.title || input.headline),
    company: clean(input.company),
    location: clean(input.location),
  };
}

export class ActivityRun {
  readonly id = `run-${Date.now()}-${randomUUID()}`;
  readonly state: ActivityState;
  private lastFlush = 0;
  private ended = false;
  constructor(
    readonly root: string,
    options: { command: string; account: string; label: string }
  ) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
    const now = new Date().toISOString();
    this.state = {
      version: 1,
      id: this.id,
      pid: process.pid,
      command: clean(options.command) ?? "unknown",
      account: clean(options.account) ?? "unknown",
      label: clean(options.label) ?? "Allman",
      startedAt: now,
      updatedAt: now,
      status: "running",
      stage: "Starting",
      total: null,
      phaseDone: 0,
      counts: { found: 0, saved: 0, skipped: 0, failed: 0 },
      current: null,
      sequence: 0,
      events: [],
    };
    this.emit({ status: "running", note: "Run started; request accounting enabled" });
    this.flush();
  }
  phase(stage: string, total?: number): void {
    this.state.stage = clean(stage) ?? "Processing";
    this.state.total =
      typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : null;
    this.state.phaseDone = 0;
    this.state.current = null;
    this.emit({ status: "phase" });
  }
  person(
    status: PersonStatus,
    id: string,
    input: PersonInput = {},
    note?: string,
    kind?: "company"
  ): void {
    const person = personView(id, input);
    if (kind) person.kind = kind;
    if (status === "processing") this.state.current = person;
    else {
      this.state.counts[status]++;
      if (status !== "found") this.state.phaseDone++;
      if (this.state.current?.id === person.id) this.state.current = null;
    }
    this.emit({ status, person, note: clean(note) });
  }
  attempt(kind: "enrichment" | "company", timestamp: number): void {
    this.emit({ status: "attempt", attempt: { kind, timestamp } });
  }
  request(request: ActivityRequest): void {
    this.emit({ status: "request", request });
  }
  baseline(enrichment: number[], company: number[]): void {
    this.emit({ status: "quota-baseline", quotaBaseline: { enrichment, company } });
  }
  quota(nextFreeAt: number | null): void {
    this.state.status = "quota";
    this.state.nextFreeAt = nextFreeAt ?? undefined;
    this.emit({
      status: "quota",
      note: "Stopped at the account quota. Resume when capacity returns.",
    });
    this.flush();
  }
  private emit(event: Omit<ActivityEvent, "sequence" | "at" | "stage">): void {
    if (this.ended) return;
    const row = {
      ...event,
      sequence: ++this.state.sequence,
      at: new Date().toISOString(),
      stage: this.state.stage,
    };
    appendFileSync(join(this.root, `${this.id}.jsonl`), `${JSON.stringify(row)}\n`, {
      mode: 0o600,
    });
    this.state.events.push(row);
    if (this.state.events.length > 200) this.state.events.shift();
    if (Date.now() - this.lastFlush >= 100) this.flush();
  }
  flush(): void {
    this.state.updatedAt = new Date().toISOString();
    const file = join(this.root, `${this.id}.json`);
    const temp = `${file}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.state)}\n`, { mode: 0o600 });
    renameSync(temp, file);
    this.lastFlush = Date.now();
  }
  finish(status: Exclude<RunStatus, "running" | "quota">): void {
    if (this.ended) return;
    if (status === "failed" && this.state.current) {
      const person = this.state.current;
      this.person(
        "failed",
        person.id,
        person,
        "Processing stopped before a successful result",
        person.kind
      );
    }
    this.state.status =
      this.state.status === "quota" && status !== "interrupted" ? "quota" : status;
    this.state.current = null;
    this.state.finishedAt = new Date().toISOString();
    this.emit({ status: this.state.status });
    this.ended = true;
    this.flush();
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
const cache = new Map<string, { stamp: string; state: ActivityState }>();
export function readActivitySnapshot(
  root: string,
  selected?: string,
  isAlive = alive
): ActivitySnapshot {
  if (selected && !RUN_ID.test(selected)) throw new Error("Invalid activity run");
  if (!existsSync(root)) return { run: null, runs: [] };
  const files = readdirSync(root)
    .filter((f) => f.endsWith(".json") && RUN_ID.test(f.slice(0, -5)))
    .sort()
    .reverse()
    .slice(0, 20);
  if (selected && !files.includes(`${selected}.json`) && existsSync(join(root, `${selected}.json`)))
    files.push(`${selected}.json`);
  const states: ActivityState[] = [];
  for (const file of files) {
    const path = join(root, file);
    const stat = statSync(path);
    if (stat.size > 2_000_000) continue;
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    let entry = cache.get(path);
    if (entry?.stamp !== stamp) {
      try {
        const state = JSON.parse(readFileSync(path, "utf8")) as ActivityState;
        if (state.version !== 1 || state.id !== file.slice(0, -5) || !Array.isArray(state.events))
          continue;
        entry = { stamp, state };
        if (cache.size > 100) cache.clear();
        cache.set(path, entry);
      } catch {
        continue;
      }
    }
    if (!entry) continue;
    let state = entry.state;
    if (state.status === "running" && !isAlive(state.pid))
      state = { ...state, status: "interrupted", current: null };
    states.push(state);
  }
  return {
    run: (selected ? states.find((s) => s.id === selected) : states[0]) ?? null,
    runs: states.map(({ events: _events, current: _current, ...summary }) => summary),
  };
}

let current: ActivityRun | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
function safely(action: (run: ActivityRun) => void): void {
  if (!current) return;
  try {
    action(current);
  } catch {
    current = undefined;
    clearInterval(heartbeat);
    process.stderr.write("Activity journal unavailable; terminal progress continues.\n");
  }
}
export function beginActivity(
  root: string,
  options: { command: string; account: string; label: string }
): void {
  finishActivity("interrupted");
  current = new ActivityRun(root, options);
  heartbeat = setInterval(() => safely((run) => run.flush()), 5000);
  heartbeat.unref();
}
export function activityPhase(stage: string, total?: number): void {
  safely((run) => run.phase(stage, total));
}
export function activityPerson(
  status: PersonStatus,
  id: string,
  input: PersonInput = {},
  note?: string
): void {
  safely((run) => run.person(status, id, input, note));
}
export function activityCompany(
  status: PersonStatus,
  id: string,
  input: PersonInput = {},
  note?: string
): void {
  safely((run) => run.person(status, id, input, note, "company"));
}
export function activityAttempt(kind: "enrichment" | "company", timestamp: number): void {
  safely((run) => run.attempt(kind, timestamp));
}
export function activityBaseline(enrichment: number[], company: number[]): void {
  safely((run) => run.baseline(enrichment, company));
}
/** Record dispatches, not estimated requests per profile; never include URLs or payloads. */
export function activityRequestStarted(
  backend: ActivityRequest["backend"]
): ActivityRequest | undefined {
  if (!current) return undefined;
  const request: ActivityRequest = { id: randomUUID(), backend, outcome: "started" };
  safely((run) => run.request(request));
  return request;
}
export function activityRequestFinished(
  request: ActivityRequest | undefined,
  statusCode?: number
): void {
  if (request)
    safely((run) =>
      run.request({
        ...request,
        outcome: statusCode === undefined ? "network-error" : "response",
        statusCode,
      })
    );
}
export function activityQuota(nextFreeAt: number | null): void {
  safely((run) => run.quota(nextFreeAt));
}
export function finishActivity(status: Exclude<RunStatus, "running" | "quota">): void {
  clearInterval(heartbeat);
  safely((run) => run.finish(status));
  current = undefined;
}
