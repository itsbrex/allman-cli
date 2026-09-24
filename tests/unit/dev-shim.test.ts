import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

test("source shim resolves the checkout runtime while preserving caller cwd and arguments", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "allman-shim-")));
  try {
    const root = join(directory, "checkout");
    const fakeBin = join(directory, "fake-bin");
    mkdirSync(join(root, "bin"), { recursive: true });
    mkdirSync(fakeBin);
    const shim = join(root, "bin/allman");
    copyFileSync(resolve("bin/allman"), shim);
    const runtime = join(fakeBin, "pinned-bun");
    writeFileSync(runtime, '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@"\n');
    writeFileSync(
      join(fakeBin, "mise"),
      '#!/bin/sh\n[ "$1" = "--cd" ] && [ "$2" = "$EXPECTED_ROOT" ] && [ "$3" = "which" ] && [ "$4" = "bun" ] || exit 41\nprintf "%s\\n" "$PINNED_RUNTIME"\n'
    );
    chmodSync(runtime, 0o755);
    chmodSync(join(fakeBin, "mise"), 0o755);
    const env = {
      ...process.env,
      PATH: `${fakeBin}:/usr/bin:/bin`,
      EXPECTED_ROOT: root,
      PINNED_RUNTIME: runtime,
    };
    const result = spawnSync("/bin/bash", [shim, "--store", "a path with spaces"], {
      cwd: directory,
      env,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      directory,
      join(root, "src/index.ts"),
      "--store",
      "a path with spaces",
    ]);
    writeFileSync(join(fakeBin, "mise"), "#!/bin/sh\nexit 42\n");
    expect(spawnSync("/bin/bash", [shim], { cwd: directory, env }).status).toBe(42);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
