import { join } from "node:path";
import { readJson, writePrivate } from "../store/private-workspace.js";
import { validateLocalName } from "../utils/local-name.js";

export const FACT_FIELDS = [
  "title",
  "headline",
  "company",
  "geo",
  "industry",
  "about",
  "companySize",
  "companyDescription",
] as const;
export type FactField = (typeof FACT_FIELDS)[number];
export type Criterion = {
  id: string;
  description: string;
  field?: FactField;
  operator?: "contains-any" | "equals-any" | "gte" | "lte";
  values?: (string | number)[];
};
export interface IcpInput {
  name: string;
  description: string;
  criteria: Criterion[];
  maxAgeDays: number;
  reference?: { path: string; sha256: string };
}
export interface IcpDefinition extends IcpInput {
  id: string;
  version: number;
  updatedAt: string;
}
interface IcpDefinitions {
  schemaVersion: 1;
  definitions: Record<string, IcpDefinition[]>;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, label: string, max = 20000): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${label} must be nonempty text (up to ${max} characters)`);
}
export function parseIcpInput(value: unknown): IcpInput {
  if (!record(value)) throw new Error("ICP definition must be an object");
  text(value.name, "name", 200);
  text(value.description, "description");
  const raw = value.criteria ?? [{ id: "fit", description: value.description }];
  if (!Array.isArray(raw) || !raw.length || raw.length > 50)
    throw new Error("Supply 1–50 criteria");
  const ids = new Set<string>();
  const criteria: Criterion[] = raw.map((c) => {
    if (!record(c)) throw new Error("Invalid criterion");
    text(c.id, "criterion id", 80);
    validateLocalName(c.id);
    if (ids.has(c.id)) throw new Error("Duplicate criterion id");
    ids.add(c.id);
    text(c.description, "criterion description");
    if (c.field === undefined && c.operator === undefined && c.values === undefined)
      return { id: c.id, description: c.description };
    if (
      !FACT_FIELDS.includes(c.field as FactField) ||
      !["contains-any", "equals-any", "gte", "lte"].includes(String(c.operator)) ||
      !Array.isArray(c.values) ||
      !c.values.length ||
      c.values.length > 50
    )
      throw new Error("Invalid structured criterion");
    const numeric = c.operator === "gte" || c.operator === "lte";
    if (
      numeric
        ? c.field !== "companySize" ||
          c.values.length !== 1 ||
          typeof c.values[0] !== "number" ||
          !Number.isFinite(c.values[0]) ||
          c.values[0] < 0
        : c.values.some((v) => typeof v !== "string" || !v.trim() || v.length > 1000)
    )
      throw new Error("Invalid criterion values");
    return {
      id: c.id,
      description: c.description,
      field: c.field as FactField,
      operator: c.operator as Criterion["operator"],
      values: c.values as (string | number)[],
    };
  });
  const maxAgeDays = value.maxAgeDays ?? 90;
  if (
    typeof maxAgeDays !== "number" ||
    !Number.isInteger(maxAgeDays) ||
    maxAgeDays < 1 ||
    maxAgeDays > 3650
  )
    throw new Error("maxAgeDays must be 1–3650");
  let reference: IcpInput["reference"];
  if (value.reference !== undefined) {
    if (
      !record(value.reference) ||
      typeof value.reference.path !== "string" ||
      typeof value.reference.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.reference.sha256)
    )
      throw new Error("Invalid source reference");
    reference = { path: value.reference.path, sha256: value.reference.sha256 };
  }
  return {
    name: value.name,
    description: value.description,
    criteria,
    maxAgeDays,
    ...(reference ? { reference } : {}),
  };
}
export const readIcps = (root: string) =>
  readJson<IcpDefinitions>(join(root, "icp/definitions.json"), {
    schemaVersion: 1,
    definitions: {},
  });
export async function getIcp(root: string, id: string): Promise<IcpDefinition> {
  validateLocalName(id);
  const state = await readIcps(root);
  const definition = Object.hasOwn(state.definitions, id)
    ? state.definitions[id]?.at(-1)
    : undefined;
  if (!definition) throw new Error(`Unknown ICP: ${id}`);
  return definition;
}
/** Caller holds workspace lock; all revisions remain available. */
export async function defineIcp(root: string, id: string, value: unknown, now = Date.now()) {
  validateLocalName(id);
  const input = parseIcpInput(value),
    state = await readIcps(root);
  const versions = state.definitions[id] ?? [],
    previous = versions.at(-1);
  if (previous) {
    const { id: _id, version: _version, updatedAt: _updatedAt, ...old } = previous;
    if (JSON.stringify(old) === JSON.stringify(input)) return previous;
  }
  const next: IcpDefinition = {
    ...input,
    id,
    version: (previous?.version ?? 0) + 1,
    updatedAt: new Date(now).toISOString(),
  };
  state.definitions[id] = [...versions, next];
  await writePrivate(join(root, "icp/definitions.json"), state);
  return next;
}
