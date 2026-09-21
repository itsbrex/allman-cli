import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readShieldPackage, verifyShield } from "@/linkedin/auth/shield.js";

let root: string;
const manifest = {
  name: "LinkedIn Shield",
  version: "3.4.0",
  manifest_version: 3,
  background: { service_worker: "background.js" },
  content_scripts: [{ js: ["content.js"], world: "MAIN", run_at: "document_start" }],
  icons: {},
  action: { default_popup: "popup.html" },
  declarative_net_request: {
    rule_resources: [{ id: "linkedin_blocklist", path: "rules.json", enabled: true }],
  },
};
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-shield-unit-"));
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
  for (const file of [
    "background.js",
    "content.js",
    "popup.html",
    "popup.js",
    "known-extensions.js",
    "rules.json",
    "LICENSE",
  ])
    await writeFile(join(root, file), file);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

function runtime({
  enabled = true,
  access = true,
  changed = false,
  changedFile = "content.js",
  name = manifest.name,
} = {}) {
  let extensionId = "";
  vi.stubGlobal("chrome", {
    runtime: {
      get id() {
        return extensionId;
      },
      sendMessage: async () => ({ total: 0 }),
      getManifest: () => ({ ...manifest, name }),
      getURL: (file: string) => `https://extension.test/${file}`,
    },
    declarativeNetRequest: {
      getEnabledRulesets: async () => (enabled ? ["linkedin_blocklist"] : []),
    },
    permissions: { contains: async () => access },
  });
  vi.stubGlobal("fetch", async (url: string) => {
    const file = new URL(url).pathname.slice(1);
    return new Response(
      changed && file === changedFile ? "changed" : await readFile(join(root, file))
    );
  });
  const page = {
    goto: async (url: string) => {
      extensionId = new URL(url).hostname;
    },
    close: vi.fn().mockResolvedValue(undefined),
    evaluate: (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
  };
  return {
    serviceWorkers: () => [],
    newPage: async () => page,
  } as unknown as BrowserContext;
}

describe("required Shield package", () => {
  it("hashes only the runtime assets and ignores unrelated files", async () => {
    await writeFile(join(root, "private.txt"), "never package this");
    const result = await readShieldPackage(root);
    expect(Object.keys(result.hashes)).toHaveLength(8);
    expect(result.hashes).not.toHaveProperty("private.txt");
    expect(result.rulesets).toEqual(["linkedin_blocklist"]);
  });
  it("refuses missing, unrelated, or incomplete extensions", async () => {
    await expect(readShieldPackage()).rejects.toThrow("Shield is required");
    await writeFile(join(root, "manifest.json"), JSON.stringify({ ...manifest, name: "Other" }));
    await expect(readShieldPackage(root)).rejects.toThrow("Expected the LinkedIn Shield");
    await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
    await rm(join(root, "content.js"));
    await expect(readShieldPackage(root)).rejects.toThrow();
  });
  it("rejects runtime assets traversing outside the build or symlinked files", async () => {
    await writeFile(
      join(root, "manifest.json"),
      JSON.stringify({ ...manifest, background: { service_worker: "../escape.js" } })
    );
    await expect(readShieldPackage(root)).rejects.toThrow("unsafe runtime asset path");
    await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
    await rm(join(root, "content.js"));
    await symlink(join(root, "background.js"), join(root, "content.js"));
    await expect(readShieldPackage(root)).rejects.toThrow("regular file");
  });
});

describe("live Shield gate", () => {
  it("verifies the development build and rejects changed reload code", async () => {
    const name = "[DEV] LinkedIn Shield";
    await writeFile(join(root, "manifest.json"), JSON.stringify({ ...manifest, name }));
    await mkdir(join(root, "dev"));
    await writeFile(join(root, "dev/hot-reload.js"), "// development reload runtime");
    const shield = await readShieldPackage(root);
    expect(shield.hashes).toHaveProperty("dev/hot-reload.js");
    await expect(verifyShield(runtime({ name }), shield)).resolves.toEqual({
      id: shield.extensionId,
      version: "3.4.0",
      rulesets: ["linkedin_blocklist"],
    });
    await expect(
      verifyShield(runtime({ name, changed: true, changedFile: "dev/hot-reload.js" }), shield)
    ).rejects.toThrow("verification failed");
    await rm(join(root, "dev/hot-reload.js"));
    await expect(readShieldPackage(root)).rejects.toThrow();
  });
  it("checks file contents, version, site access, and enabled rules inside the worker", async () => {
    const shield = await readShieldPackage(root);
    await expect(verifyShield(runtime(), shield)).resolves.toEqual({
      id: shield.extensionId,
      version: "3.4.0",
      rulesets: ["linkedin_blocklist"],
    });
  });
  it.each([
    { enabled: false },
    { access: false },
    { changed: true },
  ])("refuses an unhealthy or different build: %j", async (state) => {
    await expect(verifyShield(runtime(state), await readShieldPackage(root))).rejects.toThrow(
      "verification failed"
    );
  });
  it("rejects a context without the extension and closes the verification tab", async () => {
    const page = {
      goto: vi.fn().mockRejectedValue(new Error("extension absent")),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const context = {
      serviceWorkers: () => [],
      newPage: async () => page,
    } as unknown as BrowserContext;
    await expect(verifyShield(context, await readShieldPackage(root))).rejects.toThrow(
      "not active"
    );
    expect(page.close).toHaveBeenCalledOnce();
  });
});
