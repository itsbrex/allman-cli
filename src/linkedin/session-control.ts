import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { Command } from "commander";
import { allmanConfigRoot } from "../store/config.js";
import { resolveStorePath, Store } from "../store/index.js";
import {
  type BrowserConfig,
  browserEnvDefaults,
  browserWorkspace,
  mergeBrowserConfig,
  readBrowserConfig,
} from "./auth/browser-config.js";

export interface ManagedProfile {
  name: string;
  store: string;
  account: string;
  workspace: string;
  browser: BrowserConfig & { cdpEndpoint: string; shieldPath: string };
}
export interface SessionRegistry {
  version: 1;
  active: string | null;
  profiles: ManagedProfile[];
}
export function sessionControlRoot(): string {
  return allmanConfigRoot();
}
export function canonicalPath(path: string): string {
  const absolute = resolve(path);
  return existsSync(absolute) ? realpathSync(absolute) : absolute;
}
export function validateProfile(profile: ManagedProfile): void {
  if (
    !profile ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile.name) ||
    typeof profile.account !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(profile.account) ||
    ![profile.store, profile.workspace, profile.browser?.shieldPath].every(
      (p) => typeof p === "string" && isAbsolute(p)
    )
  )
    throw new Error("Invalid session control profile");
  const url = new URL(profile.browser.cdpEndpoint);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Session control requires a loopback HTTP CDP endpoint");
  if (profile.browser.profileDir && !isAbsolute(profile.browser.profileDir))
    throw new Error("Invalid session control browser profile directory");
}
export function readSessionRegistry(root = sessionControlRoot()): SessionRegistry | null {
  const path = join(root, "session-control.json");
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as SessionRegistry;
    if (
      value.version !== 1 ||
      !Array.isArray(value.profiles) ||
      !(value.active === null || typeof value.active === "string")
    )
      throw new Error("invalid schema");
    value.profiles.forEach(validateProfile);
    if (
      new Set(value.profiles.map((p) => p.name)).size !== value.profiles.length ||
      new Set(value.profiles.map((p) => new URL(p.browser.cdpEndpoint).href)).size !==
        value.profiles.length ||
      (value.active !== null && !value.profiles.some((p) => p.name === value.active))
    )
      throw new Error("duplicate or unknown profile");
    return value;
  } catch (error) {
    throw new Error(
      `Invalid session control configuration at ${path}: ${(error as Error).message}`
    );
  }
}
export function saveSessionRegistry(registry: SessionRegistry, root = sessionControlRoot()): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = join(root, "session-control.json");
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

