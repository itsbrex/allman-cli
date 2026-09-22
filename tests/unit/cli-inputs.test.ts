import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const entry = resolve(import.meta.dirname, "../../src/index.ts");

it.each([
  ["connections", "--limit", "NaN"],
  ["connections", "--page-size", "1x"],
  ["enrich", "--limit", "0"],
  ["companies", "--limit", "-1"],
  ["sync", "--limit", "1.5"],
  ["messages", "synthetic", "--limit", "Infinity"],
  ["connections-of", "synthetic", "--limit", "2oops"],
])("rejects invalid numeric bounds before touching a store: %j", (...args) => {
  const root = mkdtempSync(join(tmpdir(), "allman-cli-input-"));
  try {
    const result = spawnSync("bun", [entry, "--store", join(root, "store"), ...args], {
      encoding: "utf8",
      env: { ...process.env, ALLMAN_ACCOUNT: "synthetic" },
      timeout: 10000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("positive integer");
    expect(readdirSync(root)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
