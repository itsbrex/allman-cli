import { describe, expect, it } from "vitest";
import { applyFieldObservations } from "@/store/observations.js";

const fields = new Set(["location"]);
const stamp = (source: string, day: string) => ({ source, observedAt: `2026-09-${day}T00:00:00Z` });
describe("observation policy", () => {
  it("rejects stale equal-rank values and preserves user facts", () => {
    for (const source of ["user", "linkedin/enrich-core"]) {
      const r = applyFieldObservations(
        { location: "new" },
        { location: stamp(source, "19") },
        { location: { value: "old", provenance: stamp("linkedin/enrich-core", "18") } },
        fields
      );
      expect(r.facts.location).toBe("new");
    }
  });
  it("distinguishes sparse from authoritative empty observations", () => {
    const observation = { value: null, provenance: stamp("linkedin/enrich-deep", "19") };
    expect(
      applyFieldObservations({ location: "known" }, {}, { location: observation }, fields).facts
        .location
    ).toBe("known");
    expect(
      applyFieldObservations(
        { location: "known" },
        {},
        { location: { ...observation, authoritative: true } },
        fields
      ).facts.location
    ).toBeNull();
  });
  it("validates all fields before any application", () => {
    const facts = { location: "known" };
    expect(() =>
      applyFieldObservations(
        facts,
        {},
        { unknown: { value: "x", provenance: stamp("user", "19") } },
        fields
      )
    ).toThrow("Unknown field");
    expect(facts.location).toBe("known");
  });
});
