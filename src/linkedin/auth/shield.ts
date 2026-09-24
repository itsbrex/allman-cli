import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { BrowserContext } from "playwright";

interface ShieldManifest {
  name: string;
  version: string;
  manifest_version: number;
  background: { service_worker: string };
  content_scripts: Array<{ js: string[]; world?: string; run_at?: string }>;
  icons: Record<string, string>;
  action: { default_popup: string };
  declarative_net_request: {
    rule_resources: Array<{ id: string; path: string; enabled: boolean }>;
  };
}

export interface ShieldPackage {
  path: string;
  extensionId: string;
  version: string;
  worker: string;
  popup: string;
  hashes: Record<string, string>;
  rulesets: string[];
}

export interface ShieldVerification {
  id: string;
  version: string;
  rulesets: string[];
}

/** Read runtime assets only; repository files and browser-generated metadata are excluded. */
export async function readShieldPackage(path?: string): Promise<ShieldPackage> {
  if (!path) {
    throw new Error(
      "LinkedIn Shield is required. Run `allman browser configure --shield /path/to/linkedin-shield/dist` first."
    );
  }
  const root = await realpath(resolve(path));
  if (root.includes(","))
    throw new Error(
      "The Shield directory cannot contain a comma (Chromium extension-list separator)."
    );
  const manifest = JSON.parse(
    await readFile(join(root, "manifest.json"), "utf8")
  ) as ShieldManifest;
  if (
    !["LinkedIn Shield", "[DEV] LinkedIn Shield"].includes(manifest.name) ||
    manifest.manifest_version !== 3 ||
    !manifest.version ||
    !manifest.background?.service_worker ||
    !manifest.action?.default_popup ||
    !manifest.content_scripts?.some((s) => s.world === "MAIN" && s.run_at === "document_start") ||
    !manifest.declarative_net_request?.rule_resources?.some(
      (r) => r.id === "linkedin_blocklist" && r.enabled
    )
  ) {
    throw new Error(
      "Expected the LinkedIn Shield MV3 build with document-start protection and linkedin_blocklist enabled."
    );
  }
  const rules = manifest.declarative_net_request.rule_resources;
  const files = new Set([
    "manifest.json",
    manifest.background.service_worker,
    manifest.action.default_popup,
    "popup.js",
    "known-extensions.js",
    "LICENSE",
    ...(manifest.name === "[DEV] LinkedIn Shield" ? ["dev/hot-reload.js"] : []),
    ...manifest.content_scripts.flatMap((s) => s.js),
    ...Object.values(manifest.icons),
    ...rules.map((r) => r.path),
  ]);
  const hashes: Record<string, string> = {};
  for (const file of files) {
    if (
      typeof file !== "string" ||
      isAbsolute(file) ||
      file.includes("\\") ||
      file.split("/").includes("..")
    ) {
      throw new Error("Shield contains an unsafe runtime asset path.");
    }
    const asset = join(root, file);
    if (relative(root, await realpath(asset)).startsWith("..") || !(await lstat(asset)).isFile()) {
      throw new Error(`Shield asset must be a regular file inside the build: ${file}`);
    }
    hashes[file] = createHash("sha256")
      .update(await readFile(asset))
      .digest("hex");
  }
  return {
    path: root,
    extensionId: createHash("sha256")
      .update(
        (manifest as ShieldManifest & { key?: string }).key
          ? Buffer.from((manifest as ShieldManifest & { key: string }).key, "base64")
          : process.platform === "win32"
            ? root.replace(/^[a-z]:/, (drive) => drive.toUpperCase())
            : root
      )
      .digest("hex")
      .slice(0, 32)
      .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))),
    version: manifest.version,
    worker: manifest.background.service_worker,
    popup: manifest.action.default_popup,
    hashes,
    rulesets: rules.filter((r) => r.enabled).map((r) => r.id),
  };
}

