import { expect, it } from "vitest";
import { personFacts } from "@/relationships/facts.js";
import type { IcpDefinition } from "@/relationships/icp.js";
import { qualifyByRules } from "@/relationships/qualification.js";
import type { StoredPerson } from "@/store/people.js";

const now = Date.parse("2026-09-22T00:00:00Z"),
  iso = new Date(now).toISOString();
const definition: IcpDefinition = {
  id: "role",
  version: 1,
  name: "Role",
  description: "CFO",
  updatedAt: iso,
  maxAgeDays: 90,
  criteria: [
    { id: "role", description: "CFO", field: "title", operator: "equals-any", values: ["CFO"] },
  ],
};
const person: StoredPerson = {
  flagshipId: "ACoPerson",
  memberUrn: "urn:li:fsd_profile:ACoPerson",
  publicIdentifier: null,
  title: "CFO",
  firstSeenAt: "2020-01-01T00:00:00Z",
  lastSeenAt: iso,
};
it("does not make an unstamped legacy field fresh when its containing person was touched", () => {
  const facts = personFacts("account", person);
  expect(
    qualifyByRules(
      definition,
      { id: "p", name: "P", emails: [], tags: [], linkedin: [], facts },
      now
    ).match
  ).toBeNull();
});
it("uses the actual field observation timestamp when available", () => {
  const facts = personFacts("account", {
    ...person,
    provenance: { title: { source: "linkedin/enrich-core", observedAt: iso } },
  });
  expect(
    qualifyByRules(
      definition,
      { id: "p", name: "P", emails: [], tags: [], linkedin: [], facts },
      now
    ).match
  ).toBe(true);
});
it("does not make unstamped legacy company size fresh from the payload fetch time", () => {
  const company = {
    id: "1",
    staffCount: 200,
    fetchedAt: iso,
  } as import("@/store/connections-store.js").StoredCompany;
  const size = {
    ...definition,
    criteria: [
      {
        id: "size",
        description: "At least 100",
        field: "companySize" as const,
        operator: "gte" as const,
        values: [100],
      },
    ],
  };
  expect(
    qualifyByRules(
      size,
      {
        id: "p",
        name: "P",
        emails: [],
        tags: [],
        linkedin: [],
        facts: personFacts("account", person, company),
      },
      now
    ).match
  ).toBeNull();
});
