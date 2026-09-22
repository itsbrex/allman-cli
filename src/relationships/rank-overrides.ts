import { join } from "node:path";
import { readJson, writePrivate } from "../store/private-workspace.js";
import type { RelationshipScore } from "./rank.js";
export interface RankOverride {
  score?: number;
  pinned: boolean;
  reason: string;
  updatedAt: string;
}
export interface RankOverrides {
  schemaVersion: 1;
  contacts: Record<string, RankOverride>;
  history: { contactId: string; previous: RankOverride | null; next: RankOverride }[];
}
export const readRankOverrides = (root: string) =>
  readJson<RankOverrides>(join(root, "rank-overrides.json"), {
    schemaVersion: 1,
    contacts: {},
    history: [],
  });
export function applyRankOverride(
  rank: RelationshipScore,
  override: RankOverride | undefined
): RelationshipScore {
  if (!override) return rank;
  return { ...rank, score: override.score ?? rank.derivedScore, pinned: override.pinned, override };
}
export async function writeRankOverride(
  root: string,
  contactId: string,
  change: { score?: number; clear?: boolean; pin?: boolean; unpin?: boolean; reason?: string },
  now = Date.now()
) {
  if (!change.reason?.trim() || change.reason.length > 2000)
    throw new Error("Rank changes require --reason (1–2000 characters)");
  if (
    change.score !== undefined &&
    (!Number.isFinite(change.score) || change.score < 0 || change.score > 100)
  )
    throw new Error("Score must be 0–100");
  if ((change.pin && change.unpin) || (change.clear && change.score !== undefined))
    throw new Error("Conflicting rank options");
  const state = await readRankOverrides(root),
    previous = state.contacts[contactId] ?? null;
  const next: RankOverride = {
    ...(previous ?? {}),
    pinned: change.pin ? true : change.unpin ? false : (previous?.pinned ?? false),
    reason: change.reason.trim(),
    updatedAt: new Date(now).toISOString(),
  };
  if (change.clear) delete next.score;
  else if (change.score !== undefined) next.score = change.score;
  state.contacts[contactId] = next;
  state.history.push({ contactId, previous, next });
  await writePrivate(join(root, "rank-overrides.json"), state);
  return next;
}
