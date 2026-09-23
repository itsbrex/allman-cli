import { isAbsolute, join } from "node:path";
import { allmanConfigRoot, profileConfigRoot } from "../store/config.js";
import { readJson, withWorkspaceLock, writePrivate } from "../store/private-workspace.js";

export interface DashboardSettings {
  autoOpen?: boolean;
  url?: string;
  caFile?: string;
}

export function activitySettingsFile(): string {
  return join(profileConfigRoot() ?? allmanConfigRoot(), "settings.json");
}

export function parseDashboardBoolean(value: string): boolean {
  if (/^(true|1|yes|on)$/i.test(value.trim())) return true;
  if (/^(false|0|no|off)$/i.test(value.trim())) return false;
  throw new Error("Dashboard auto-open must be true/false, 1/0, yes/no, or on/off.");
}

export function validateDashboardUrl(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      !url.hostname.endsWith(".localhost")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Dashboard URL must be a loopback or .localhost HTTP(S) URL without credentials, query, or fragment."
    );
  return url.href;
}

async function readSettings(): Promise<
  Record<string, unknown> & { dashboard?: DashboardSettings }
> {
  const value = await readJson<Record<string, unknown>>(activitySettingsFile(), {});
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid profile settings: expected an object.");
  const dashboard = value.dashboard;
  if (dashboard !== undefined) {
    if (!dashboard || typeof dashboard !== "object" || Array.isArray(dashboard))
      throw new Error("Invalid dashboard settings: expected an object.");
    const settings = dashboard as DashboardSettings;
    if (settings.autoOpen !== undefined && typeof settings.autoOpen !== "boolean")
      throw new Error("Invalid dashboard.autoOpen: expected a boolean.");
    if (settings.url !== undefined) {
      if (typeof settings.url !== "string")
        throw new Error("Invalid dashboard.url: expected a string.");
      validateDashboardUrl(settings.url);
    }
    if (
      settings.caFile !== undefined &&
      (typeof settings.caFile !== "string" || !isAbsolute(settings.caFile))
    )
      throw new Error("Invalid dashboard.caFile: expected an absolute certificate path.");
  }
  return value;
}

export async function dashboardAutoOpen(flag?: boolean): Promise<boolean> {
  if (flag !== undefined) return flag;
  const env = process.env.ALLMAN_DASHBOARD_AUTO_OPEN;
  if (env?.trim()) return parseDashboardBoolean(env);
  return (await readSettings()).dashboard?.autoOpen ?? true;
}

export async function dashboardUrl(): Promise<string | undefined> {
  const url = process.env.ALLMAN_DASHBOARD_URL || (await readSettings()).dashboard?.url;
  return url ? validateDashboardUrl(url) : undefined;
}

export async function dashboardCaFile(): Promise<string | undefined> {
  return (await readSettings()).dashboard?.caFile;
}

export async function configureDashboard(
  options: DashboardSettings & { clearUrl?: boolean; clearCaFile?: boolean }
): Promise<void> {
  const file = activitySettingsFile();
  if (options.url && options.clearUrl) throw new Error("Use --url or --clear-url, not both.");
  if (options.caFile && options.clearCaFile)
    throw new Error("Use --ca-file or --clear-ca-file, not both.");
  if (options.caFile !== undefined && !isAbsolute(options.caFile))
    throw new Error("Dashboard CA file must be an absolute path.");
  const root = profileConfigRoot() ?? allmanConfigRoot();
  await withWorkspaceLock(root, async () => {
    const settings = await readSettings();
    const dashboard = { ...settings.dashboard };
    if (options.autoOpen !== undefined) dashboard.autoOpen = options.autoOpen;
    if (options.url !== undefined) dashboard.url = validateDashboardUrl(options.url);
    if (options.clearUrl) delete dashboard.url;
    if (options.caFile !== undefined) dashboard.caFile = options.caFile;
    if (options.clearCaFile) delete dashboard.caFile;
    await writePrivate(file, { ...settings, dashboard });
  });
}
