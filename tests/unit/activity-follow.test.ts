import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { activeActivityContext } from "@/activity/active-profile.js";
import { ActivityRun } from "@/activity/journal.js";
import { type ActivityServer, startActivityServer } from "@/activity/server.js";
import { type SessionRegistry, saveSessionRegistry } from "@/linkedin/session-control.js";

let root: string, server: ActivityServer | undefined, registry: SessionRegistry;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-follow-"));
  vi.stubEnv("XDG_CONFIG_HOME", join(root, "config"));
  vi.stubEnv("ALLMAN_PROFILE", "wrong-inherited-profile");
  vi.stubEnv("ALLMAN_RELATIONSHIP_STORE", join(root, "wrong-workspace"));
  registry = { version: 1, active: "one", profiles: [] };
  for (const [index, name] of ["one", "two"].entries()) {
    const store = join(root, name),
      account = `ACo${name}`;
    await mkdir(join(store, account), { recursive: true });
    await writeFile(join(store, account, "AUTH.json"), JSON.stringify({ name, profileSlug: name }));
    const config = join(root, "config/allman", name);
    await mkdir(config, { recursive: true });
    await writeFile(join(config, "default-store.json"), JSON.stringify({ storePath: store }));
    registry.profiles.push({
      name,
      store,
      account,
      workspace: join(root, `browser-${name}`),
      browser: {
        cdpEndpoint: `http://127.0.0.1:${9230 + index}`,
        shieldPath: join(root, "shield"),
      },
    });
  }
  saveSessionRegistry(registry);
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("resolves named workspaces without inheriting another profile and clears paused/invalid selections", async () => {
  const one = await activeActivityContext();
  if (!one) throw new Error("Expected active fixture profile");
  expect(one?.root).toContain("/config/allman/one/relationships/activity/");
  server = await startActivityServer({
    root: "",
    label: "unused",
    port: 0,
    resolveContext: activeActivityContext,
  });
  const get = (path: string) => fetch(new URL(path, server?.url)).then((r) => r.json());
  expect(await get("/api/identity")).toMatchObject({
    profile: "one",
    followsActiveProfile: true,
    key: createHash("sha256").update(one.root).digest("hex"),
  });
  registry.active = "two";
  saveSessionRegistry(registry);
  expect(await get("/api/snapshot")).toMatchObject({ profile: "two", label: "two" });
  registry.active = null;
  saveSessionRegistry(registry);
  expect(await get("/api/identity")).toMatchObject({ key: null, profile: null });
  expect(await get("/api/snapshot")).toMatchObject({ run: null, runs: [], metrics: null });
  await writeFile(join(root, "config/allman/session-control.json"), "broken");
  expect(await get("/api/snapshot")).toMatchObject({ run: null, runs: [], metrics: null });
});

it("switches an existing event stream and drops the old selected run", async () => {
  const one = await activeActivityContext();
  if (!one) throw new Error("Expected active fixture profile");
  const run = new ActivityRun(one.root, {
    command: "fixture",
    account: one.account,
    label: "Only one",
  });
  run.finish("finished");
  server = await startActivityServer({
    root: "",
    label: "unused",
    port: 0,
    resolveContext: activeActivityContext,
  });
  const snapshot = (await fetch(new URL("/api/snapshot", server.url)).then((r) => r.json())) as {
    run: { id: string } | null;
    viewKey: string;
  };
  if (!snapshot.run) throw new Error("Expected fixture run");
  const response = await fetch(
    new URL(`/api/events?run=${snapshot.run.id}&view=${snapshot.viewKey}`, server.url)
  );
  if (!response.body) throw new Error("Expected event stream");
  const reader = response.body.getReader();
  try {
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"label":"one"');
    registry.active = "two";
    saveSessionRegistry(registry);
    const next = new TextDecoder().decode((await reader.read()).value);
    expect(next).toContain('"label":"two"');
    expect(next).toContain('"run":null');
    expect(next).not.toContain("Only one");
  } finally {
    await reader.cancel();
  }
}, 10000);
