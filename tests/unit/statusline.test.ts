import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readStatuslineLimits } from "@/commands/statusline.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-statusline-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it("uses rolling local ledgers and overrides without pruning or writing them", async () => {
  const now = Date.now();
  const source = JSON.stringify({
    enrichmentTimestamps: [now - 2000, now - 1000, now - 86400001],
    inviteTimestamps: [now],
  });
  await writeFile(join(root, "rate-state.json"), source);
  await writeFile(join(root, "config.json"), JSON.stringify({ rateLimit: { maxEnrichments: 2 } }));
  const result = readStatuslineLimits(root, now);
  expect(result.quotas[0]).toMatchObject({
    used: 2,
    max: 2,
    remaining: 0,
    nextFreeAt: now - 2000 + 86400000,
  });
  expect(result.quotas[2]).toMatchObject({ used: 1, max: 10, remaining: 9 });
  expect(await readFile(join(root, "rate-state.json"), "utf8")).toBe(source);
});
it("reports unknown quota data instead of full capacity on malformed inputs", async () => {
  await writeFile(join(root, "rate-state.json"), '{"companyTimestamps":["bad"]}');
  expect(readStatuslineLimits(root)).toMatchObject({ available: false, quotas: [] });
});
