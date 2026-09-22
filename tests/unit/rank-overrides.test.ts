import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { relationshipScore } from "@/relationships/rank.js";
import {
  applyRankOverride,
  readRankOverrides,
  writeRankOverride,
} from "@/relationships/rank-overrides.js";

it("preserves derived evidence, audits overrides, and clears independently of pins", async () => {
  const root = await mkdtemp(join(tmpdir(), "allman-rank-test-"));
  try {
    const original = relationshipScore([], 0);
    const override = await writeRankOverride(
      root,
      "p",
      { score: 80, pin: true, reason: "Known relationship" },
      1
    );
    expect(applyRankOverride(original, override)).toMatchObject({
      score: 80,
      derivedScore: 0,
      pinned: true,
      evidence: [],
    });
    const cleared = await writeRankOverride(root, "p", { clear: true, reason: "Use history" }, 2);
    expect(applyRankOverride(original, cleared)).toMatchObject({ score: 0, pinned: true });
    expect((await readRankOverrides(root)).history).toHaveLength(2);
    await expect(writeRankOverride(root, "p", { score: 101, reason: "invalid" })).rejects.toThrow(
      "0–100"
    );
    await expect(writeRankOverride(root, "p", { score: 1 })).rejects.toThrow("reason");
    await expect(
      writeRankOverride(root, "p", { pin: true, unpin: true, reason: "invalid" })
    ).rejects.toThrow("Conflicting");
    expect((await readRankOverrides(root)).history).toHaveLength(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
