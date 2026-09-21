import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export function storeDefaultFile(): string {
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "allman",
    "default-store.json"
  );
}

export function readStoreDefault(): string | undefined {
  const file = storeDefaultFile();
  if (!existsSync(file)) return undefined;
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
