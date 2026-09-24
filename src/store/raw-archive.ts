import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { writePrivate } from "./private-workspace.js";

let enabled: boolean | undefined;
export function setRawCapture(value: boolean | undefined) {
  enabled = value;
}
export function rawCaptureEnabled(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  if (enabled !== undefined) return enabled;
  const value = process.env.ALLMAN_RAW?.trim().toLowerCase();
  if (!value) return false;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error("ALLMAN_RAW must be true/false, 1/0, yes/no, or on/off");
}

/** Content-addressed evidence outside Git. Repeated exports never rewrite old payloads. */
export async function archiveRaw(
  root: string,
  account: string,
  source: string,
  payload: unknown,
  observedAt = new Date().toISOString()
): Promise<string> {
  const hash = createHash("sha256")
    .update(JSON.stringify({ account, source, payload }))
    .digest("hex");
  const accountKey = createHash("sha256").update(account).digest("hex").slice(0, 20);
  const path = join(root, "raw", accountKey, `${hash}.json`);
  try {
    await access(path);
  } catch {
    await writePrivate(path, { schemaVersion: 1, account, source, observedAt, payload });
  }
  return path;
}
