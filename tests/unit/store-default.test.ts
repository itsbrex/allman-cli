import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveStoreDefault, storeDefaultFile } from "@/store/config.js";
import { resolveStorePath } from "@/store/index.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-default-store-"));
  vi.stubEnv("XDG_CONFIG_HOME", root);
  vi.stubEnv("ALLMAN_STORE", "");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
describe("persistent default store", () => {
  it("uses the selected absolute store regardless of current working directory", async () => {
    const path = join(root, "selected");
    await saveStoreDefault(path);
    vi.spyOn(process, "cwd").mockReturnValue("/another-directory");
    try {
      expect(resolveStorePath()).toBe(path);
    } finally {
      vi.restoreAllMocks();
    }
    expect((await stat(storeDefaultFile())).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(storeDefaultFile(), "utf8"))).toEqual({ storePath: path });
  });
  it("preserves explicit flag and environment precedence", async () => {
    await saveStoreDefault(join(root, "selected"));
    vi.stubEnv("ALLMAN_STORE", join(root, "env"));
    expect(resolveStorePath()).toBe(join(root, "env"));
    expect(resolveStorePath(join(root, "flag"))).toBe(join(root, "flag"));
  });
  it("keeps the upstream local default until a store is selected", () => {
    expect(resolveStorePath()).toBe(resolve(".allman"));
  });
  it("rejects damaged saved configuration instead of silently switching stores", async () => {
    await saveStoreDefault(join(root, "selected"));
    await writeFile(storeDefaultFile(), '{"storePath":"relative"}');
    expect(() => resolveStorePath()).toThrow("Invalid default store");
    expect(resolveStorePath(join(root, "explicit"))).toBe(join(root, "explicit"));
  });
});
