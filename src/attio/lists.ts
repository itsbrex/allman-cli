import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { allmanConfigRoot } from "../store/config.js";
import { readJson } from "../store/private-workspace.js";

export interface TargetCompany {
  webUrl?: string;
  id: string;
  name: string;
  linkedinIds: string[];
  urls: string[];
  domains: string[];
}
export interface TargetPerson {
  sourceUrl?: string;
  webUrl?: string;
  id: string;
  name: string;
  companies: string[];
  urls: string[];
  urns: string[];
  handles: string[];
  left: boolean;
}
export interface TargetSnapshot {
  source?: { kind: "salesnav"; url: string; account: string };
  version: 1;
  complete: true;
  observedAt: string;
  list: { id: string; name: string };
  companies: TargetCompany[];
  people: TargetPerson[];
}
type Value = Record<string, unknown>;
type RecordData = {
  web_url?: string;
  id: { record_id: string };
  values: Record<string, Value[]>;
};
const active = (record: RecordData, key: string) =>
  (record.values[key] ?? []).filter((value) => value.active_until == null);
const strings = (values: Value[], field = "value") =>
  values.flatMap((v) => (typeof v[field] === "string" ? [v[field] as string] : []));
export const attioSourceConfig = () => join(allmanConfigRoot(), "attio-source.json");

/** Read the existing connector credential in memory; never copy it into run artifacts. */
export async function attioToken(): Promise<string> {
  const direct = process.env.ATTIO_API_KEY || process.env.ATTIO_ACCESS_TOKEN;
  if (direct) return direct;
  const config = await readJson<{ codexConfig?: string }>(attioSourceConfig(), {});
  if (!config.codexConfig)
    throw new Error("Configure ATTIO_API_KEY or run enrich-list auth --codex-config <path>");
  const runtime = globalThis as unknown as {
    Bun?: { TOML: { parse: (text: string) => unknown } };
  };
  if (!runtime.Bun?.TOML)
    throw new Error(
      "Codex credential references require the Bun CLI; alternatively use ATTIO_API_KEY"
    );
  try {
    const parsed = runtime.Bun.TOML.parse(await readFile(config.codexConfig, "utf8")) as {
      mcp_servers?: Record<string, { env?: Record<string, string> }>;
    };
    const token = parsed.mcp_servers?.["attio-code-mode"]?.env?.ATTIO_API_KEY;
    if (!token || token.startsWith("op://") || token.startsWith("${"))
      throw new Error("unresolved");
    return token;
  } catch {
    throw new Error("Cannot resolve the configured Attio connector credential; use ATTIO_API_KEY");
  }
}

/** Only read endpoints are exposed. Pagination caps fail closed, never produce partial shortlists. */
export class AttioListSource {
  constructor(
    private token: string,
    private request: typeof fetch = fetch
  ) {}

  async query(path: string, body?: Record<string, unknown>): Promise<{ data: unknown[] }> {
    const response = await this.request(`https://api.attio.com/v2/${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Attio read failed (HTTP ${response.status})`);
    const value = (await response.json()) as { data?: unknown[] };
    if (!Array.isArray(value.data)) throw new Error("Invalid Attio read response");
    return { data: value.data };
  }

  async lists() {
    const result = await this.query("lists");
    return (result.data as { id: { list_id: string }; name: string; parent_object: string[] }[])
      .filter((list) => list.parent_object.length === 1 && list.parent_object[0] === "companies")
      .map((list) => ({ id: list.id.list_id, name: list.name }));
  }

  async pages(path: string, filter?: Record<string, unknown>): Promise<unknown[]> {
    const rows: unknown[] = [];
    for (let offset = 0; offset < 100000; offset += 100) {
      const result = await this.query(path, { ...(filter ? { filter } : {}), limit: 100, offset });
      rows.push(...result.data);
      if (result.data.length < 100) return rows;
    }
    throw new Error("Attio pagination cap reached; no complete shortlist can be prepared");
  }

