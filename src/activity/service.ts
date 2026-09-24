import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const VIEWER_SERVICE = "com.allman.activity-viewer";
export const VIEWER_URL = "https://allman-activity.localhost/apps/activity.html";

export function viewerServiceStatus() {
  const plist = join(homedir(), "Library/LaunchAgents", `${VIEWER_SERVICE}.plist`);
  const target = `gui/${process.getuid?.()}/${VIEWER_SERVICE}`;
  const base = {
    supported: process.platform === "darwin",
    installed: existsSync(plist),
    plist,
    target,
    url: VIEWER_URL,
  };
  if (!base.supported) return { ...base, loaded: false, running: false, pid: null };
  const result = spawnSync("/bin/launchctl", ["print", target], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (result.error)
    throw new Error("Cannot inspect viewer service: launchctl failed or timed out.");
  if (result.status !== 0) {
    if (!`${result.stderr}${result.stdout}`.includes("Could not find service"))
      throw new Error("Cannot inspect viewer service: launchctl rejected the lookup.");
    return { ...base, loaded: false, running: false, pid: null };
  }
  const pid = result.stdout.match(/^\s*pid = (\d+)$/m)?.[1];
  return {
    ...base,
    loaded: true,
    running: /^\s*state = running$/m.test(result.stdout),
    pid: pid ? Number(pid) : null,
  };
}

export function controlViewerService(action: string) {
  if (!["status", "start", "stop", "restart"].includes(action))
    throw new Error("Use activity service status, start, stop, or restart.");
  const status = viewerServiceStatus();
  if (action === "status") return status;
  if (!status.supported)
    throw new Error(
      "Viewer service controls require macOS launchd. Use allman activity on this platform."
    );
  if (!status.installed) throw new Error(`Viewer LaunchAgent is not installed: ${status.plist}`);
  if (action === "stop" && !status.loaded) return status;
  if (action === "start" && status.running) return status;
  const args =
    action === "stop"
      ? ["bootout", status.target]
      : !status.loaded
        ? ["bootstrap", `gui/${process.getuid?.()}`, status.plist]
        : action === "restart"
          ? ["kickstart", "-k", status.target]
          : ["kickstart", status.target];
  const result = spawnSync("/bin/launchctl", args, { encoding: "utf8", timeout: 10000 });
  if (result.error || result.status !== 0)
    throw new Error(`Viewer service ${action} failed; inspect launchctl status and viewer logs.`);
  return { ...viewerServiceStatus(), requested: action };
}
