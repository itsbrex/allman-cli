#!/usr/bin/env bun
// Package four local targets by default. Explicit publication: typecheck → lint → test → build →
// checksum → tag → push → `gh release create` with assets.
//
// Usage:
//   bun run release 2026-04-20.1-alpha              # local dry-run by default
//   bun run release 2026-04-20.1-alpha --publish --repo owner/allman-cli
//   bun run release 2026-04-20.1-alpha --skip-tests   # not recommended
//   bun run release 2026-04-20.1-alpha --dry-run      # build but don't tag/publish
//
// Any tag containing `-alpha` or `-beta` is published as a GitHub prerelease.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { $ } from "bun";
import { compileAllman } from "./build.ts";
import { assertPublicationTarget, releaseOptions } from "./release-options.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIST = join(ROOT, "dist");

const BIN = "allman";

const TARGETS = [
  { os: "linux", arch: "x64", bunTarget: "bun-linux-x64" },
  { os: "linux", arch: "arm64", bunTarget: "bun-linux-arm64" },
  { os: "darwin", arch: "x64", bunTarget: "bun-darwin-x64" },
  { os: "darwin", arch: "arm64", bunTarget: "bun-darwin-arm64" },
] as const;

function die(msg: string): never {
  console.error(`release: ${msg}`);
  process.exit(1);
}

function log(msg: string) {
  console.log(`release: ${msg}`);
}

const { tag, repo, skipTests, dryRun } = releaseOptions(process.argv.slice(2));

const isPrerelease = tag.includes("-alpha") || tag.includes("-beta");

async function sh(cmd: string): Promise<string> {
  const out = await $`sh -c ${cmd}`.quiet();
  return out.stdout.toString().trim();
}

async function assertCleanTree() {
  // Ignore untracked files — only fail when tracked files have uncommitted
  // changes. Release machines often have untracked local tooling (.claude,
  // .obsidian, etc.) that shouldn't block a release.
  const status = await sh("git status --porcelain -uno");
  if (status) die(`tracked files have uncommitted changes:\n${status}`);
}

async function assertOnMainPushed() {
  const branch = await sh("git rev-parse --abbrev-ref HEAD");
  if (branch !== "main") die(`not on main (on ${branch})`);
  await sh("git fetch origin main --quiet");
  const local = await sh("git rev-parse HEAD");
  const remote = await sh("git rev-parse origin/main");
  if (local !== remote) die("local main is not in sync with origin/main");
}

async function assertTagAvailable() {
  const existing = await sh(`git tag -l ${tag}`);
  if (existing) die(`tag ${tag} already exists locally`);
  const remote = await sh(`git ls-remote --tags origin refs/tags/${tag} | head -1`);
  if (remote) die(`tag ${tag} already exists on origin`);
}

async function build(os: string, arch: string, bunTarget: string) {
  const outfile = join(DIST, `${BIN}-${os}-${arch}`);
  log(`building ${outfile}`);
  await compileAllman({ outfile, target: bunTarget });
  return outfile;
}

function sha256(path: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

async function main() {
  log(`cutting ${tag} (${isPrerelease ? "prerelease" : "stable"})`);
  await assertCleanTree();
  if (!dryRun) {
    assertPublicationTarget(
      repo as string,
      await sh("git remote get-url origin"),
      await sh("git remote get-url --push origin")
    );
    await assertOnMainPushed();
    await assertTagAvailable();
  }
  log("typecheck");
  await $`bun run typecheck`;

  log("lint");
  await $`bun run lint`;

  if (!skipTests) {
    log("test");
    // Use the project's vitest suite (`bun run test`), not bun's native runner
    // (`bun test`), which doesn't honor vitest's vi.mock/vi.hoisted isolation
    // and reports false failures.
    await $`bun run test`;
  } else {
    log("skipping tests (--skip-tests)");
  }

  mkdirSync(DIST, { recursive: true });
  const assets: string[] = [];
  const manifestAssets: { file: string; sha256: string; target: string }[] = [];
  for (const { os, arch, bunTarget } of TARGETS) {
    const bin = await build(os, arch, bunTarget);
    const sumPath = `${bin}.sha256`;
    const sum = sha256(bin);
    writeFileSync(sumPath, `${sum}  ${BIN}-${os}-${arch}\n`);
    log(`sha256 ${os}-${arch}: ${sum}`);
    assets.push(bin, sumPath);
    manifestAssets.push({ file: `${BIN}-${os}-${arch}`, sha256: sum, target: bunTarget });
  }

  const manifest = join(DIST, "release-manifest.json");
  writeFileSync(
    manifest,
    `${JSON.stringify({ schemaVersion: 1, tag, version: JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version, sourceCommit: await sh("git rev-parse HEAD"), dryRun, executedOn: `${process.platform}-${process.arch}`, assets: manifestAssets }, null, 2)}\n`
  );
  assets.push(manifest);
  if (dryRun) {
    log(`dry-run: built ${assets.length} assets, stopping before tag/publish`);
    return;
  }

  log(`tagging ${tag}`);
  await $`git tag ${tag}`;
  await $`git push origin ${tag}`;

  log(`publishing release on ${repo}`);
  const prereleaseFlag = isPrerelease ? ["--prerelease"] : [];
  await $`gh release create ${tag} --repo ${repo} --title ${tag} --generate-notes ${prereleaseFlag} ${assets}`;

  const url = await sh(`gh release view ${tag} --repo ${repo} --json url --jq .url`);
  log(`done: ${url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
