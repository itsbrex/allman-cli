import { createHash } from "node:crypto";
import type { StoredCompany } from "../store/connections-store.js";
import type { StoredPerson } from "../store/people.js";
import type { FactField } from "./icp.js";
export interface ContactFact {
  id: string;
  field: FactField;
  value: string | number;
  source: string;
  observedAt: string;
  subject: string;
}
export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function personFacts(
  account: string,
  person: StoredPerson,
  company?: StoredCompany | null
): ContactFact[] {
  const facts: ContactFact[] = [];
  const append = (
    field: FactField,
    value: unknown,
    source: string,
    observedAt: string,
    subject: string
  ) => {
    if (
      (typeof value !== "string" || !value.trim()) &&
      (typeof value !== "number" || !Number.isFinite(value))
    )
      return;
    const fact = { field, value: value as string | number, source, observedAt, subject };
    facts.push({ ...fact, id: digest(fact).slice(0, 24) });
  };
  for (const field of ["title", "headline", "company", "industry", "about", "geo"] as const) {
    const key = field === "geo" ? (person.geoName ? "geoName" : "location") : field;
    append(
      field,
      person[key],
      person.provenance?.[key]?.source ?? "linkedin/stored",
      person.provenance?.[key]?.observedAt ?? person.lastSeenAt,
      `${account}/people/${person.flagshipId}`
    );
  }
  if (company) {
    for (const [field, key] of [
      ["companySize", "staffCount"],
      ["companyDescription", "description"],
    ] as const)
      append(
        field,
        company[key],
        company.provenance?.[key]?.source ?? "linkedin/company",
        company.provenance?.[key]?.observedAt ?? company.fetchedAt,
        `${account}/companies/${company.id}`
      );
  }
  return facts;
}
export const uniqueFacts = (facts: ContactFact[]) =>
  [...new Map(facts.map((f) => [f.id, f])).values()].sort((a, b) => a.id.localeCompare(b.id));
