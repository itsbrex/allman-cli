import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface BrowserConfig {
  channel?: string;
  executablePath?: string;
  profileDir?: string;
  cdpEndpoint?: string;
  shieldPath?: string;
}

const CONFIG_KEYS = ["channel", "executablePath", "profileDir", "cdpEndpoint", "shieldPath"];

export function browserWorkspace(env: Record<string, string | undefined> = process.env): string {
  return resolve(env.ALLMAN_BROWSER_WORKSPACE || join(homedir(), ".allman", "browser-workspace"));
}

export function readBrowserConfig(workspace = browserWorkspace()): BrowserConfig {
  const path = join(workspace, "config.json");
  if (!existsSync(path)) return {};
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("expected object");
    for (const [key, field] of Object.entries(value)) {
      if (!CONFIG_KEYS.includes(key) || typeof field !== "string" || !field.trim()) {
        throw new Error(`invalid field ${key}`);
      }
      if (["executablePath", "profileDir", "shieldPath"].includes(key) && !isAbsolute(field)) {
        throw new Error(`${key} must be absolute`);
      }
    }
    return value as BrowserConfig;
  } catch (error) {
    throw new Error(`Invalid browser configuration at ${path}: ${(error as Error).message}`);
  }
}

/** Persist only after the caller has verified the proposed browser and Shield. */
export async function saveBrowserConfig(config: BrowserConfig, workspace = browserWorkspace()) {
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  const temporary = join(workspace, `config-${process.pid}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, join(workspace, "config.json"));
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export function browserEnvDefaults(
  env: Record<string, string | undefined> = process.env
): BrowserConfig {
  return {
    channel: env.ALLMAN_BROWSER || undefined,
    executablePath: env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    profileDir: env.ALLMAN_BROWSER_PROFILE || undefined,
    cdpEndpoint: env.ALLMAN_CDP_URL || undefined,
    shieldPath: env.ALLMAN_SHIELD_PATH || undefined,
  };
}

/** A transport choice at a higher level replaces all lower-level transport choices. */
export function mergeBrowserConfig(...layers: BrowserConfig[]): BrowserConfig {
  let merged: BrowserConfig = {};
  for (const layer of layers) {
    if (layer.channel || layer.executablePath || layer.cdpEndpoint) {
      const { profileDir, shieldPath } = merged;
      merged = { profileDir, shieldPath };
    }
    for (const [key, value] of Object.entries(layer)) {
      if (CONFIG_KEYS.includes(key) && value) merged[key as keyof BrowserConfig] = value;
    }
  }
  return merged;
}

export function browserProfilePath(
  config: BrowserConfig,
  workspace: string,
  purpose: "login" | "capture",
  identity = "default"
): string {
  const identityKey = createHash("sha256").update(identity).digest("hex").slice(0, 20);
  if (config.profileDir) {
    return purpose === "login"
      ? resolve(config.profileDir)
      : join(resolve(config.profileDir), "allman-capture", identityKey);
  }
  const browserKey = createHash("sha256")
    .update(config.executablePath || config.channel || "auto")
    .digest("hex")
    .slice(0, 12);
  return join(workspace, "profiles", browserKey, purpose, identityKey);
}