  async snapshot(listId: string): Promise<TargetSnapshot> {
    const list = (await this.lists()).find((item) => item.id === listId);
    if (!list) throw new Error("Choose an accessible Attio company list ID");
    const entries = (await this.pages(`lists/${encodeURIComponent(listId)}/entries/query`)) as {
      parent_object: string;
      parent_record_id: string;
    }[];
    if (entries.some((entry) => entry.parent_object !== "companies"))
      throw new Error("List contains a non-company entry");
    const ids = [...new Set(entries.map((entry) => entry.parent_record_id))];
    const companies: TargetCompany[] = [],
      people: TargetPerson[] = [];
    for (let start = 0; start < ids.length; start += 50) {
      const batch = ids.slice(start, start + 50);
      const records = await this.pages("objects/companies/records/query", {
        record_id: { $in: batch },
      });
      for (const record of records as RecordData[])
        companies.push({
          id: record.id.record_id,
          webUrl: record.web_url,
          name: strings(active(record, "name"))[0] ?? "",
          linkedinIds: [
            ...active(record, "linkedin_company_id"),
            ...active(record, "linkedin_company_id_1749270669"),
          ].flatMap((v) =>
            typeof v.value === "string" || typeof v.value === "number" ? [String(v.value)] : []
          ),
          urls: strings(active(record, "linkedin")),
          domains: strings(active(record, "domains"), "domain"),
        });
      const contacts = await this.pages("objects/people/records/query", {
        company: { target_record_id: { $in: batch } },
      });
      for (const record of contacts as RecordData[])
        people.push({
          id: record.id.record_id,
          webUrl: record.web_url,
          name: strings(active(record, "name"), "full_name")[0] ?? "Unnamed person",
          companies: strings(active(record, "company"), "target_record_id"),
          urls: [
            ...strings(active(record, "linkedin")),
            ...strings(active(record, "kondo_linkedin_url")),
          ],
          urns: strings(active(record, "linkedin_urn")),
          handles: [
            ...strings(active(record, "linkedin_handle_1749266263")),
            ...strings(active(record, "kondo_linkedin_handle")),
          ],
          left: active(record, "pb_no_longer_at_company_1749266279").some((v) => v.value === true),
        });
    }
    if (new Set(companies.map((c) => c.id)).size !== ids.length)
      throw new Error("Some list companies could not be read; refusing an incomplete snapshot");
    return {
      version: 1,
      complete: true,
      observedAt: new Date().toISOString(),
      list,
      companies,
      people: [...new Map(people.map((p) => [p.id, p])).values()],
    };
  }
}

export function validateTargetSnapshot(value: unknown): asserts value is TargetSnapshot {
  const s = value as TargetSnapshot;
  const stringsOnly = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === "string");
  if (
    !s ||
    s.version !== 1 ||
    s.complete !== true ||
    (s.source !== undefined &&
      (s.source.kind !== "salesnav" ||
        !s.source.account ||
        s.source.url !== `https://www.linkedin.com/sales/lists/people/${s.list?.id}` ||
        !/^\d+$/.test(s.list?.id))) ||
    !s.list?.id ||
    !s.list.name ||
    !Number.isFinite(Date.parse(s.observedAt)) ||
    !Array.isArray(s.companies) ||
    !Array.isArray(s.people) ||
    s.companies.some(
      (c) =>
        !c.id ||
        typeof c.name !== "string" ||
        !stringsOnly(c.linkedinIds) ||
        !stringsOnly(c.urls) ||
        !stringsOnly(c.domains)
    ) ||
    s.people.some(
      (p) =>
        !p.id ||
        typeof p.name !== "string" ||
        !stringsOnly(p.companies) ||
        !stringsOnly(p.urls) ||
        !stringsOnly(p.urns) ||
        !stringsOnly(p.handles) ||
        typeof p.left !== "boolean"
    ) ||
    new Set(s.companies.map((c) => c.id)).size !== s.companies.length ||
    new Set(s.people.map((p) => p.id)).size !== s.people.length
  )
    throw new Error("Invalid or incomplete target snapshot");
}
