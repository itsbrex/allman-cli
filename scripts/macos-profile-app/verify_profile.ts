import { openBrowserContext } from "../../src/linkedin/auth/browser.ts";
import { readSessionRegistry } from "../../src/linkedin/session-control.ts";

const name = process.argv[2];
if (name !== "brian") throw new Error("Unsupported launcher profile");
const profile = readSessionRegistry()?.profiles.find((p) => p.name === name);
if (!profile || profile.browser.cdpEndpoint !== "http://127.0.0.1:9222")
  throw new Error("Brian is not registered at the fixed CDP endpoint");
const session = await openBrowserContext({
  ...profile.browser,
  workspace: profile.workspace,
  headless: true,
});
try {
  if (!session.shield) throw new Error("Brian Shield verification did not succeed");
  console.log(JSON.stringify({ profile: name, shieldVerified: Boolean(session.shield) }));
} finally {
  await session.close();
}
