import { createHash } from "node:crypto";
import type { StoredConnection } from "../store/connections-store.js";
import type { TargetSnapshot } from "./lists.js";
import { normalizeLinkedInUrl } from "./people.js";

export type MatchOutcome =
  | "matched"
  | "missing-identity"
  | "not-in-account"
  | "identity-conflict"
  | "left-company"
  | "outside-list";
export interface TargetMatch {
  personId: string;
  name: string;
  companyIds: string[];
  flagshipId?: string;
  method?: "flagship-id" | "profile-url" | "handle";
  outcome: MatchOutcome;
}
export interface EnrichmentTarget {
  flagshipId: string;
  name: string;
  personIds: string[];
  companyIds: string[];
  methods: string[];
}
export interface EnrichmentPlan {
  version: 1;
  id: string;
  preparedAt: string;
  store: string;
  account: string;
  accountName: string;
  snapshot: TargetSnapshot;
  matches: TargetMatch[];
  targets: EnrichmentTarget[];
}
export const planHash = (plan: EnrichmentPlan) =>
  createHash("sha256").update(JSON.stringify(plan)).digest("hex");
export const adequateDeep = (row: StoredConnection) =>
  !!row.enrichedAt && row.enrichDepth === "deep";
const flagship = (value: string) => {
  const id = value.replace(/^urn:li:fsd_profile:/, "");
  return /^AC[ow][A-Za-z0-9_-]{10,}$/.test(id) ? id : undefined;
};
const slugKey = (value: string) => {
  const url = normalizeLinkedInUrl(value);
  return url ? decodeURIComponent(new URL(url).pathname.slice(4)) : undefined;
};

