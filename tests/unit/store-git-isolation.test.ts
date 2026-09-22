import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { StoreGit, storeGitEnvironment } from "@/store/git.js";

vi.unmock("simple-git");
it("owns its repository and ignores parent hook index/worktree variables", async () => {
  const root = await mkdtemp(join(tmpdir(), "allman-git-isolation-")),
    child = join(root, "nested-store");
  const env = {
    ...storeGitEnvironment(),
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.test",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.test",
  };
  const git = (args: string[], cwd = root) =>
    execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
  try {
    git(["init", "-q"]);
    await writeFile(join(root, "parent.txt"), "parent");
    git(["add", "parent.txt"]);
    git(["commit", "-qm", "fixture"]);
    const before = git(["rev-parse", "HEAD"]);
    await mkdir(child);
    await writeFile(join(child, "record.json"), "{}");
    vi.stubEnv("GIT_DIR", join(root, ".git"));
    vi.stubEnv("GIT_WORK_TREE", root);
    vi.stubEnv("GIT_INDEX_FILE", join(root, ".git/index"));
    vi.stubEnv("GIT_AUTHOR_NAME", "Fixture");
    vi.stubEnv("GIT_AUTHOR_EMAIL", "fixture@example.test");
    vi.stubEnv("GIT_COMMITTER_NAME", "Fixture");
    vi.stubEnv("GIT_COMMITTER_EMAIL", "fixture@example.test");
    const store = new StoreGit(child);
    await store.flush();
    expect(git(["rev-parse", "HEAD"])).toBe(before);
    expect(git(["ls-files"])).toBe("parent.txt");
    expect(git(["show", "HEAD:record.json"], child)).toBe("{}");
    expect(git(["rev-parse", "--show-toplevel"], child)).toContain("nested-store");
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
