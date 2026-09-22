import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defineIcp, getIcp, readIcps } from "../relationships/icp.js";
import {
  parseQualificationImport,
  qualificationExport,
  qualifyByRules,
  saveQualifications,
} from "../relationships/qualification.js";
import { resolveStorePath, Store } from "../store/index.js";
import { withWorkspaceLock, workspaceRoot, writePrivate } from "../store/private-workspace.js";
import { relationshipSnapshot } from "../store/relationships.js";
import * as output from "../utils/output.js";
export interface IcpOptions {
  store?: string;
  json?: boolean;
  file?: string;
  contact?: string;
  limit?: number;
  offset?: number;
  staleOnly?: boolean;
  match?: string;
  reason?: string;
  clear?: boolean;
}
export async function icpCommand(action: string, id: string | undefined, opts: IcpOptions) {
  const allowed: Record<string, string[]> = {
    list: [],
    show: [],
    history: [],
    define: ["file"],
    results: ["contact"],
    qualify: ["contact", "limit", "offset", "staleOnly"],
    export: ["contact", "limit", "offset", "staleOnly"],
    import: ["file", "contact"],
    override: ["contact", "match", "reason", "clear"],
  };
  if (!Object.hasOwn(allowed, action)) throw new Error("Unknown ICP action");
  for (const [key, value] of Object.entries(opts)) {
    if (
      value !== undefined &&
      !["store", "json", "debug"].includes(key) &&
      !allowed[action]?.includes(key)
    )
      throw new Error(
        `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is not supported for icp ${action}`
      );
  }
  if (action === "list" && id) throw new Error("icp list takes no id; use icp show <id>");
  const root = workspaceRoot(resolveStorePath(opts.store));
  if (action === "list")
    return output.printData(
      Object.values((await readIcps(root)).definitions).map((versions) => versions.at(-1))
    );
  if (!id) throw new Error("Supply an ICP id");
  if (action === "show") return output.printData(await getIcp(root, id));
  if (action === "history") {
    await getIcp(root, id);
    return output.printData((await readIcps(root)).definitions[id]);
  }
  if (["qualify", "export", "import", "results", "override"].includes(action)) {
    const run = async () => {
      const definition = await getIcp(root, id);
      const snapshot = await relationshipSnapshot(
        new Store({ path: resolveStorePath(opts.store) }),
        root
      );
      let contacts = snapshot.contacts.filter((c) => !opts.contact || c.id === opts.contact);
      if (opts.contact && !contacts.length) throw new Error("Contact not found; use a contact id");
      if (action === "results")
        return output.printData(
          contacts.map((c) => ({
            contactId: c.id,
            name: c.name,
            qualification: c.qualifications?.[id] ?? null,
          }))
        );
      if (action === "import") {
        if (!opts.file) throw new Error("icp import requires --file");
        const results = parseQualificationImport(
          JSON.parse(await readFile(opts.file, "utf8")),
          definition,
          contacts
        );
        return output.printData(await saveQualifications(root, results));
      }
      if (action === "override") {
        if (!opts.contact || !opts.reason?.trim() || opts.reason.length > 10000)
          throw new Error("Override requires --contact and --reason");
        if (opts.clear && opts.match !== undefined)
          throw new Error("Use --clear or --match, not both");
        if (!opts.clear && !["yes", "no", "unknown"].includes(opts.match ?? ""))
          throw new Error("--match must be yes, no or unknown");
        const contact = contacts[0];
        if (!contact) throw new Error("Contact not found");
        const base = qualifyByRules(definition, contact);
        const result = opts.clear
          ? { ...base, reasoning: `Manual override cleared: ${opts.reason}. ${base.reasoning}` }
          : {
              ...base,
              method: "manual" as const,
              match: opts.match === "unknown" ? null : opts.match === "yes",
              confidence: opts.match === "unknown" ? 0 : 1,
              reasoning: opts.reason,
              criteria: [],
              evidence: [],
            };
        return output.printData(await saveQualifications(root, [result], true));
      }
      const limit = opts.limit ?? (action === "export" ? 25 : 100),
        offset = opts.offset ?? 0;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isInteger(offset) ||
        offset < 0
      )
        throw new Error("--limit must be 1–100; --offset must be a nonnegative integer");
      if (opts.staleOnly)
        contacts = contacts.filter(
          (c) => !c.qualifications?.[id] || c.qualifications[id]?.freshness !== "fresh"
        );
      if (opts.staleOnly && action === "qualify")
        contacts = contacts.filter((c) => c.qualifications?.[id]?.method !== "manual");
      contacts.sort((a, b) => a.id.localeCompare(b.id));
      const selected = contacts.slice(offset, offset + limit);
      if (action === "export") {
        const path = join(root, "icp/exports", `${id}-${Date.now()}.json`);
        await writePrivate(path, qualificationExport(definition, selected));
        return output.printData({
          path,
          contacts: selected.length,
          total: contacts.length,
          nextOffset: offset + selected.length < contacts.length ? offset + selected.length : null,
          externalCalls: 0,
        });
      }
      output.printData({
        ...(await saveQualifications(
          root,
          selected.map((c) => qualifyByRules(definition, c))
        )),
        total: contacts.length,
        nextOffset:
          offset + selected.length < contacts.length
            ? opts.staleOnly && action === "qualify"
              ? 0
              : offset + selected.length
            : null,
        externalCalls: 0,
      });
    };
    if (action === "results") return run();
    return withWorkspaceLock(root, run);
  }
  if (action !== "define") throw new Error("Use icp define, list, show or history");
  if (!opts.file) throw new Error("icp define requires --file <definition.json>");
  const value: unknown = JSON.parse(await readFile(opts.file, "utf8"));
  output.printData(await withWorkspaceLock(root, () => defineIcp(root, id, value)));
}