export function matchTargets(snapshot: TargetSnapshot, connections: StoredConnection[]) {
  const companyIds = new Set(snapshot.companies.map((company) => company.id));
  const eligible = connections.filter((c) => (c.source ?? "connections") === "connections");
  const byId = new Map(eligible.map((c) => [c.flagshipId, c]));
  const bySlug = new Map<string, Set<string>>();
  for (const c of eligible) {
    const key = c.publicIdentifier
      ? slugKey(`https://www.linkedin.com/in/${c.publicIdentifier}`)
      : undefined;
    if (key) bySlug.set(key, new Set([...(bySlug.get(key) ?? []), c.flagshipId]));
  }
  const matches: TargetMatch[] = snapshot.people.map((person) => {
    const currentCompanies = person.companies.filter((id) => companyIds.has(id));
    const ids = person.urns.map(flagship).filter((id): id is string => !!id);
    const urls = person.urls.map(slugKey).filter((key): key is string => !!key);
    const handles = person.handles.flatMap((value) => {
      const key = slugKey(value.includes("/") ? value : `https://www.linkedin.com/in/${value}`);
      return key ? [key] : [];
    });
    const evidence = new Map<string, TargetMatch["method"]>();
    for (const [keys, method] of [
      [handles, "handle"],
      [urls, "profile-url"],
      [ids, "flagship-id"],
    ] as const) {
      for (const key of keys) {
        const candidates = flagship(key)
          ? byId.has(key)
            ? [key]
            : []
          : [...(bySlug.get(key) ?? [])];
        for (const candidate of candidates) evidence.set(candidate, method);
      }
    }
    const found = [...evidence.keys()];
    const conflict = found.length > 1 || (found.length === 1 && ids.some((id) => id !== found[0]));
    const outcome: MatchOutcome =
      !currentCompanies.length && snapshot.source?.kind !== "salesnav"
        ? "outside-list"
        : conflict
          ? "identity-conflict"
          : !found.length
            ? ids.length || urls.length || handles.length
              ? "not-in-account"
              : "missing-identity"
            : person.left
              ? "left-company"
              : "matched";
    return {
      personId: person.id,
      name: person.name,
      companyIds: currentCompanies,
      ...(found.length === 1
        ? { flagshipId: found[0], method: evidence.get(found[0] as string) }
        : {}),
      outcome,
    };
  });
  const targets = new Map<string, EnrichmentTarget>();
  for (const match of matches) {
    if (match.outcome !== "matched" || !match.flagshipId) continue;
    const target = targets.get(match.flagshipId) ?? {
      flagshipId: match.flagshipId,
      name: match.name,
      personIds: [],
      companyIds: [],
      methods: [],
    };
    target.personIds = [...new Set([...target.personIds, match.personId])];
    target.companyIds = [...new Set([...target.companyIds, ...match.companyIds])];
    target.methods = [...new Set([...target.methods, match.method ?? "unknown"])];
    targets.set(match.flagshipId, target);
  }
  return { matches, targets: [...targets.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

const companyName = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\b(incorporated|corporation|limited|inc|corp|llc|llp|ltd)\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const companyId = (value?: string | null) =>
  value?.match(
    /^(?:urn:li:(?:fsd_company|company):|https?:\/\/(?:www\.)?linkedin\.com\/company\/)?(\d+)\/?$/
  )?.[1];

export function reviewTargets(
  plan: EnrichmentPlan,
  connections: StoredConnection[],
  links = plan.snapshot
) {
  const salesnav = plan.snapshot.source?.kind === "salesnav";
  const companyLinks = new Map(links.companies.map((c) => [c.id, c]));
  const personLinks = new Map(links.people.map((p) => [p.id, p]));
  const companyEntity = (id: string) => {
    const c = plan.snapshot.companies.find((c) => c.id === id);
    const linked = companyLinks.get(id) ?? c;
    const numeric = linked?.linkedinIds.map(companyId).find(Boolean);
    return {
      id,
      name: c?.name ?? id,
      attioUrl: linked?.webUrl ?? "",
      linkedinUrl:
        linked?.urls[0] || (numeric ? `https://www.linkedin.com/company/${numeric}/` : ""),
      website: linked?.domains[0] ? `https://${linked.domains[0]}` : "",
    };
  };
  const byId = new Map(connections.map((c) => [c.flagshipId, c]));
  const companyMap = new Map(plan.snapshot.companies.map((c) => [c.id, c]));
  const profiles = plan.targets.map((target) => {
    const row = byId.get(target.flagshipId);
    const expected = target.companyIds.flatMap((id) => companyMap.get(id) ?? []);
    const current = row?.positions?.filter((p) => p.current) ?? [];
    const currentIds = new Set(
      [row?.companyUrn, ...current.map((p) => p.companyUrn)].map(companyId).filter(Boolean)
    );
    const expectedIds = expected
      .flatMap((c) => [...c.linkedinIds, ...c.urls])
      .map(companyId)
      .filter(Boolean);
    const currentNames = [
      ...new Set([row?.company, ...current.map((p) => p.company)].filter((s): s is string => !!s)),
    ];
    const sameId = expectedIds.some((id) => currentIds.has(id));
    const sameName = expected.some((c) =>
      currentNames.some((name) => companyName(name) === companyName(c.name))
    );
    const employer = sameId
      ? "same-company-id"
      : sameName && !(currentIds.size && expectedIds.length)
        ? "same-company-name"
        : currentNames.length || currentIds.size
          ? "employer-review"
          : "unknown-employer";
    return {
      ...target,
      name: [row?.firstName, row?.lastName].filter(Boolean).join(" ") || target.name,
      attioName: target.name,
      headline: row?.headline ?? "",
      sourceUrls: target.personIds.flatMap((id) => personLinks.get(id)?.sourceUrl ?? []),
      attioUrls: target.personIds.flatMap((id) => personLinks.get(id)?.webUrl ?? []),
      companyEntities: target.companyIds.map(companyEntity),
      currentEntities: currentNames.map((name) => {
        const role = current.find((p) => p.company === name);
        const id = companyId(
          role?.companyUrn ?? (name === row?.company ? row?.companyUrn : undefined)
        );
        return { name, linkedinUrl: id ? `https://www.linkedin.com/company/${id}/` : "" };
      }),
      expectedCompanies: expected.map((c) => c.name),
      currentCompanies: currentNames,
      employer,
      employerEvidence: {
        expectedIds,
        currentIds: [...currentIds],
        reason: sameId
          ? `Current company ID matches ${salesnav ? "Sales Navigator list" : "Attio"}`
          : sameName && currentIds.size && expectedIds.length
            ? "Company names match but LinkedIn IDs differ; verify company mapping"
            : employer === "same-company-name"
              ? "Company name matches; numeric identity unavailable"
              : "No current role matched the target company; verify job change or company alias",
      },
      saved: !!row && adequateDeep(row),
      enrichedAt: row?.enrichedAt ?? null,
      title: row?.title ?? "",
      location: row?.location ?? "",
      about: row?.about ?? "",
      linkedinUrl: row?.publicIdentifier
        ? `https://www.linkedin.com/in/${encodeURIComponent(row.publicIdentifier)}`
        : "",
      positions: row?.positions ?? [],
      education: row?.education ?? [],
      skills: row?.skills ?? [],
    };
  });
  const matched = new Set(plan.targets.map((t) => t.flagshipId));
  const companyIds = new Set(
    plan.snapshot.companies.flatMap((c) => c.linkedinIds.map(companyId)).filter(Boolean)
  );
  const hints = connections
    .filter(
      (c) =>
        !salesnav && !matched.has(c.flagshipId) && (c.source ?? "connections") === "connections"
    )
    .flatMap((c) => {
      const idMatch = companyIds.has(companyId(c.companyUrn));
      const headline = ` ${companyName(c.headline ?? "")} `;
      const names = plan.snapshot.companies
        .filter((company) => {
          const name = companyName(company.name);
          return name.length >= 6 && headline.includes(` ${name} `);
        })
        .map((company) => company.name);
      return idMatch || names.length
        ? [
            {
              flagshipId: c.flagshipId,
              name: [c.firstName, c.lastName].filter(Boolean).join(" "),
              headline: c.headline ?? "",
              linkedinUrl: c.publicIdentifier
                ? `https://www.linkedin.com/in/${encodeURIComponent(c.publicIdentifier)}/`
                : "",
              companyEntities: plan.snapshot.companies
                .filter(
                  (co) =>
                    names.includes(co.name) ||
                    co.linkedinIds.some(
                      (id) => Boolean(companyId(id)) && companyId(id) === companyId(c.companyUrn)
                    )
                )
                .map((co) => companyEntity(co.id)),
              companies: names,
              reason: idMatch ? "stored-company-id" : "headline-only",
              selected: false,
            },
          ]
        : [];
    });
  const nameIndex = new Map<string, StoredConnection[]>();
  for (const row of connections.filter((c) => (c.source ?? "connections") === "connections")) {
    const key = companyName([row.firstName, row.lastName].filter(Boolean).join(" "));
    if (key.includes(" ")) nameIndex.set(key, [...(nameIndex.get(key) ?? []), row]);
  }
  const unmatched = plan.matches
    .filter((m) => m.outcome !== "matched")
    .map((m) => ({
      ...m,
      sourceUrl: personLinks.get(m.personId)?.sourceUrl ?? "",
      attioUrl: personLinks.get(m.personId)?.webUrl ?? "",
      linkedinUrl: personLinks.get(m.personId)?.urls.map(normalizeLinkedInUrl).find(Boolean) ?? "",
      companyEntities: m.companyIds.map(companyEntity),
      nameCandidates: (nameIndex.get(companyName(m.name)) ?? []).map((c) => ({
        flagshipId: c.flagshipId,
        publicIdentifier: c.publicIdentifier,
        headline: c.headline,
        evidence: "name-only; verify identity before linking or enriching",
        selected: false,
      })),
      companies: m.companyIds.map((id) => companyMap.get(id)?.name ?? id),
    }));
  return {
    version: 1,
    source: plan.snapshot.source,
    generatedAt: new Date().toISOString(),
    runId: plan.id,
    account: plan.account,
    accountName: plan.accountName,
    list: plan.snapshot.list,
    observedAt: plan.snapshot.observedAt,
    summary: {
      companies: plan.snapshot.companies.length,
      attioPeople: plan.snapshot.people.length,
      selected: profiles.length,
      saved: profiles.filter((p) => p.saved).length,
      employerReview: profiles.filter((p) => p.employer === "employer-review").length,
      missingIdentity: unmatched.filter((p) => p.outcome === "missing-identity").length,
      notInAccount: unmatched.filter((p) => p.outcome === "not-in-account").length,
      duplicateAttioRecords:
        plan.matches.filter((m) => m.outcome === "matched").length - profiles.length,
      nameReviewCandidates: unmatched.filter((m) => m.nameCandidates.length).length,
      additionalHints: hints.length,
    },
    companies: plan.snapshot.companies.map((c) => ({
      ...c,
      ...companyEntity(c.id),
      attioPeople: plan.snapshot.people.filter((p) => p.companies.includes(c.id)).length,
      selected: plan.targets.filter((t) => t.companyIds.includes(c.id)).length,
      saved: profiles.filter((p) => p.companyIds.includes(c.id) && p.saved).length,
    })),
    profiles,
    unmatched,
    hints,
  };
}
