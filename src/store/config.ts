import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** Shared across profile selections: the session registry and lock belong here. */
export function allmanConfigRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "allman");
}

/** No selector keeps the existing upstream/default-store behavior. */
export function profileConfigRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const root = allmanConfigRoot(env);
  let name: unknown = env.ALLMAN_PROFILE || undefined;
  if (name === undefined) {
    const file = join(root, "default-profile.json");
    if (!existsSync(file)) return undefined;
    try {
      name = JSON.parse(readFileSync(file, "utf8"))?.profile;
    } catch {
      throw new Error(`Invalid default profile configuration at ${file}`);
    }
  }
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name))
    throw new Error(
      "Invalid Allman profile: use 1-64 lowercase letters, digits, underscores or hyphens."
    );
  return join(root, name);
}

export function storeDefaultFile(): string {
  return join(profileConfigRoot() ?? allmanConfigRoot(), "default-store.json");
}

export function readStoreDefault(): string | undefined {
  const file = storeDefaultFile();
  if (!existsSync(file)) {
    if (dirname(file) !== allmanConfigRoot())
      throw new Error(
        `No default store configured for profile at ${file}. Run allman store use <path>.`
      );
    return undefined;
  }
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as { storePath?: unknown };
    if (!value || typeof value.storePath !== "string" || !isAbsolute(value.storePath))
      throw new Error("expected an absolute storePath");
    return value.storePath;
  } catch {
    throw new Error(
      `Invalid default store configuration at ${file}. Use --store or run allman store use <path>.`
    );
  }
}

export async function saveStoreDefault(path: string): Promise<void> {
  const file = storeDefaultFile();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ storePath: resolve(path) }, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
