/** Opt-in real-browser regression: local fixtures only, no LinkedIn requests or credentials. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { type BrowserContext, chromium } from "playwright";
import { launchAttempts, openBrowserContext } from "../src/linkedin/auth/browser";
import {
  browserEnvDefaults,
  mergeBrowserConfig,
  readBrowserConfig,
} from "../src/linkedin/auth/browser-config";
import { readShieldPackage } from "../src/linkedin/auth/shield";

const config = mergeBrowserConfig(
  readBrowserConfig(),
  browserEnvDefaults(),
  process.argv[2] ? { channel: process.argv[2] } : {}
);
if (config.cdpEndpoint)
  throw new Error(
    "Smoke tests launch isolated browsers; pass an explicit browser name to override saved CDP."
  );
const shield = await readShieldPackage(config.shieldPath);
const workspace = await mkdtemp(join(tmpdir(), "allman-browser-smoke-"));
const options = { ...config, profileDir: join(workspace, "persistent"), workspace, headless: true };
const nonce = randomUUID();
const fixtureUrl = "https://www.linkedin.com/allman-shield-fixture.html";
const trackerUrl = "https://merchantpool1.linkedin.com/mdt.js";
let trackerRequestFailure = "";

async function fixtures(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    if (route.request().url() === fixtureUrl) {
      await route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Allman local fixture</title><h1>Offline browser check</h1>",
      });
    } else {
      await route.fulfill({
        contentType: "application/javascript",
        body: "/* Inert offline fixture; no remote traffic. */",
      });
    }
  });
}

