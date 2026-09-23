import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  activitySettingsFile,
  configureDashboard,
  dashboardAutoOpen,
  dashboardUrl,
  parseDashboardBoolean,
  validateDashboardUrl,
} from "@/activity/config.js";
import { saveStoreDefault, storeDefaultFile } from "@/store/config.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-dashboard-config-"));
  vi.stubEnv("XDG_CONFIG_HOME", root);
  vi.stubEnv("ALLMAN_PROFILE", "");
  vi.stubEnv("ALLMAN_DASHBOARD_AUTO_OPEN", "");
  vi.stubEnv("ALLMAN_DASHBOARD_URL", "");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("isolates profile preferences and preserves them when the default store changes", async () => {
  expect(await dashboardAutoOpen()).toBe(true);
  vi.stubEnv("ALLMAN_PROFILE", "jp");
  await saveStoreDefault(join(root, "first"));
  await writeFile(
    activitySettingsFile(),
    JSON.stringify({ theme: "dark", dashboard: { future: 1 } })
  );
  await configureDashboard({ autoOpen: false, url: "http://127.0.0.1:8767/" });
  await saveStoreDefault(join(root, "second"));
  expect(await dashboardAutoOpen()).toBe(false);
  expect(JSON.parse(await readFile(activitySettingsFile(), "utf8"))).toMatchObject({
    theme: "dark",
    dashboard: { future: 1, autoOpen: false },
  });
  expect(JSON.parse(await readFile(storeDefaultFile(), "utf8"))).toEqual({
    storePath: join(root, "second"),
  });
  expect((await stat(activitySettingsFile())).mode & 0o777).toBe(0o600);
  vi.stubEnv("ALLMAN_PROFILE", "brian");
  expect(await dashboardAutoOpen()).toBe(true);
  expect(await dashboardUrl()).toBeUndefined();
});

it("accepts boolean spellings and rejects typos instead of opening unexpectedly", async () => {
  for (const value of ["true", "1", "YES", " on "]) expect(parseDashboardBoolean(value)).toBe(true);
  for (const value of ["false", "0", "NO", " off "])
    expect(parseDashboardBoolean(value)).toBe(false);
  vi.stubEnv("ALLMAN_DASHBOARD_AUTO_OPEN", "disabled");
  await expect(dashboardAutoOpen()).rejects.toThrow("auto-open must be");
  expect(await dashboardAutoOpen(false)).toBe(false);
});

it("rejects malformed settings without overwriting them", async () => {
  await mkdir(dirname(activitySettingsFile()), { recursive: true });
  const malformed = '{"dashboard":{"autoOpen":"false"}}';
  await writeFile(activitySettingsFile(), malformed);
  await expect(configureDashboard({ autoOpen: true })).rejects.toThrow("expected a boolean");
  expect(await readFile(activitySettingsFile(), "utf8")).toBe(malformed);
});

it("limits preferred URLs to local viewers and supports clearing the saved URL", async () => {
  for (const url of [
    "https://example.com/",
    "file:///tmp/page",
    "https://user:pass@allman.localhost/",
    "http://localhost/?token=secret",
    "http://localhost/#fragment",
  ])
    expect(() => validateDashboardUrl(url)).toThrow();
  await configureDashboard({ url: "https://allman-activity.localhost/apps/activity.html" });
  vi.stubEnv("ALLMAN_DASHBOARD_URL", "http://127.0.0.1:9000/");
  expect(await dashboardUrl()).toBe("http://127.0.0.1:9000/");
  vi.stubEnv("ALLMAN_DASHBOARD_URL", "");
  await configureDashboard({ clearUrl: true });
  expect(await dashboardUrl()).toBeUndefined();
});
