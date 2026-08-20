/**
 * `allman connections --geo` — the local structured-geo query (ADR-0001).
 *
 * Answered entirely from records already on disk (person records + connection
 * mirrors): no network, no authenticated session. The index is
 * `geoUrn → { name, count }`, built on the fly from the store; coverage
 * (`n structured / m total`) is always reported so sparse data stays visible
 * rather than silent. Coverage grows where enrichment already happens — there
 * is deliberately no backfill (ADR-0001).
 */
import type { GeoGranularity } from "../linkedin/api/endpoints/profile-detail.js";
import { resolveStorePath, Store, type StoredPerson } from "../store/index.js";
import * as output from "../utils/output.js";

const GRANULARITIES: ReadonlyArray<string> = ["metro", "country", "unknown"];
const GEO_URN_PREFIX = "urn:li:fsd_geo:";

export interface GeoQueryOptions {
  account?: string;
  store?: string;
  /** Stream matches as NDJSON instead of the human list. */
  json?: boolean;
  /**
   * Geo filters, OR-ed: `urn:li:fsd_geo:<id>` matches `geoUrn` exactly;
   * anything else is a case-insensitive substring match on `geoName`.
   */
  geo: string[];
  /** Keep only records whose geo precision matches (metro|country|unknown). */
  granularity?: string;
}

export async function connectionsGeoQuery(opts: GeoQueryOptions): Promise<void> {
  if (opts.granularity && !GRANULARITIES.includes(opts.granularity)) {
    output.error(`--geo-granularity must be one of: ${GRANULARITIES.join(", ")}.`, 1);
    return;
  }

  const store = new Store({ path: resolveStorePath(opts.store) });
  await store.init();
  let profileId: string;
  try {
    profileId = await store.accounts.getDefault(opts.account);
  } catch (err) {
    output.error(String((err as Error).message), 1);
    return;
  }

  const pstore = store.peopleFor(profileId);
  const ids = await pstore.listPersonIds();
  if (ids.length === 0) {
    output.error("No stored connections. Run `allman connections` first.", 1);
    return;
  }

  const people: StoredPerson[] = [];
  for (const id of ids) {
    const p = await pstore.readPerson(id);
    if (p) people.push(p);
  }

  // The local geo index: geoUrn → { name, count } over everything on disk.
  const index = new Map<string, { name: string | null; count: number }>();
  let structured = 0;
  for (const p of people) {
    if (!p.geoUrn) continue;
    structured += 1;
    const entry = index.get(p.geoUrn) ?? { name: p.geoName ?? null, count: 0 };
    entry.count += 1;
    if (!entry.name && p.geoName) entry.name = p.geoName;
    index.set(p.geoUrn, entry);
  }

  const matches = people.filter((p) => matchesGeoFilters(p, opts.geo, opts.granularity, index));

  if (opts.json) {
    for (const p of matches) {
      output.emitEvent({
        flagshipId: p.flagshipId,
        publicIdentifier: p.publicIdentifier,
        firstName: p.firstName ?? null,
        lastName: p.lastName ?? null,
        title: p.title ?? null,
        company: p.company ?? null,
        location: p.location ?? null,
        country: p.country ?? null,
        geoUrn: p.geoUrn ?? null,
        geoName: p.geoName ?? null,
        geoGranularity: (p.geoGranularity ?? "unknown") as GeoGranularity,
      });
    }
  } else {
    for (const p of matches) {
      const name =
        [p.firstName, p.lastName].filter(Boolean).join(" ") || p.publicIdentifier || p.flagshipId;
      const role = [p.title, p.company].filter(Boolean).join(", ");
      const geoLabel = p.geoName ?? p.location ?? "(no geo)";
      output.info(`  ${name}${role ? ` — ${role}` : ""} — ${geoLabel}`);
    }
  }
  output.success(
    `${matches.length} match${matches.length === 1 ? "" : "es"}. ` +
      `Geo coverage: ${structured} structured / ${people.length} total.`
  );
}

function matchesGeoFilters(
  p: StoredPerson,
  geoFilters: string[],
  granularity: string | undefined,
  index: Map<string, { name: string | null; count: number }>
): boolean {
  // Records written before granularity existed count as "unknown".
  if (granularity && (p.geoGranularity ?? "unknown") !== granularity) return false;
  if (geoFilters.length === 0) return true;
  if (!p.geoUrn) return false;
  const name = (p.geoName ?? index.get(p.geoUrn)?.name ?? "").toLowerCase();
  return geoFilters.some((f) =>
    f.startsWith(GEO_URN_PREFIX) ? p.geoUrn === f : name.includes(f.toLowerCase())
  );
}
