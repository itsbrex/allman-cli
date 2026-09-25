import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writePrivate } from "../store/private-workspace.js";

export interface ArchiveChange {
  stage: "identities" | "fields" | "history";
  path: string;
  before: string | null;
  after: unknown;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Back up exact bytes before any writes. Refuse concurrent changes; interruption is replayable. */
export async function applyArchiveChanges(root: string, changes: ArchiveChange[], report: unknown) {
  if (!changes.length) return null;
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const dir = join(root, "linkedin-imports", "backups", id);
  const entries = changes.map((change, index) => ({
    path: change.path,
    stage: change.stage,
    beforeHash: change.before === null ? null : hash(change.before),
    beforeFile: change.before === null ? null : join(dir, `${index}.before.json`),
    afterHash: hash(`${JSON.stringify(change.after, null, 2)}\n`),
  }));
  const journal = { version: 1, state: "prepared", applied: 0, entries, report };
  // Check every target before creating a journal or touching source data.
  for (const change of changes)
    if ((await readOptionalFile(change.path)) !== change.before)
      throw new Error(`Store changed during archive planning: ${change.path}`);
  await writePrivate(join(dir, "journal.json"), journal);
  for (let i = 0; i < changes.length; i++) {
    const before = changes[i]?.before,
      path = entries[i]?.beforeFile;
    if (before !== null && before !== undefined && path)
      await writeFile(path, before, { mode: 0o600, flag: "wx" });
  }
  for (const change of changes) {
    if ((await readOptionalFile(change.path)) !== change.before)
      throw new Error(`Store changed during archive import. Recovery journal: ${dir}`);
    await writePrivate(change.path, change.after);
    journal.applied++;
  }
  // Per-file before/after hashes also identify partial writes if interrupted before this stamp.
  journal.state = "complete";
  await writePrivate(join(dir, "journal.json"), journal);
  return dir;
}
