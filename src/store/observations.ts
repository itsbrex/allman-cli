import type { ObservationSet, Provenance } from "./enricher.js";

const RANK: Record<string, number> = {
  user: 4,
  "linkedin/enrich-deep": 3,
  "linkedin/enrich-core": 2,
  "linkedin/company": 2,
  "linkedin/sweep": 1,
};
export function meaningful(value: unknown): boolean {
  return (
    value !== undefined &&
    value !== null &&
    value !== "" &&
    !(Array.isArray(value) && value.length === 0)
  );
}

/** Validate the whole set before applying anything. Omission is not a deletion. */
export function applyFieldObservations(
  facts: Record<string, unknown>,
  stamps: Record<string, Provenance>,
  observations: ObservationSet,
  allowed: ReadonlySet<string>
): { facts: Record<string, unknown>; provenance: Record<string, Provenance> } {
  for (const [field, obs] of Object.entries(observations)) {
    if (!allowed.has(field)) throw new Error(`Unknown field in observation set: "${field}"`);
    if (!Number.isFinite(Date.parse(obs.provenance.observedAt)))
      throw new Error(`Invalid observation time: ${field}`);
    const confidence = obs.provenance.confidence;
    if (
      confidence !== undefined &&
      (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    )
      throw new Error(`Invalid observation confidence: ${field}`);
  }
  const next = { ...facts },
    provenance = { ...stamps };
  for (const [field, obs] of Object.entries(observations)) {
    if (!meaningful(obs.value) && !obs.authoritative) continue;
    const prev = provenance[field];
    if (prev?.source === "user" && obs.provenance.source !== "user") continue;
    const oldRank = RANK[prev?.source ?? ""] ?? 0;
    const newRank = RANK[obs.provenance.source] ?? 0;
    if (
      prev &&
      (oldRank > newRank ||
        (oldRank === newRank &&
          Date.parse(prev.observedAt) > Date.parse(obs.provenance.observedAt)))
    )
      continue;
    next[field] = obs.value;
    provenance[field] = obs.provenance;
  }
  return { facts: next, provenance };
}
