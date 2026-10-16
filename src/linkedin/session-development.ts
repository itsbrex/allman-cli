import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { allmanConfigRoot } from "../store/config.js";
import { allowExtensionLocalNetwork } from "./auth/local-network.js";
import type { ManagedProfile } from "./session-control.js";
import { restartShieldDevelopment } from "./shield-dev-server.js";

export interface SessionDevelopmentConfig {
  version: 1;
  shield: { root: string; node: string; port: number };
  extensions: string[];
}

/** Opt-in, machine-local configuration shared by every profile/launcher. */
export function readSessionDevelopment(root = allmanConfigRoot()): SessionDevelopmentConfig | null {
  const file = join(root, "session-development.json");
  if (!existsSync(file)) return null;
  try {
    const config = JSON.parse(readFileSync(file, "utf8")) as SessionDevelopmentConfig;
    if (
      config.version !== 1 ||
      !Number.isInteger(config.shield?.port) ||
      config.shield.port < 1024 ||
      config.shield.port > 65535 ||
      !Array.isArray(config.extensions) ||
      config.extensions.length === 0 ||
      ![config.shield.root, config.shield.node, ...config.extensions].every(
        (path) => typeof path === "string" && isAbsolute(path)
      )
    )
      throw new Error("Expected absolute Shield/Node/extension paths and a valid port");
    config.shield.root = realpathSync(config.shield.root);
    config.shield.node = realpathSync(config.shield.node);
    config.extensions = [...new Set(config.extensions.map((path) => realpathSync(path)))];
    const pkg = JSON.parse(readFileSync(join(config.shield.root, "package.json"), "utf8"));
    if (pkg.name !== "linkedin-shield" || pkg.scripts?.dev !== "node dev/server.mjs")
      throw new Error("Shield checkout must declare dev: node dev/server.mjs");
    if (!existsSync(join(config.shield.root, "dev/server.mjs")))
      throw new Error("Shield dev/server.mjs is missing");
    for (const path of config.extensions)
      JSON.parse(readFileSync(join(path, "manifest.json"), "utf8"));
    if (!config.extensions.includes(realpathSync(join(config.shield.root, ".dev-build"))))
      throw new Error("The Shield .dev-build must be included in extensions");
    return config;
  } catch (error) {
    throw new Error(
      `Invalid session development configuration at ${file}: ${(error as Error).message}`
    );
  }
}

/** Called inside the session lock, after protecting inactive profiles. */
export async function prepareSessionDevelopment(profiles: ManagedProfile[]): Promise<boolean> {
  const config = readSessionDevelopment();
  if (!config) return false;
  const shield = realpathSync(join(config.shield.root, ".dev-build"));
  for (const profile of profiles) {
    if (realpathSync(profile.browser.shieldPath) !== shield)
      throw new Error(
        `Profile "${profile.name}" does not use the configured Shield development build`
      );
  }
  for (const profile of profiles) await allowExtensionLocalNetwork(profile, config.extensions);
  await restartShieldDevelopment(config.shield, allmanConfigRoot(), profiles.length);
  return true;
}