/** One command across all stores/accounts. Unique owner files make stale cleanup race-safe. */
export function acquireLinkedInLock(operation: string, root = sessionControlRoot()): () => void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = join(root, "linkedin-command.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const files = readdirSync(lock);
      const [ownerFile] = files;
      const file =
        files.length === 1 && ownerFile && /^owner-[\w-]+\.json$/.test(ownerFile)
          ? join(lock, ownerFile)
          : null;
      let owner: { pid: number; operation: string } | null = null;
      try {
        if (file) owner = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        /* fail closed */
      }
      let dead = false;
      if (owner && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
        try {
          process.kill(owner.pid, 0);
        } catch (err) {
          dead = (err as NodeJS.ErrnoException).code === "ESRCH";
        }
      }
      if (!dead || !file || attempt > 0)
        throw new Error(
          `LinkedIn command already running${owner ? ` (PID ${owner.pid}, ${owner.operation})` : " or lock owner unreadable"}. Stop it before starting another command. Lock: ${lock}`
        );
      // Never recursively remove the directory: another claimant may have won recovery.
      try {
        unlinkSync(file);
        rmdirSync(lock);
      } catch {
        throw new Error("LinkedIn command lock changed during recovery; retry once.");
      }
    }
  }
  const file = join(lock, `owner-${randomUUID()}.json`);
  try {
    writeFileSync(file, JSON.stringify({ pid: process.pid, operation }), {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    rmdirSync(lock);
    throw error;
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    process.removeListener("exit", release);
    try {
      unlinkSync(file);
      rmdirSync(lock);
    } catch {
      /* never remove someone else's lock */
    }
  };
  process.once("exit", release);
  return release;
}

/** Unknown commands default to guarded; local commands must be explicitly classified. */
export function usesLinkedIn(
  command: string,
  options: Record<string, unknown>,
  parent?: string
): boolean {
  if (parent === "browser") return true;
  if (parent === "store") return false;
  if (command === "status") return options.check === true;
  if (command === "messages") return options.sync !== false;
  if (command === "companies") return options.local !== true;
  if (command === "connections") {
    if (options.browserosMcp) return true;
    if ((Array.isArray(options.geo) && options.geo.length > 0) || options.geoGranularity)
      return false;
  }
  return ![
    "session",
    "logout",
    "conversations",
    "search",
    "grep",
    "store",
    "mail",
    "relationships",
    "attio",
    "group",
    "rank",
    "icp",
    "contact",
    "graph",
    "intro-to",
    "install-browsers",
  ].includes(command);
}

export async function assertActiveProfile(
  options: Record<string, unknown>,
  root = sessionControlRoot()
): Promise<ManagedProfile | null> {
  const registry = readSessionRegistry(root);
  if (!registry) return null;
  const active = registry.profiles.find((p) => p.name === registry.active);
  if (!active)
    throw new Error("LinkedIn access is paused. Run `allman session activate <name>` first.");
  const storePath = canonicalPath(resolveStorePath(options.store as string | undefined));
  const inactive = () =>
    new Error(
      `Active LinkedIn profile is "${active.name}". Use its launcher, or run \`allman session activate <name>\` to switch. No LinkedIn request was made.`
    );
  if (storePath !== canonicalPath(active.store)) throw inactive();
  const store = new Store({ path: storePath });
  const account = (options.account as string | undefined) || process.env.ALLMAN_ACCOUNT;
  const wanted = account
    ? ((await store.accounts.resolveId(account)) ?? account)
    : await store.accounts.getDefault();
  const selected = (await store.accounts.resolveId(active.account)) ?? active.account;
  if (wanted !== selected) throw inactive();
  const workspace = browserWorkspace();
  const browser = mergeBrowserConfig(readBrowserConfig(workspace), browserEnvDefaults(), {
    cdpEndpoint: options.cdp as string | undefined,
    profileDir: options.profile as string | undefined,
    channel: options.browser as string | undefined,
    executablePath: options.executable as string | undefined,
    shieldPath: options.shield as string | undefined,
  });
  if (
    canonicalPath(workspace) !== canonicalPath(active.workspace) ||
    browser.cdpEndpoint !== active.browser.cdpEndpoint ||
    browser.profileDir !== active.browser.profileDir ||
    browser.shieldPath !== active.browser.shieldPath
  )
    throw new Error(
      `Browser configuration differs from active profile "${active.name}". Use its registered launcher; overrides cannot select another browser.`
    );
  return active;
}

export async function beginLinkedInCommand(command: Command): Promise<(() => void) | null> {
  const options = command.optsWithGlobals();
  if (!usesLinkedIn(command.name(), options, command.parent?.name())) return null;
  const release = acquireLinkedInLock(command.name());
  try {
    const active = await assertActiveProfile(options);
    if (active) {
      if (options.browserosMcp)
        throw new Error(
          "Neo MCP routing is not bound to a registered profile. Use the protected CDP/CLI path while session control is enabled."
        );
      const { profilePause } = await import("./auth/profile-pause.js");
      const registry = readSessionRegistry();
      if (!registry || registry.active !== active.name)
        throw new Error("Session selection changed during preflight; no request was made.");
      for (const profile of registry.profiles)
        await profilePause(profile, profile.name !== active.name, true);
    }
    // status --check must not check every saved account concurrently.
    if (command.name() === "status") {
      const store = new Store({ path: resolveStorePath(options.store) });
      command.setOptionValue(
        "account",
        await store.accounts.getDefault(options.account || active?.account)
      );
    }
    return release;
  } catch (error) {
    release();
    throw error;
  }
}
