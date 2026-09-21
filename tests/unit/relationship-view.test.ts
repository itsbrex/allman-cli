import { describe, expect, it } from "vitest";
import { affiliationsFor } from "@/store/company-view.js";
import type { StoredPerson } from "@/store/people.js";
import {
  businessDaysSince,
  followUps,
  type RelationshipContact,
  type TimelineEvent,
} from "@/store/relationships.js";

const now = Date.parse("2026-09-21T19:00:00Z");
const person: RelationshipContact = { id: "p", name: "Person", emails: [], linkedin: [], tags: [] };
const event: TimelineEvent = {
  id: "m",
  thread: "one",
  contactIds: ["p"],
  channel: "email",
  account: "a",
  timestamp: Date.parse("2026-09-11T19:00:00Z"),
  direction: "outbound",
  subject: "",
  body: "Meeting?",
  source: "",
  references: [],
  eligible: true,
  coverage: "partial",
};
describe("relationship followups", () => {
  it("counts business days and labels incomplete email evidence", () => {
    expect(businessDaysSince(Date.parse("2026-09-18T19:00:00Z"), now)).toBe(1);
    expect(followUps([event], [person], {}, now)[0]).toMatchObject({
      kind: "awaiting-response",
      provisional: true,
    });
  });
  it("does not treat an automatic response as a human reply", () => {
    const automatic = {
      ...event,
      id: "auto-reply",
      direction: "inbound" as const,
      timestamp: now,
      eligible: false,
      automated: true,
    };
    expect(followUps([event, automatic], [person], {}, now)).toHaveLength(1);
    expect(followUps([automatic], [person], {}, now)).toHaveLength(0);
  });
  it("only acknowledges replies inside the same verified thread", () => {
    const reply = { ...event, id: "reply", direction: "inbound" as const, timestamp: now };
    expect(followUps([event, reply], [person], {}, now)).toHaveLength(0);
    expect(
      followUps([event, { ...reply, thread: "different-channel" }], [person], {}, now)
    ).toHaveLength(1);
  });
  it("new messages reactivate dismissed threads and automated messages do not create tasks", () => {
    const action = { one: { through: event.timestamp, dismissed: true } };
    expect(followUps([event], [person], action, now)).toHaveLength(0);
    expect(
      followUps([{ ...event, timestamp: event.timestamp + 1 }], [person], action, now)
    ).toHaveLength(1);
    expect(followUps([{ ...event, eligible: false }], [person], {}, now)).toHaveLength(0);
  });
});
describe("company affiliation view", () => {
  it("retains concurrent roles and leaves undated past status unknown", () => {
    const role = {
      title: "Advisor",
      company: "Example",
      current: true,
      companyUrn: "urn:li:fsd_company:1",
      startDate: null,
      endDate: null,
      location: null,
      description: null,
      positionUrn: null,
      employmentTypeUrn: null,
      geoUrn: null,
    };
    const p: StoredPerson = {
      flagshipId: "ACo1",
      memberUrn: "urn:li:fsd_profile:ACo1",
      publicIdentifier: null,
      firstSeenAt: "",
      lastSeenAt: "",
      positions: [
        role,
        { ...role, companyUrn: "urn:li:fsd_company:2" },
        { ...role, title: "Unknown history", current: false },
      ],
    };
    const edges = affiliationsFor(p);
    expect(edges).toHaveLength(3);
    expect(edges.map((e) => e.status)).toEqual(["current", "current", "unknown"]);
  });
});

describe("verified account copies", () => {
  it("keeps source accounts and joins a reply from either proven copy", async () => {
    const { coalesceTimeline } = await import("@/store/timeline.js");
    const original = { ...event, references: ["message-1"], thread: "a-thread" };
    const copy = { ...original, id: "copy", account: "b", thread: "b-thread" };
    const reply = {
      ...copy,
      id: "reply",
      references: ["message-2"],
      body: "Yes",
      direction: "inbound" as const,
      timestamp: now,
    };
    const joined = coalesceTimeline([original, copy, reply]);
    expect(joined).toHaveLength(2);
    expect(joined[0]?.sourceCopies?.map((c) => c.account)).toEqual(["a", "b"]);
    expect(joined[0]?.thread).toBe(joined[1]?.thread);
    expect(followUps(joined, [person], {}, now)).toHaveLength(0);
  });
  it("does not join reused Message-IDs with different bodies or participants", async () => {
    const { coalesceTimeline } = await import("@/store/timeline.js");
    expect(
      coalesceTimeline([
        { ...event, references: ["id"] },
        { ...event, id: "other", thread: "other", references: ["id"], body: "Changed" },
      ])
    ).toHaveLength(2);
  });
});