try {
  let session = await openBrowserContext(options);
  const profileDir = session.profileDir;
  const extensionId = session.shield.id;
  try {
    await fixtures(session.context);
    await session.context.addCookies([
      { name: "allman_probe", value: nonce, url: fixtureUrl, expires: Date.now() / 1000 + 600 },
    ]);
    const page = await session.context.newPage();
    await page.goto(fixtureUrl);
    await page.evaluate((value) => localStorage.setItem("allman_probe", value), nonce);
  } finally {
    await session.close();
  }

  session = await openBrowserContext(options);
  try {
    assert.equal(session.profileDir, profileDir);
    assert.equal(session.shield.id, extensionId);
    assert.equal(
      (await session.context.cookies(fixtureUrl)).find((c) => c.name === "allman_probe")?.value,
      nonce
    );
    await fixtures(session.context);
    const page = await session.context.newPage();
    page.on("requestfailed", (request) => {
      if (request.url() === trackerUrl) trackerRequestFailure = request.failure()?.errorText ?? "";
    });
    await page.goto(fixtureUrl);
    assert.equal(await page.evaluate(() => localStorage.getItem("allman_probe")), nonce);
    const scriptLoaded = (url: string) =>
      page.evaluate(
        (src) =>
          new Promise<boolean>((resolve) => {
            const script = document.createElement("script");
            script.onload = () => resolve(true);
            script.onerror = () => resolve(false);
            script.src = src;
            document.head.append(script);
          }),
        url
      );
    assert.equal(await scriptLoaded("https://www.linkedin.com/allman-allowed-fixture.js"), true);
    assert.equal(await scriptLoaded(trackerUrl), false);
    assert.match(trackerRequestFailure, /ERR_BLOCKED_BY_CLIENT/);
    assert.equal(
      await page.evaluate(async (url) => {
        try {
          await fetch(url);
          return "allowed";
        } catch {
          return "blocked";
        }
      }, trackerUrl),
      "blocked"
    );
  } finally {
    await session.close();
  }
  console.log(
    JSON.stringify({
      check: "persistent-profile",
      browser: config.channel ?? "auto",
      cookies: true,
      localStorage: true,
      extensionId,
      shieldVersion: shield.version,
      trackerScript: trackerRequestFailure,
      allowedScript: true,
      trackerFetchBlocked: true,
    })
  );

  // Own the native browser separately, then prove allman's CDP close only disconnects.
  const cdpProfile = join(workspace, "cdp");
  await mkdir(cdpProfile);
  const attempt = launchAttempts(config)[0];
  assert.ok(attempt);
  const executable =
    attempt.executablePath ??
    (attempt.channel === "chromium" ? chromium.executablePath() : undefined);
  assert.ok(
    executable,
    "Smoke CDP launch requires Neo, BrowserOS, bundled Chromium, or an explicit executable"
  );
  const child = spawn(
    executable,
    [
      "--headless=new",
      `--user-data-dir=${cdpProfile}`,
      "--remote-debugging-port=0",
      `--load-extension=${shield.path}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--password-store=basic",
      "--use-mock-keychain",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  let startupLog = "";
  child.stderr?.on("data", (chunk) => {
    startupLog = `${startupLog}${chunk}`.slice(-2000);
  });
  let launchError: Error | undefined;
  child.on("error", (error) => {
    launchError = error;
  });
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
  let owner: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
    let port: string | undefined;
    const deadline = Date.now() + 15_000;
    while (!port && Date.now() < deadline && child.exitCode === null && !launchError) {
      port = await readFile(join(cdpProfile, "DevToolsActivePort"), "utf8")
        .then((s) => s.split("\n")[0])
        .catch(() => undefined);
      if (!port) await delay(100);
    }
    assert.ok(
      port,
      `Owned CDP browser did not start: ${launchError?.message ?? child.exitCode}\n${startupLog}`
    );
    const endpoint = `http://127.0.0.1:${port}`;
    owner = await chromium.connectOverCDP(endpoint);
    const context = owner.contexts()[0];
    assert.ok(context);
    const tab = await context.newPage();
    await tab.setContent("<title>Owned CDP fixture</title>");
    const before = context.pages().length;
    const borrowed = await openBrowserContext({
      headless: true,
      workspace,
      cdpEndpoint: endpoint,
      shieldPath: shield.path,
    });
    await borrowed.close();
    assert.equal(await tab.title(), "Owned CDP fixture");
    assert.equal(context.pages().length, before);
    assert.equal(child.exitCode, null);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${shield.extensionId}/${shield.popup}`);
    const discardedId = await popup.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const candidate = tabs.find((candidate) => !candidate.active);
      if (candidate?.id === undefined) throw new Error("No owned inactive tab to discard");
      const discarded = await chrome.tabs.discard(candidate.id);
      if (!discarded?.discarded || discarded.id === undefined)
        throw new Error("Owned test tab was not discarded");
      // Neo replaces the tab ID when its WebContents is discarded.
      return discarded.id;
    });
    const withDiscardedTab = await openBrowserContext({
      headless: true,
      workspace,
      cdpEndpoint: endpoint,
      shieldPath: shield.path,
    });
    await withDiscardedTab.close();
    assert.equal(
      await popup.evaluate(async (id) => (await chrome.tabs.get(id)).discarded, discardedId),
      true
    );
    console.log(JSON.stringify({ check: "discarded-tab", attaches: true, staysDiscarded: true }));
    await popup.evaluate(() =>
      chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: ["linkedin_blocklist"],
      })
    );
    await popup.close();
    // Discarding detaches that renderer from Playwright; compare the remaining
    // initialized pages around the rejected acquisition, not the pre-discard set.
    const beforeRejected = context.pages().length;
    await assert.rejects(
      openBrowserContext({
        headless: true,
        workspace,
        cdpEndpoint: endpoint,
        shieldPath: shield.path,
      }),
      /verification failed/
    );
    assert.equal(await tab.title(), "Owned CDP fixture");
    assert.equal(context.pages().length, beforeRejected);
    console.log(
      JSON.stringify({
        check: "cdp-ownership",
        disconnectPreservesBrowser: true,
        ownTabsCleaned: true,
        disabledRulesRejected: true,
      })
    );
  } finally {
    if (owner?.isConnected()) {
      await (await owner.newBrowserCDPSession()).send("Browser.close").catch(() => {});
      await owner.close().catch(() => {});
    }
    await Promise.race([exited, delay(5_000)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([exited, delay(3_000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    }
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
}
