import { createHash, randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { profileConfigRoot, readStoreDefault } from "./config.js";

function profileWorkspace(storePath: string): string | undefined {
  const profile = profileConfigRoot();
  if (!profile) return undefined;
  const configured = readStoreDefault();
  const canonical = (path: string) => (existsSync(path) ? realpathSync(path) : resolve(path));
  // Explicit --store must never join another store's private mail or contact evidence.
  return configured && canonical(configured) === canonical(storePath)
    ? join(profile, "relationships")
    : undefined;
}

export function workspaceRoot(storePath: string): string {
  const root = resolve(
    process.env.ALLMAN_RELATIONSHIP_STORE ??
      profileWorkspace(storePath) ??
      join(
        homedir(),
        ".local",
        "share",
        "allman",
        "relationship-workspaces",
        createHash("sha256").update(resolve(storePath)).digest("hex").slice(0, 20)
      )
  );
  const nested = relative(resolve(storePath), root);
  if (nested === "" || (!nested.startsWith("..") && !isAbsolute(nested))) {
    throw new Error(
      "Relationship workspace must be outside the LinkedIn store to keep mail out of Git."
    );
  }
  return root;
}
export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error(`Cannot read workspace record ${path}: ${(e as Error).message}`);
  }
}
export async function writePrivate(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await __write(tmp, value);
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
}
async function __write(path: string, value: unknown) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
}
export async function withWorkspaceLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, ".writer.lock");
  let lock: Awaited<ReturnType<typeof open>>;
  try {
    lock = await open(path, "wx", 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        `Workspace busy. Check the owner PID in ${path}; remove only after verifying it stopped.`
      );
    throw e;
  }
  await lock.writeFile(String(process.pid));
  try {
    return await fn();
  } finally {
    await lock.close();
    await rm(path, { force: true });
  }
}
