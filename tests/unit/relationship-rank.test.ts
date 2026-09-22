import { expect, it } from "vitest";
import { relationshipScore } from "@/relationships/rank.js";
import type { TimelineEvent } from "@/store/relationships.js";

const now = Date.parse("2026-09-22T00:00:00Z"),
  day = 86400000;
function e(
  id: string,
  direction: TimelineEvent["direction"],
  timestamp = now,
  patch: Partial<TimelineEvent> = {}
): TimelineEvent {
  return {
    id,
    direction,
    timestamp,
    thread: "one",
    contactIds: ["p"],
    channel: "linkedin",
    account: "a",
    subject: "",
    body: "private content",
    source: "local",
    references: [],
    eligible: true,
    coverage: "partial",
    ...patch,
  };
}
it("explains directional counts, latency and decay without exposing message bodies", () => {
  const events = [
    e("1", "outbound", now - day),
    e("2", "inbound", now),
    e("3", "inbound", now - day, { thread: "two" }),
  ];
  const score = relationshipScore(events, now);
  expect(score.signals).toMatchObject({
    inbound: 2,
    outbound: 1,
    threads: 2,
    inboundReplyHours: 24,
    outboundReplyHours: null,
  });
  expect(score.coverage).toBe("partial");
  expect(relationshipScore(events, now + 90 * day).score).toBeCloseTo(score.score / 2, 1);
  expect(JSON.stringify(score)).not.toContain("private content");
});
it("ignores automation, groups, unknown direction, future timestamps and duplicate messages", () => {
  const good = e("1", "inbound");
  expect(
    relationshipScore(
      [
        good,
        good,
        e("2", "outbound", now, { automated: true }),
        e("3", "unknown"),
        e("4", "outbound", now + 1),
        e("5", "outbound", now, { direct: false }),
      ],
      now
    ).signals
  ).toMatchObject({ inbound: 1, outbound: 0 });
  expect(relationshipScore([], now)).toMatchObject({ score: 0, coverage: "none", evidence: [] });
});
it("rewards reciprocal history and never joins reply latency across threads", () => {
  const oneWay = [e("1", "outbound", now - day), e("2", "outbound")];
  const twoWay = [e("1", "outbound", now - day), e("2", "inbound")];
  expect(relationshipScore(twoWay, now).score).toBeGreaterThan(
    relationshipScore(oneWay, now).score
  );
  expect(
    relationshipScore(
      [e("1", "outbound", now - day), e("2", "inbound", now, { thread: "other" })],
      now
    ).signals.inboundReplyHours
  ).toBeNull();
});
