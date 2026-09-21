import { resolve } from "node:path";
import { normalizeCdpEndpoint, openBrowserContext } from "../linkedin/auth/browser.js";
import {
  type BrowserConfig,
  browserEnvDefaults,
  browserWorkspace,
  mergeBrowserConfig,
  readBrowserConfig,
  saveBrowserConfig,
} from "../linkedin/auth/browser-config.js";
import { readShieldPackage } from "../linkedin/auth/shield.js";
import * as output from "../utils/output.js";

export interface BrowserCommandOptions {
  browser?: string;
  executable?: string;
  profile?: string;
  cdp?: string;
  shield?: string;
  account?: string;
  json?: boolean;
  headed?: boolean;
}

/** Configuration becomes the default only after a real launch/attach and Shield check. */
export async function browserConfigureCommand(options: BrowserCommandOptions): Promise<void> {
  const workspace = browserWorkspace();
  const config: BrowserConfig = mergeBrowserConfig(
    readBrowserConfig(workspace),
    browserEnvDefaults(),
    {
      channel: options.browser,
      executablePath: options.executable ? resolve(options.executable) : undefined,
      profileDir: options.profile ? resolve(options.profile) : undefined,
      cdpEndpoint: options.cdp ? normalizeCdpEndpoint(options.cdp) : undefined,
      shieldPath: options.shield ? resolve(options.shield) : undefined,
    }
  );
  const shield = await readShieldPackage(config.shieldPath);
  config.shieldPath = shield.path;
  if (config.executablePath) config.executablePath = resolve(config.executablePath);
  if (config.profileDir) config.profileDir = resolve(config.profileDir);
  if (config.cdpEndpoint) config.cdpEndpoint = normalizeCdpEndpoint(config.cdpEndpoint);
  const session = await openBrowserContext({
    ...config,
    headless: !options.headed,
    workspace,
    identity: options.account ?? process.env.ALLMAN_ACCOUNT,
  });
  try {
    if (!config.cdpEndpoint && !config.executablePath) config.channel = session.browser;
    await saveBrowserConfig(config, workspace);
    const result = {
      configured: true,
      workspace,
      browser: session.browser,
      profileDir: session.profileDir,
      shield: session.shield,
    };
    if (options.json) output.printData(result);
    else output.success(`Default browser saved: ${session.description}\nWorkspace: ${workspace}`);
  } finally {
    await session.close();
  }
}

/** Opens no website. The context is returned only after live extension verification. */
export async function browserDoctorCommand(options: BrowserCommandOptions): Promise<void> {
  const session = await openBrowserContext({
    headless: !options.headed,
    channel: options.browser,
    executablePath: options.executable,
    profileDir: options.profile,
    cdpEndpoint: options.cdp,
    shieldPath: options.shield,
    identity: options.account ?? process.env.ALLMAN_ACCOUNT,
  });
  try {
    const result = {
      verified: true,
      browser: session.browser,
      kind: session.kind,
      workspace: browserWorkspace(),
      profileDir: session.profileDir,
      shield: session.shield,
    };
    if (options.json) output.printData(result);
    else output.success(`Browser verified: ${session.description}`);
  } finally {
    await session.close();
  }
}
