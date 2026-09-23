import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("keeps start dashboard flags explicit and saves preferences through the CLI without LinkedIn", async () => {
  const root = await mkdtemp(join(tmpdir(), "allman-dashboard-cli-"));
  const preload = join(root, "preload.ts");
  try {
    await writeFile(
      preload,
      `import { mock } from "bun:test";
mock.module(${JSON.stringify(resolve("src/commands/start.ts"))}, () => ({ startCommand: async () => {} }));
mock.module(${JSON.stringify(resolve("src/commands/activity.ts"))}, () => ({ beginCommandActivity: async (_command, options) => { console.log(JSON.stringify({dashboard: options.dashboard ?? null})); } }));
`
    );
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: root,
      ALLMAN_PROFILE: "",
      ALLMAN_STORE: join(root, "store"),
      ALLMAN_ACCOUNT: "fixture",
      ALLMAN_DASHBOARD_AUTO_OPEN: "false",
      ALLMAN_DASHBOARD_URL: "",
    };
    const cli = (args: string[], mock = true) =>
      execFileSync(
        "bun",
        [...(mock ? ["--preload", preload] : []), resolve("src/index.ts"), ...args],
        { env, encoding: "utf8", timeout: 15000 }
      );
    expect(JSON.parse(cli(["start"]))).toEqual({ dashboard: null });
    expect(JSON.parse(cli(["start", "--no-dashboard"]))).toEqual({ dashboard: false });
    expect(JSON.parse(cli(["start", "--dashboard"]))).toEqual({ dashboard: true });
    expect(JSON.parse(cli(["--dashboard", "start", "--no-dashboard"]))).toEqual({
      dashboard: false,
    });
    await mkdir(join(root, "allman"), { recursive: true });
    await writeFile(
      join(root, "allman/session-control.json"),
      JSON.stringify({ version: 1, active: null, profiles: [] })
    );
    cli(
      ["activity", "configure", "--auto-open", "false", "--url", "http://127.0.0.1:8767/"],
      false
    );
    expect(JSON.parse(await readFile(join(root, "allman/settings.json"), "utf8"))).toEqual({
      dashboard: { autoOpen: false, url: "http://127.0.0.1:8767/" },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