/** Verify in an extension-owned page. Worker fetches can stall under CDP. */
export async function verifyShield(
  context: BrowserContext,
  shield: ShieldPackage
): Promise<ShieldVerification> {
  const candidates = new Set([
    shield.extensionId,
    ...context
      .serviceWorkers()
      .filter(
        (worker) =>
          worker.url().startsWith("chrome-extension://") &&
          worker.url().endsWith(`/${shield.worker}`)
      )
      .map((worker) => new URL(worker.url()).hostname),
  ]);
  const page = await context.newPage();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      verifyShieldPage(page, shield, candidates),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "LinkedIn Shield verification timed out; no LinkedIn navigation was started."
              )
            ),
          10_000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await page.close().catch(() => {});
  }
}

/** The small page surface shared by Playwright and the Neo MCP adapter. */
export interface ShieldPage {
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
  evaluate<T, A>(fn: (arg: A) => Promise<T>, arg: A): Promise<T>;
}

export async function verifyShieldPage(
  page: ShieldPage,
  shield: ShieldPackage,
  candidates: Set<string>
): Promise<ShieldVerification> {
  for (const id of candidates) {
    try {
      await page.goto(`chrome-extension://${id}/${shield.popup}`, {
        waitUntil: "domcontentloaded",
        timeout: 5_000,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /closed|timeout|timed out|interrupted|ERR_ABORTED/i.test(error.message)
      ) {
        throw new Error(
          "LinkedIn Shield verification was interrupted: its tab closed or navigation did not finish. Check tab-management extensions and retry. This does not establish that Shield is missing. No LinkedIn navigation was started.",
          { cause: error }
        );
      }
      continue;
    }
    const state = await page.evaluate(
      async ({ files }) => {
        // Playwright serializes this function into the extension's own origin.
        const chrome = (
          globalThis as unknown as {
            chrome: {
              runtime: {
                id: string;
                getManifest(): { name: string; version: string };
                getURL(path: string): string;
                sendMessage(message: { type: string; tabId: number }): Promise<unknown>;
              };
              declarativeNetRequest: { getEnabledRulesets(): Promise<string[]> };
              permissions: { contains(value: { origins: string[] }): Promise<boolean> };
            };
          }
        ).chrome;
        const manifest = chrome.runtime.getManifest();
        if (!["LinkedIn Shield", "[DEV] LinkedIn Shield"].includes(manifest.name)) return null;
        const hashes: Record<string, string> = {};
        for (const file of files) {
          const response = await fetch(chrome.runtime.getURL(file));
          if (!response.ok) throw new Error(`Cannot read Shield runtime asset: ${file}`);
          const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
          hashes[file] = Array.from(new Uint8Array(digest), (b) =>
            b.toString(16).padStart(2, "0")
          ).join("");
        }
        const background = await chrome.runtime.sendMessage({ type: "get_stats", tabId: -1 });
        return {
          id: chrome.runtime.id,
          version: manifest.version,
          hashes,
          backgroundReady: Boolean(background && typeof background === "object"),
          rulesets: await chrome.declarativeNetRequest.getEnabledRulesets(),
          hostAccess: await chrome.permissions.contains({ origins: ["*://*.linkedin.com/*"] }),
        };
      },
      { files: Object.keys(shield.hashes) }
    );
    if (!state) continue;
    if (
      state.id !== id ||
      state.version !== shield.version ||
      !state.hostAccess ||
      !state.backgroundReady ||
      shield.rulesets.some((rule) => !state.rulesets.includes(rule)) ||
      Object.entries(shield.hashes).some(([file, hash]) => state.hashes[file] !== hash)
    ) {
      throw new Error(
        "LinkedIn Shield verification failed: build mismatch, missing site access, disabled blocking rules, or unavailable background worker. Reload the configured build and enable its protections."
      );
    }
    return { id: state.id, version: state.version, rulesets: state.rulesets };
  }
  throw new Error(
    "LinkedIn Shield is not active in this browser. Install the configured unpacked build in this persistent profile and retry. No LinkedIn navigation was started."
  );
}
