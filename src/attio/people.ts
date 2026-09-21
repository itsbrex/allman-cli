import { join } from "node:path";
import { readJson, writePrivate } from "../store/private-workspace.js";

/** Public profile URLs only. Never follow redirects or treat SalesNav IDs as public IDs. */
export function normalizeLinkedInUrl(value: string): string | null {
  try {
    const url = new URL(
      value.trim().match(/^https?:\/\//i) ? value.trim() : `https://${value.trim()}`
    );
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !/^(?:(?:www|m|[a-z]{2})\.)?linkedin\.com$/i.test(url.hostname)
    )
      return null;
    const match = url.pathname.match(/^\/in\/([^/]+)\/?$/i);
    if (!match?.[1]) return null;
    const decoded = decodeURIComponent(match[1]).normalize("NFC");
    if (!/^[\p{L}\p{N}_-]+$/u.test(decoded)) return null;
    // Encoded LinkedIn member identifiers are case-sensitive; vanity handles are not.
    const slug = /^AC[ow][A-Za-z0-9_-]{10,}$/.test(decoded) ? decoded : decoded.toLowerCase();
    return `https://www.linkedin.com/in/${encodeURIComponent(slug)}`;
  } catch {
    return null;
  }
}
export interface AttioPerson {
  workspaceId: string;
  recordId: string;
  webUrl: string;
  name: string;
  linkedin: string[];
  emails: string[];
}
export interface AttioLookup {
  linkedinUrl: string;
  checkedAt: string;
  source: "attio-api" | "attio-mcp";
  status: "matched" | "not-found" | "ambiguous" | "unavailable";
  complete: boolean;
  matches: AttioPerson[];
  error?: string;
}
export interface AttioCache {
  schemaVersion: 1;
  lookups: Record<string, AttioLookup>;
}
type RawRecord = {
  id?: { workspace_id?: string; record_id?: string };
  web_url?: string;
  values?: Record<string, Array<Record<string, unknown>>>;
};
export function parseAttioPerson(raw: unknown): AttioPerson {
  const record = raw as RawRecord;
  const workspaceId = record?.id?.workspace_id,
    recordId = record?.id?.record_id;
  if (
    typeof workspaceId !== "string" ||
    !workspaceId ||
    typeof recordId !== "string" ||
    !recordId ||
    !record.values
  )
    throw new Error("Invalid Attio person response");
  const active = (slug: string) =>
    (record.values?.[slug] ?? []).filter((v) => v.active_until == null);
  const linkedin = active("linkedin").flatMap((v) =>
    typeof v.value === "string"
      ? [normalizeLinkedInUrl(v.value)].filter((s): s is string => !!s)
      : []
  );
  const emails = active("email_addresses").flatMap((v) =>
    typeof v.email_address === "string" && /^[^\s<>@]+@[^\s<>@]+$/.test(v.email_address)
      ? [v.email_address.toLowerCase()]
      : []
  );
  const name = active("name").find((v) => typeof v.full_name === "string")?.full_name;
  const webUrl =
    typeof record.web_url === "string" && /^https:\/\/app\.attio\.com\//.test(record.web_url)
      ? record.web_url
      : "";
  return {
    workspaceId,
    recordId,
    webUrl,
    name: typeof name === "string" ? name : "",
    linkedin: [...new Set(linkedin)],
    emails: [...new Set(emails)],
  };
}
export function exactAttioLookup(
  url: string,
  raw: unknown[],
  complete = true,
  checkedAt = new Date().toISOString(),
  source: AttioLookup["source"] = "attio-api"
): AttioLookup {
  const linkedinUrl = normalizeLinkedInUrl(url);
  if (!linkedinUrl || !Number.isFinite(Date.parse(checkedAt)))
    throw new Error("Invalid Attio lookup URL or timestamp");
  const matches = [
    ...new Map(
      raw
        .map(parseAttioPerson)
        .filter((p) => p.linkedin.includes(linkedinUrl))
        .map((p) => [`${p.workspaceId}/${p.recordId}`, p])
    ).values(),
  ];
  return {
    linkedinUrl,
    checkedAt,
    source,
    complete,
    matches,
    status: !complete
      ? "unavailable"
      : matches.length === 1
        ? "matched"
        : matches.length > 1
          ? "ambiguous"
          : "not-found",
  };
}
export const readAttioCache = (root: string) =>
  readJson<AttioCache>(join(root, "attio-lookups.json"), { schemaVersion: 1, lookups: {} });
export async function storeAttioLookups(root: string, lookups: AttioLookup[]) {
  const cache = await readAttioCache(root);
  for (const lookup of lookups) cache.lookups[lookup.linkedinUrl] = lookup;
  await writePrivate(join(root, "attio-lookups.json"), cache);
}
/** The only network endpoint in this adapter is Attio's read-only record query. */
export class AttioPeopleSource {
  constructor(
    private readonly token: string,
    private readonly request: typeof fetch = fetch
  ) {}
  async lookup(value: string): Promise<AttioLookup> {
    const url = normalizeLinkedInUrl(value);
    if (!url) throw new Error("Use a public linkedin.com/in/ profile URL");
    const slug = decodeURIComponent(new URL(url).pathname.slice(4));
    const raw: unknown[] = [];
    try {
      for (let offset = 0; offset < 5000; offset += 100) {
        const response = await this.request(
          "https://api.attio.com/v2/objects/people/records/query",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ filter: { linkedin: { $contains: slug } }, limit: 100, offset }),
            signal: AbortSignal.timeout(30000),
            redirect: "error",
          }
        );
        if (!response.ok) throw new Error(`Attio query failed (HTTP ${response.status})`);
        const page = (await response.json()) as { data?: unknown[] };
        if (!Array.isArray(page.data)) throw new Error("Invalid Attio query response");
        raw.push(...page.data);
        if (page.data.length < 100) return exactAttioLookup(url, raw);
      }
      return exactAttioLookup(url, raw, false);
    } catch (error) {
      // Never include response bodies, headers, or credentials in errors or stored evidence.
      return {
        linkedinUrl: url,
        checkedAt: new Date().toISOString(),
        source: "attio-api",
        complete: false,
        matches: [],
        status: "unavailable",
        error:
          error instanceof Error && /^Attio query failed \(HTTP \d+\)$/.test(error.message)
            ? error.message
            : "Attio lookup failed; retry before deciding whether this person exists",
      };
    }
  }
}
