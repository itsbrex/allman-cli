import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { rewritePlaywrightPackageLookups } from "../../scripts/build-rewrites.ts";

const root = resolve(import.meta.dirname, "../..");

describe("rewritePlaywrightPackageLookups", () => {
  test("failed rewrite guard preserves previous artifact and removes pending output", () => {
    const temp = mkdtempSync(join(tmpdir(), "allman-failed-build-"));
    const entrypoint = join(temp, "entry.ts"),
      outfile = join(temp, "allman");
    writeFileSync(entrypoint, 'console.log("no Playwright module")');
    writeFileSync(outfile, "previous good build");
    try {
      const build = spawnSync("bun", ["scripts/build.ts"], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          ALLMAN_BUILD_ENTRYPOINT: entrypoint,
          ALLMAN_BUILD_OUTFILE: outfile,
          ALLMAN_BUILD_TARGET: "",
        },
      });
      expect(build.status).not.toBe(0);
      expect(build.stderr).toContain("package lookup was not rewritten");
      expect(existsSync(outfile)).toBe(true);
      expect(readFileSync(outfile, "utf8")).toBe("previous good build");
      expect(readdirSync(temp).sort()).toEqual(["allman", "entry.ts"]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  test("removes build-machine package metadata resolution", () => {
    const source = `const coreDir = path.dirname(require.resolve("../../../package.json"));`;

    expect(rewritePlaywrightPackageLookups(source)).toEqual({
      contents: `const coreDir = path.dirname(process.execPath);`,
      replacements: 1,
    });
  });

  test("leaves ordinary package imports unchanged", () => {
    const source = `const packageJson = require("../../../package.json");`;

    expect(rewritePlaywrightPackageLookups(source)).toEqual({
      contents: source,
      replacements: 0,
    });
  });

  test.runIf(process.platform === "darwin" || process.platform === "linux")(
    "compiled executable runs after its Playwright source tree is removed",
    () => {
      const temp = mkdtempSync(join(tmpdir(), "allman-portable-build-"));
      const sourceDir = join(temp, "source");
      const moduleDir = join(sourceDir, "node_modules/playwright-core/lib/server/utils");
      const entrypoint = join(sourceDir, "entry.ts");
      const outfile = join(temp, "portable-smoke");
      mkdirSync(moduleDir, { recursive: true });
      writeFileSync(
        join(sourceDir, "node_modules/playwright-core/package.json"),
        JSON.stringify({ name: "playwright-core", version: "test" })
      );
      writeFileSync(
        join(moduleDir, "nodePlatform.js"),
        `const path = require("node:path");\nexports.coreDir = path.dirname(require.resolve("../../../package.json"));\n`
      );
      const serverDir = join(moduleDir, "..");
      mkdirSync(join(serverDir, "registry"), { recursive: true });
      mkdirSync(join(serverDir, "chromium"), { recursive: true });
      writeFileSync(join(serverDir, "chromium/appIcon.png"), "fixture-icon");
      writeFileSync(
        join(serverDir, "launchApp.js"),
        'const fs = require("node:fs"); exports.icon = async () => await fs.promises.readFile(require.resolve("./chromium/appIcon.png"));'
      );
      writeFileSync(
        join(serverDir, "registry/index.js"),
        'const path = require("node:path"); exports.browsers = process.env.PLAYWRIGHT_BROWSERS_PATH === "0" ? path.join(__dirname, "..", "..", "..", ".local-browsers") : "shared";'
      );
      writeFileSync(
        entrypoint,
        `import { coreDir } from "./node_modules/playwright-core/lib/server/utils/nodePlatform.js";\nconsole.log(coreDir);\nimport { browsers } from "./node_modules/playwright-core/lib/server/registry/index.js";\nimport { icon } from "./node_modules/playwright-core/lib/server/launchApp.js";\nconsole.log(browsers);\nconsole.log((await icon()).toString());\n`
      );

      try {
        const build = spawnSync("bun", ["scripts/build.ts"], {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            ALLMAN_BUILD_ENTRYPOINT: entrypoint,
            ALLMAN_BUILD_OUTFILE: outfile,
            ALLMAN_BUILD_TARGET: "",
            ENTRYPOINT: "/invalid",
            OUTFILE: "/invalid",
            BUN_TARGET: "invalid",
          },
        });
        expect(build.status, build.stderr).toBe(0);

        rmSync(sourceDir, { recursive: true, force: true });
        const run = spawnSync(outfile, {
          encoding: "utf8",
          env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "0" },
        });

        expect(run.status, run.stderr).toBe(0);
        const [core, browsers, icon] = run.stdout.trim().split("\n");
        expect(realpathSync(core ?? "")).toBe(realpathSync(dirname(outfile)));
        expect(browsers).toBe(
          join(realpathSync(dirname(outfile)), "playwright-core/.local-browsers")
        );
        expect(icon).toBe("fixture-icon");
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    }
  );
});
