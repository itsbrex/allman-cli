import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { defineIcp, getIcp, parseIcpInput, readIcps } from "@/relationships/icp.js";

it("versions multiple private ICPs, preserving old definitions and ignoring identical updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "allman-icp-"));
  try {
    const input = { name: "Hiring", description: "Engineering leaders" };
    expect((await defineIcp(root, "hiring", input, 0)).version).toBe(1);
    expect((await defineIcp(root, "hiring", input, 1)).version).toBe(1);
    await defineIcp(root, "hiring", { ...input, description: "Engineering leaders in London" }, 2);
    await defineIcp(root, "sales", { name: "Sales", description: "CFOs" }, 3);
    expect((await getIcp(root, "hiring")).version).toBe(2);
    expect((await readIcps(root)).definitions.hiring).toHaveLength(2);
    expect(Object.keys((await readIcps(root)).definitions)).toHaveLength(2);
    expect((await stat(join(root, "icp/definitions.json"))).mode & 0o777).toBe(0o600);
    await expect(getIcp(root, "constructor")).rejects.toThrow("Name");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("validates structured criteria without inventing absent constraints", () => {
  expect(parseIcpInput({ name: "Fit", description: "Natural language only" }).criteria).toEqual([
    { id: "fit", description: "Natural language only" },
  ]);
  const input = {
    name: "Fit",
    description: "Company size",
    criteria: [
      {
        id: "size",
        description: "At least 50 people",
        field: "companySize",
        operator: "gte",
        values: [50],
      },
    ],
  };
  expect(parseIcpInput(input).criteria).toHaveLength(1);
  expect(() => parseIcpInput({ ...input, maxAgeDays: 0 })).toThrow("maxAgeDays");
  expect(() =>
    parseIcpInput({ ...input, criteria: [...input.criteria, ...input.criteria] })
  ).toThrow("Duplicate");
  expect(() =>
    parseIcpInput({ ...input, criteria: [{ ...input.criteria[0], field: "name" }] })
  ).toThrow("structured");
});
