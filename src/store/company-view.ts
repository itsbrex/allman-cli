import { createHash } from "node:crypto";
import { companyId } from "../linkedin/api/endpoints/companies.js";
import type { Provenance } from "./enricher.js";
import type { Store } from "./index.js";
import type { StoredPerson } from "./people.js";

export interface Affiliation {
  id: string;
  flagshipId: string;
  companyId: string;
  name: string | null;
  title: string | null;
  status: "current" | "past" | "unknown";
  startDate: string | null;
  endDate: string | null;
  provenance: Provenance | null;
}
/** Derived edges share the source's provenance; no guessed domain or employer identity. */
export function affiliationsFor(person: StoredPerson): Affiliation[] {
  const roles = [...(person.positions ?? [])];
  if (person.companyUrn && !roles.some((p) => p.current && p.companyUrn === person.companyUrn)) {
    roles.push({
      companyUrn: person.companyUrn,
      company: person.company ?? null,
      title: person.title ?? null,
      current: true,
      startDate: null,
      endDate: null,
      location: null,
      description: null,
      positionUrn: null,
      employmentTypeUrn: null,
      geoUrn: null,
    });
  }
  const edges = new Map<string, Affiliation>();
  for (const p of roles) {
    const id = p.companyUrn ? companyId(p.companyUrn) : null;
    if (!id) continue;
    const key = createHash("sha256")
      .update(JSON.stringify([person.flagshipId, id, p.positionUrn ?? p.title, p.startDate]))
      .digest("hex");
    edges.set(key, {
      id: key,
      flagshipId: person.flagshipId,
      companyId: id,
      name: p.company,
      title: p.title,
      status: p.current ? "current" : p.endDate ? "past" : "unknown",
      startDate: p.startDate,
      endDate: p.endDate,
      provenance: person.provenance?.positions ?? person.provenance?.companyUrn ?? null,
    });
  }
  return [...edges.values()];
}
export async function companyRollups(
  store: Store,
  account: string,
  target?: string,
  currentOnly = false
) {
  const peopleStore = store.peopleFor(account),
    cstore = store.connectionsFor(account);
  const people: StoredPerson[] = [];
  for (const id of await peopleStore.listPersonIds()) {
    const p = await peopleStore.readPerson(id);
    if (p) people.push(p);
  }
  const allEdges = people.flatMap(affiliationsFor);
  const ids = new Set([...(await cstore.listCompanyIds()), ...allEdges.map((e) => e.companyId)]);
  const conversations = store.forAccount(account);
  const threads = [];
  for (const id of await conversations.list()) {
    const c = await conversations.read(id);
    if (c) threads.push(c);
  }
  const rows = [];
  for (const id of ids) {
    const company = await cstore.readCompany(id);
    const affiliations = allEdges.filter(
      (e) => e.companyId === id && (!currentOnly || e.status === "current")
    );
    const name = company?.canonicalName ?? company?.name ?? affiliations[0]?.name ?? id;
    if (
      target &&
      id !== companyId(target) &&
      ![name, company?.universalName, ...(company?.domains ?? [])].some((v) =>
        v?.toLowerCase().includes(target.toLowerCase())
      )
    )
      continue;
    const personIds = new Set(affiliations.map((e) => e.flagshipId));
    rows.push({
      account,
      id,
      name,
      company,
      affiliations,
      people: people.filter((p) => personIds.has(p.flagshipId)),
      recentThreads: threads
        .filter((c) => personIds.has(c.profileId))
        .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""))
        .slice(0, 10),
      coverage: {
        people: people.length,
        withAffiliations: new Set(allEdges.map((e) => e.flagshipId)).size,
      },
    });
  }
  const collisions: { key: string; companyIds: string[] }[] = [];
  const keys = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const key of [row.name.toLowerCase(), ...(row.company?.domains ?? [])]) {
      if (!key) continue;
      const members = keys.get(key) ?? new Set<string>();
      members.add(row.id);
      keys.set(key, members);
    }
  }
  for (const [key, members] of keys)
    if (members.size > 1) collisions.push({ key, companyIds: [...members] });
  return { companies: rows, mergeReview: collisions };
}
