import type { TimelineEvent } from "../store/relationships.js";
import type { RankOverride } from "./rank-overrides.js";

const DAY = 86_400_000;
export interface RelationshipScore {
  model: "history-v1";
  override?: RankOverride;
  score: number;
  derivedScore: number;
  pinned: boolean;
  computedAt: string;
  halfLifeDays: 90;
  decay: number;
  factors: Record<string, { points: number; maximum: number; explanation: string }>;
  signals: {
    inbound: number;
    outbound: number;
    threads: number;
    maxThreadLength: number;
    lastActivityAt: number | null;
    inboundReplyHours: number | null;
    outboundReplyHours: number | null;
  };
  evidence: string[];
  coverage: "none" | "partial" | "stored";
}
const round = (n: number) => Math.round(n * 100) / 100;
const meanHours = (values: number[]) =>
  values.length ? round(values.reduce((a, b) => a + b, 0) / values.length / 3_600_000) : null;

/** Deterministic prioritization heuristic, not a probability or social-standing judgment. */
export function relationshipScore(events: TimelineEvent[], now: number): RelationshipScore {
  const unique = new Map<string, TimelineEvent>();
  for (const e of events) {
    if (
      !e.eligible ||
      e.direct === false ||
      e.automated ||
      e.direction === "unknown" ||
      !Number.isFinite(e.timestamp) ||
      e.timestamp > now ||
      e.timestamp < 0
    )
      continue;
    unique.set(e.id, e);
  }
  const ordered = [...unique.values()].sort(
    (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)
  );
  const threads = new Map<string, TimelineEvent[]>();
  for (const e of ordered) threads.set(e.thread, [...(threads.get(e.thread) ?? []), e]);
  const inbound = ordered.filter((e) => e.direction === "inbound").length,
    outbound = ordered.length - inbound;
  const replies: Record<"inbound" | "outbound", number[]> = { inbound: [], outbound: [] };
  let inboundStarts = 0,
    maxThreadLength = 0;
  for (const thread of threads.values()) {
    if (thread[0]?.direction === "inbound") inboundStarts++;
    maxThreadLength = Math.max(maxThreadLength, thread.length);
    let previous: TimelineEvent | undefined;
    for (const e of thread) {
      if (previous && previous.direction !== e.direction && e.direction !== "unknown")
        replies[e.direction].push(e.timestamp - previous.timestamp);
      previous = e;
    }
  }
  const lastActivityAt = ordered.at(-1)?.timestamp ?? null;
  const decay = lastActivityAt === null ? 0 : 2 ** (-(now - lastActivityAt) / DAY / 90);
  const balance = (a: number, b: number) => (a + b ? (2 * Math.min(a, b)) / (a + b) : 0);
  const replyTimes = [...replies.inbound, ...replies.outbound];
  const responsiveness = replyTimes.length
    ? replyTimes.reduce((n, t) => n + 1 / (1 + t / DAY), 0) / replyTimes.length
    : 0;
  const factor = (points: number, maximum: number, explanation: string) => ({
    points: round(points),
    maximum,
    explanation,
  });
  const factors = {
    volume: factor(
      25 * Math.min(1, Math.log2(ordered.length + 1) / Math.log2(33)),
      25,
      `${ordered.length} unique eligible human messages; saturates at 32`
    ),
    reciprocity: factor(
      20 * balance(inbound, outbound),
      20,
      `${inbound} inbound and ${outbound} outbound messages`
    ),
    depth: factor(
      15 * Math.min(1, maxThreadLength / 10),
      15,
      `Longest observed thread: ${maxThreadLength} messages`
    ),
    initiation: factor(
      10 * balance(inboundStarts, threads.size - inboundStarts),
      10,
      `First stored message in ${inboundStarts}/${threads.size} threads is inbound; truncated history may differ`
    ),
    responsiveness: factor(
      10 * responsiveness,
      10,
      `${replyTimes.length} direction changes within verified threads; one-day latency halves credit`
    ),
    activity: factor(
      ordered.length ? 20 : 0,
      20,
      "All factors decay with a 90-day inactivity half-life"
    ),
  };
  const score = round(Object.values(factors).reduce((n, f) => n + f.points, 0) * decay);
  return {
    model: "history-v1",
    score,
    derivedScore: score,
    pinned: false,
    computedAt: new Date(now).toISOString(),
    halfLifeDays: 90,
    decay: round(decay),
    factors,
    signals: {
      inbound,
      outbound,
      threads: threads.size,
      maxThreadLength,
      lastActivityAt,
      inboundReplyHours: meanHours(replies.inbound),
      outboundReplyHours: meanHours(replies.outbound),
    },
    evidence: ordered.map((e) => e.id),
    coverage:
      ordered.length === 0
        ? "none"
        : ordered.some((e) => e.coverage === "partial")
          ? "partial"
          : "stored",
  };
}
