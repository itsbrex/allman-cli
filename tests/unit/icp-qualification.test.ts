import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { ContactFact } from "@/relationships/facts.js";
import type { IcpDefinition } from "@/relationships/icp.js";
import {
  parseQualificationImport,
  qualificationExport,
  qualificationFingerprint,
  qualificationView,
  qualifyByRules,
  readQualifications,
  saveQualifications,
} from "@/relationships/qualification.js";
import type { RelationshipContact } from "@/store/relationships.js";

const now = Date.parse("2026-09-22T00:00:00Z");
const definition: IcpDefinition = {
  id: "sales",
  version: 1,
  name: "Sales",
  description: "CFOs at larger companies",
  maxAgeDays: 90,
  updatedAt: new Date(now).toISOString(),
  criteria: [
    { id: "role", description: "CFO", field: "title", operator: "equals-any", values: ["CFO"] },
    {
      id: "size",
      description: "At least 100",
      field: "companySize",
      operator: "gte",
      values: [100],
    },
  ],
};
const fact = (
  id: string,
  field: ContactFact["field"],
  value: string | number,
  observedAt = now
): ContactFact => ({
  id,
  field,
  value,
  observedAt: new Date(observedAt).toISOString(),
  source: "fixture",
  subject: "fixture/person",
});
const contact: RelationshipContact = {
  id: "p",
  name: "Person",
  emails: ["private@example.test"],
  linkedin: [],
  tags: [],
  facts: [fact("role", "title", "CFO"), fact("size", "companySize", 500)],
};
function envelope() {
  const result = qualifyByRules(definition, contact, now);
  return {
    schemaVersion: 1,
    icpId: "sales",
    icpVersion: 1,
    qualifications: [{ ...result, confidence: 0.9 }],
  };
}
it("separates missing, conflicting, stale and negative evidence", () => {
  expect(qualifyByRules(definition, contact, now)).toMatchObject({ match: true, confidence: 1 });
  expect(
    qualifyByRules(definition, { ...contact, facts: [fact("role", "title", "CFO")] }, now)
  ).toMatchObject({ match: null, confidence: 0 });
  expect(
    qualifyByRules(definition, { ...contact, facts: [fact("role", "title", "Analyst")] }, now).match
  ).toBe(false);
  expect(
    qualifyByRules(
      definition,
      { ...contact, facts: [...(contact.facts ?? []), fact("other", "title", "Analyst")] },
      now
    ).match
  ).toBeNull();
  expect(
    qualifyByRules(
      definition,
      { ...contact, facts: [fact("role", "title", "CFO", now - 91 * 86400000)] },
      now
    ).match
  ).toBeNull();
});
it("invalidates results when definition, facts or evidence age changes", () => {
  const q = qualifyByRules(definition, contact, now);
  expect(qualificationView(q, definition, contact, now).freshness).toBe("fresh");
  expect(qualificationView(q, { ...definition, version: 2 }, contact, now).staleReasons).toContain(
    "ICP definition changed"
  );
  expect(qualificationView(q, definition, { ...contact, facts: [] }, now).staleReasons).toContain(
    "Contact evidence changed"
  );
  expect(qualificationView(q, definition, contact, now + 91 * 86400000).freshness).toBe("stale");
});
it("exports bounded facts without email data and validates model claims against evidence", () => {
  const exported = qualificationExport(definition, [contact]);
  expect(JSON.stringify(exported)).not.toContain("private@example.test");
  expect(exported.contacts[0]?.fingerprint).toBe(
    qualificationFingerprint(definition, contact.facts ?? [])
  );
  expect(parseQualificationImport(envelope(), definition, [contact], now)[0]).toMatchObject({
    method: "llm-import",
    match: true,
  });
  const forged = envelope();
  const result = forged.qualifications[0];
  if (!result) throw new Error("fixture");
  required(result.criteria[0]).evidence = ["invented"];
  expect(() => parseQualificationImport(forged, definition, [contact], now)).toThrow(
    "fresh evidence"
  );
  expect(() =>
    parseQualificationImport(envelope(), { ...definition, version: 2 }, [contact], now)
  ).toThrow("version");
  expect(() =>
    parseQualificationImport(envelope(), definition, [{ ...contact, facts: [] }], now)
  ).toThrow("fingerprint");
});
it("rejects contradictory overall claims, missing criteria and unsupported certainty", () => {
  const wrong = envelope();
  required(wrong.qualifications[0]).match = false;
  expect(() => parseQualificationImport(wrong, definition, [contact], now)).toThrow("Overall");
  const missing = envelope();
  required(missing.qualifications[0]).criteria.pop();
  expect(() => parseQualificationImport(missing, definition, [contact], now)).toThrow("coverage");
  const noEvidence = envelope();
  required(required(noEvidence.qualifications[0]).criteria[0]).evidence = [];
  expect(() => parseQualificationImport(noEvidence, definition, [contact], now)).toThrow(
    "evidence"
  );
});
it("keeps manual overrides across batch qualification and journals replacements", async () => {
  const root = await mkdtemp(join(tmpdir(), "allman-qualification-"));
  try {
    const rule = qualifyByRules(definition, contact, now);
    await saveQualifications(root, [rule]);
    await saveQualifications(
      root,
      [{ ...rule, match: false, method: "manual", reasoning: "Operator review" }],
      true
    );
    expect(await saveQualifications(root, [rule])).toEqual({ written: 0, preservedOverrides: 1 });
    expect((await readQualifications(root)).results.sales?.p?.match).toBe(false);
    await saveQualifications(root, [rule], true);
    expect((await readQualifications(root)).history).toHaveLength(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture");
  return value;
}
