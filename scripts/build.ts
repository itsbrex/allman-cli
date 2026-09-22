#!/usr/bin/env bun
// Build a standalone allman executable without retaining Playwright's
// build-machine package.json lookups. Bun leaves require.resolve() calls in
// bundled dependencies as runtime filesystem reads, which makes an otherwise
// standalone binary depend on the original node_modules directory.

import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rewritePlaywrightPackageLookups } from "./build-rewrites.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRYPOINT = join(ROOT, "src", "index.ts");
const DEFAULT_OUTFILE = join(ROOT, "dist", "allman");
const PLAYWRIGHT_MODULE_FILTER =
  /node_modules[\\/]playwright-core[\\/]lib[\\/]server[\\/](utils[\\/]nodePlatform|registry[\\/]index|launchApp)\.js$/;
const REQUIRED_REWRITE_SUFFIX = [
  "playwright-core",
  "lib",
  "server",
  "utils",
  "nodePlatform.js",
].join("/");

interface CompileOptions {
  entrypoint: string;
  outfile: string;
  target?: string;
}

export async function compilePortableExecutable(options: CompileOptions): Promise<void> {
  const rewrittenModules = new Set<string>();
  await mkdir(dirname(options.outfile), { recursive: true });
  const pending = `${options.outfile}.${crypto.randomUUID()}.pending`;
  try {
    const result = await Bun.build({
      entrypoints: [options.entrypoint],
      compile: {
        outfile: pending,
        ...(options.target ? { target: options.target } : {}),
      },
      minify: true,
      external: ["chromium-bidi", "electron"],
      plugins: [
        {
          name: "portable-playwright-package-lookups",
          setup(build) {
            build.onLoad({ filter: PLAYWRIGHT_MODULE_FILTER }, async ({ path }) => {
              let source = await readFile(path, "utf8");
              if (path.replaceAll("\\", "/").endsWith("/registry/index.js")) {
                // Preserve Playwright's normal shared cache. Hermetic mode becomes
                // executable-relative, never relative to the build machine.
                source = source.replaceAll(
                  "__dirname",
                  'require("node:path").join(require("node:path").dirname(process.execPath), "playwright-core", "lib", "server", "registry")'
                );
              }
              if (path.endsWith("launchApp.js")) {
                const lookup = 'require.resolve("./chromium/appIcon.png")';
                if (!source.includes(lookup)) throw new Error("Playwright app icon layout changed");
                const icon = await readFile(join(dirname(path), "chromium", "appIcon.png"));
                source = source.replace(
                  /await [\w.]+\.readFile\(require\.resolve\("\.\/chromium\/appIcon\.png"\)\)/,
                  `Buffer.from("${icon.toString("base64")}", "base64")`
                );
                if (source.includes(lookup))
                  throw new Error("Playwright app icon was not embedded");
              }
              const rewritten = rewritePlaywrightPackageLookups(source);
              if (rewritten.replacements > 0) rewrittenModules.add(path.replaceAll("\\", "/"));
              return { contents: rewritten.contents, loader: "js" };
            });
          },
        },
      ],
    });

    if (!result.success) {
      for (const log of result.logs) console.error(log);
      throw new Error(`failed to compile ${options.outfile}`);
    }

    if (![...rewrittenModules].some((path) => path.endsWith(REQUIRED_REWRITE_SUFFIX))) {
      throw new Error(
        "Playwright's package lookup was not rewritten; its module layout may have changed"
      );
    }
    await rename(pending, options.outfile);
  } finally {
    await rm(pending, { force: true });
  }
}

export async function compileAllman(options: { outfile: string; target?: string }): Promise<void> {
  await compilePortableExecutable({ entrypoint: ENTRYPOINT, ...options });
}

if (import.meta.main) {
  const target = process.env.ALLMAN_BUILD_TARGET;
  await compilePortableExecutable({
    entrypoint: process.env.ALLMAN_BUILD_ENTRYPOINT ?? ENTRYPOINT,
    outfile: process.env.ALLMAN_BUILD_OUTFILE ?? DEFAULT_OUTFILE,
    ...(target ? { target } : {}),
  });
}
