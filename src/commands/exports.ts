import {
  type ExportConfig,
  exportConfigPath,
  exportRoot,
  readExportConfig,
  refreshTeamExports,
} from "../exports/team.js";
import { readSessionRegistry } from "../linkedin/session-control.js";
import { writePrivate } from "../store/private-workspace.js";
import { printData } from "../utils/output.js";

export async function exportsCommand(
  action: string,
  options: { profiles?: string; owner?: string[]; enabled?: string }
) {
  if (action === "status") {
    printData({ root: exportRoot(), config: await readExportConfig() });
    return;
  }
  if (action === "refresh") {
    printData(await refreshTeamExports());
    return;
  }
  if (action !== "configure") throw new Error("Use exports configure, refresh, or status");
  const previous = await readExportConfig();
  const profiles = options.profiles?.split(",").map((p) => p.trim()) ?? previous?.profiles ?? [];
  const registered = readSessionRegistry()?.profiles ?? [];
  if (
    !profiles.length ||
    profiles.some((p) => !registered.some((r) => r.name === p)) ||
    new Set(profiles).size !== profiles.length ||
    profiles.includes("team")
  )
    throw new Error(
      "Select distinct registered profiles; 'team' is reserved for the combined export"
    );
  if (options.enabled !== undefined && !["true", "false"].includes(options.enabled))
    throw new Error("--enabled must be true or false");
  const ownerEmails: Record<string, string[]> = Object.fromEntries(
    Object.entries(previous?.ownerEmails ?? {}).filter(([p]) => profiles.includes(p))
  );
  for (const entry of options.owner ?? []) {
    const [profile, ...parts] = entry.split("=");
    if (!profile || !profiles.includes(profile) || parts.length !== 1)
      throw new Error("Use --owner profile=email,email");
    const emails = (parts[0] ?? "").split(",").map((e) => e.trim().toLowerCase());
    if (!emails.length || emails.some((e) => !/^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(e)))
      throw new Error("Supply valid owner email addresses");
    ownerEmails[profile] = emails;
  }
  const all = Object.values(ownerEmails).flat();
  if (new Set(all).size !== all.length) throw new Error("Each owner address must be unique");
  const config: ExportConfig = {
    version: 1,
    enabled:
      options.enabled === undefined ? (previous?.enabled ?? true) : options.enabled === "true",
    profiles,
    ownerEmails,
  };
  await writePrivate(exportConfigPath(), config);
  printData({ root: exportRoot(), config });
}
