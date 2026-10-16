#!/usr/bin/env bun
// PLANS_TPL_VERSION: 30
// Plan-page toolchain for docs/plans/ — browse, create, and index interactive
// HTML plan pages. Runs on `bun` (preferred, faster) or `node`.
//
//   bun run plans                 # interactive picker (fzf if available) — plans + apps
//   bun run plans latest          # open the newest plan/app, no prompt
//   bun run plans <substr>        # open first plan/app whose name matches
//   bun run plans new <slug> [--title "T"] [--source "who/what"]
//                                 # stamp a new interactive plan page (auto-numbered,
//                                 # repo accent color, provenance line)
//   bun run plans app <slug> [--title "T"] [--badge "TAG"] [--dest dir] [--recipe name]
//                                 # stamp a single-file skeleton APP. Delegates to appkit
//                                 # (~/.claude/templates/appkit) — the canonical parts +
//                                 # recipes source — which also records provenance in
//                                 # <repo>/.appkit/lock.json so the app can be upgraded
//                                 # later with `appkit diff` / `appkit migrate`.
//                                 # `--template <name>` still uses the legacy copy-a-file
//                                 # path for variants not yet ported to a recipe.
//   bun run plans index [--quiet] # regenerate docs/plans/index.html dashboard
//   bun run plans serve [--name x] <cmd…>
//                                 # run a dev/app server through portless: stable
//                                 # https://<appName>.localhost URL, no port numbers,
//                                 # no EADDRINUSE. appName lives in plans.config.json
//                                 # (created once per repo, reused for ALL HTML pages).
//   bun run plans wait <slug> [--seq N] [--timeout S] [--any]
//                                 # block until the reader submits that plan's decisions
//                                 # through the hub; prints the inbox JSON path and exits.
//   bun run plans hub register|status|install|uninstall|start|stop|logs|url|run
//                                 # v17 always-on hub: one Bun process (launchd agent
//                                 # sh.claude.plans-hub) serves every registered repo at
//                                 # https://<appName>.localhost/plans/ through portless
//                                 # (static alias route, no per-repo process) and writes
//                                 # submitted decisions to ~/.claude/plans-hub/inbox/.
//   bun run plans hub remote [status|on|off] [--provider tailscale|funnel|ngrok|cloudflare]
//                                 # v19: reach the hub from your phone off-LAN. tailscale =
//                                 # `tailscale serve` (tailnet-only, needs the Tailscale app
//                                 # logged in on both devices); funnel = public via Tailscale
//                                 # Funnel; ngrok / cloudflare = a launchd tunnel agent
//                                 # (public; named Cloudflare tunnels keep a permanent hostname).
//                                 # Every remote request needs the shared key
//                                 # from ~/.claude/plans-hub/hub.config.json (link carries it
//                                 # once, then a cookie). Pages route as /<appName>/plans/….
//   bun run plans hub notify [status|set --channel imessage|command|off --to <handle>|--transport osascript|imsg|--preview on|off|--command "…"|test]
//                                 # v19: how `plans wait` reaches you — iMessage to yourself
//                                 # (Messages.app via osascript, or the imsg CLI) with a
//                                 # phone-sized PNG preview of the page attached (headless
//                                 # Chromium), or any shell command (message on stdin,
//                                 # $PLANS_NOTIFY_TEXT, $PLANS_NOTIFY_FILE).
//   bun run plans notify [--test] # send the "waiting for you" text now (all repos)
//   bun run plans done <slug> [--seq N] [--items d01,d03] [--note "…"] [--commit sha,…]
//                                 # v19: record that the approved decisions were executed
//                                 # (~/.claude/plans-hub/done/) — run it after executing a
//                                 # submission so the landing page / status show "implemented".
//   bun run plans status [--all] [--json]
//                                 # v19: every plan's lifecycle: stamped → submitted (inbox,
//                                 # ✓/✗ counts) → implemented (done marker), plus a git hint
//                                 # (commits after submission that mention the plan or its
//                                 # item ids). --all = every registered repo.
//   bun run plans inbox import [file…]
//                                 # v19: adopt pre-v17 "<slug>-decisions.json" downloads
//                                 # (default ~/Downloads/*-decisions.json) into the hub inbox.
//   bun run plans help            # print usage (also -h, --help)
//
// Per-repo config lives at docs/plans/plans.config.json:
//   { version, accent, accentHue, accentName, appName, nextSeq, port, createdAt }
// The accent is randomized once per repo (by the SessionStart hook or on first
// `new`) and reused for every page so a repo's plans stay visually cohesive.
// `port` is the repo's decision-listener port (47614–47899), derived
// deterministically from appName so concurrent sessions in different repos
// never fight over one port (47613 was the old shared port; v14 pages stop
// using it, and the listener/page handshake also verifies the plan slug).
//
// v16 hardening (ported from the cre-pipeline-recovery-agent fork, 2026-09-10):
// context-aware stamping (__X_HTML__/__X_JSON__ placeholders), a sequence lock
// + seq reconciliation for concurrent `new`, atomic config writes, appName /
// accent validation, --dest confined to the repo root, and a per-plan
// submission token the listener verifies alongside the v14 slug handshake.
// v18 (impeccable pass): the page, mono variant and dashboard templates were
// reworked for production quality — one-row toolbar, drawn icon sprite, summary
// line instead of metric tiles, no colored side borders, thumb-reach action bar
// on phones, clearer status/submit copy, themed browser surfaces, an authored
// send moment, and an axe-clean paper theme. Visual evidence in provenance/.
// v19 (remote + notify): the hub answers any non-.localhost Host with
// path-prefixed routing (/<appName>/plans/<file>.html) behind a shared key, and
// rewrites each served page's ENDPOINT line to its own prefix, so a page opened
// through a Tailscale/cloudflared tunnel on a phone submits back to the same
// hub. `plans wait` drops a marker in ~/.claude/plans-hub/waiting/ (the remote
// landing page lists those first) and texts you the link; `plans serve` turns
// on PORTLESS_TAILSCALE when the remote provider is tailscale.
// v17 (plans hub): pages are stamped with ENDPOINT = https://<appName>.localhost
// and open there when the hub answers; otherwise they open from file:// and
// still work (JSON download fallback). `plans hub register` (run silently by
// the SessionStart hook) upserts ~/.claude/plans-hub/registry.json, registers
// the portless alias once, suffixes a colliding appName, and never sudo's.
// Managed template: ~/.claude/templates/plans/ (auto-scaffolded + upgraded by the
// SessionStart hook; provenance in <repo>/.plans-template.json; optional explicit
// inspection/adopt/upgrade via ~/.claude/templates/plans/manage-plans.mjs).

import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { existsSync, readFileSync, rmSync, watch as fsWatch, statSync } from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

// fileURLToPath, NOT .pathname: URL pathnames keep percent-encoding, so a repo
// under a path with spaces (e.g. iCloud "Mobile Documents") would resolve to a
// bogus "Mobile%20Documents" root and silently write config/pages there.
const ROOT = process.env.__PLANS_ROOT || path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PLANS_DIR = path.join(ROOT, 'docs', 'plans');
const CONFIG_PATH = path.join(PLANS_DIR, 'plans.config.json');
const TEMPLATE_PATH = path.join(PLANS_DIR, '.plan-template.html');
const SEQUENCE_LOCK_PATH = path.join(PLANS_DIR, '.plans-sequence.lock');
const SEQUENCE_LOCK_OWNER_PATH = path.join(SEQUENCE_LOCK_PATH, 'owner.json');
const SEQUENCE_LOCK_TIMEOUT_MS = Number(process.env.__PLANS_LOCK_TIMEOUT_MS || 10_000);
const SEQUENCE_LOCK_STALE_MS = Number(process.env.__PLANS_LOCK_STALE_MS || 60_000);

// High-contrast accents on true black (OKLCH). One is chosen at random per repo.
const ACCENTS = [
  { name: 'lime', hue: 132, css: 'oklch(0.87 0.20 132)' },
  { name: 'cyan', hue: 215, css: 'oklch(0.82 0.15 215)' },
  { name: 'violet', hue: 300, css: 'oklch(0.76 0.19 300)' },
  { name: 'amber', hue: 75, css: 'oklch(0.83 0.16 75)' },
  { name: 'pink', hue: 8, css: 'oklch(0.76 0.20 8)' },
  { name: 'coral', hue: 30, css: 'oklch(0.78 0.17 30)' },
  { name: 'mint', hue: 165, css: 'oklch(0.85 0.16 165)' },
  { name: 'azure', hue: 245, css: 'oklch(0.78 0.16 245)' },
  { name: 'magenta', hue: 330, css: 'oklch(0.77 0.19 330)' },
  { name: 'chartreuse', hue: 105, css: 'oklch(0.86 0.19 105)' },
];

const SYSTEM_FILES = new Set(['index.html']);

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function decodeHtmlText(value) {
  return String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function jsLiteral(value) {
  return JSON.stringify(String(value)).replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function legacyLiteral(value) {
  return escapeHtml(value).replace(/\r/g, '&#13;').replace(/\n/g, '&#10;')
    .replace(/\u2028/g, '&#8232;').replace(/\u2029/g, '&#8233;');
}

function replaceLiterals(template, replacements) {
  return Object.entries(replacements).reduce(
    (page, [placeholder, value]) => page.replaceAll(placeholder, () => String(value)),
    template,
  );
}

function stampAppTemplate(template, values) {
  return Object.entries(values).reduce((page, [key, value]) => replaceLiterals(page, {
    [`__APP_${key}_HTML__`]: escapeHtml(value),
    [`__APP_${key}_JSON__`]: jsLiteral(value),
    [`__APP_${key}__`]: legacyLiteral(value),
  }), template);
}

async function writeConfig(cfg) {
  const temp = `${CONFIG_PATH}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(cfg, null, 2) + '\n');
    await fs.rename(temp, CONFIG_PATH);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function processIdentity(pid) {
  // PID alone can name an unrelated process after recycling. Start time is
  // stable for a process instance on the supported macOS/Linux hosts.
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], {
    encoding: 'utf8', timeout: 1000, env: { ...process.env, LC_ALL: 'C' },
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

function lockOwnerIsAlive(owner) {
  if (!owner || !processIsAlive(owner.pid)) return false;
  if (typeof owner.processIdentity !== 'string') return true; // Conservative legacy fallback.
  const current = processIdentity(owner.pid);
  return current === null || current === owner.processIdentity;
}

async function readLockOwner(ownerPath = SEQUENCE_LOCK_OWNER_PATH) {
  try {
    const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
    return typeof owner.token === 'string' && Number.isInteger(owner.pid) ? owner : null;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function retireSequenceLock(expectedToken, reason, lockPath = SEQUENCE_LOCK_PATH) {
  const quarantine = `${lockPath}.${reason}-${randomBytes(8).toString('hex')}`;
  try {
    await fs.rename(lockPath, quarantine);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  const movedOwner = await readLockOwner(path.join(quarantine, 'owner.json'));
  if (expectedToken && movedOwner?.token !== expectedToken) {
    throw new Error('Sequence lock ownership changed during release');
  }
  await fs.rm(quarantine, { recursive: true, force: true });
  return true;
}

async function acquireSequenceLock(lockPath = SEQUENCE_LOCK_PATH) {
  const ownerPath = path.join(lockPath, "owner.json");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const started = Date.now();
  const token = randomBytes(18).toString('base64url');
  const identity = processIdentity(process.pid);
  while (true) {
    try {
      await fs.mkdir(lockPath, { mode: 0o700 });
      await fs.writeFile(ownerPath, JSON.stringify({
        pid: process.pid,
        processIdentity: identity,
        token,
        createdAt: new Date().toISOString(),
      }) + '\n', { flag: 'wx', mode: 0o600 });
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        const owner = await readLockOwner(ownerPath);
        if (owner?.token !== token) return;
        await retireSequenceLock(token, 'release', lockPath);
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const [stat, owner] = await Promise.all([
          fs.stat(lockPath),
          readLockOwner(ownerPath),
        ]);
        if (
          Date.now() - stat.mtimeMs > SEQUENCE_LOCK_STALE_MS &&
          !lockOwnerIsAlive(owner)
        ) {
          await retireSequenceLock(owner?.token, 'stale', lockPath);
          continue;
        }
      } catch (statError) {
        if (statError.code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() - started >= SEQUENCE_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for ${lockPath}`);
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
}

/* ---------------- config ---------------- */
async function loadConfig() {
  let source;
  try {
    source = await fs.readFile(CONFIG_PATH, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return JSON.parse(source);
}

// Stable per-repo app name for portless URLs (https://<appName>.localhost).
// Derived once from the repo folder name; edit plans.config.json to rename.
function defaultAppName() {
  return path.basename(ROOT).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

// Deterministic per-repo listener port: FNV-1a of appName folded into
// 47614–47899. Same repo -> same port forever; different repos land apart so
// two sessions' plan listeners can coexist. 47613 (the legacy shared port) is
// outside the range on purpose.
function planPort(appName) {
  let h = 0x811c9dc5;
  for (let i = 0; i < appName.length; i++) {
    h ^= appName.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 47614 + (h % 286);
}

function validateAppName(value) {
  if (
    typeof value !== 'string' ||
    !/^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)
  ) {
    throw new Error('plans.config.json appName must be one lowercase DNS-safe label');
  }
  return value;
}

function validateAccentConfig(cfg) {
  const accent = ACCENTS.find(item => (
    item.css === cfg.accent && item.hue === cfg.accentHue && item.name === cfg.accentName
  ));
  if (!accent) {
    throw new Error('plans.config.json accent fields must match one curated OKLCH accent');
  }
}

function validatePort(value) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error('plans.config.json port must be an integer between 1024 and 65535');
  }
  return value;
}

async function resolveInsideRoot(value, label) {
  const resolved = path.resolve(ROOT, value);
  const relative = path.relative(ROOT, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside repository root`);
  }
  const rootReal = await fs.realpath(ROOT);
  let existing = resolved;
  let existingReal;
  while (!existingReal) {
    try {
      existingReal = await fs.realpath(existing);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
  const realRelative = path.relative(rootReal, existingReal);
  if (
    realRelative === '..' ||
    realRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realRelative)
  ) {
    throw new Error(`${label} resolves outside repository root`);
  }
  return { resolved, relative: relative || '.' };
}

async function ensureConfig() {
  let cfg = await loadConfig();
  if (cfg && cfg.accent && cfg.nextSeq && cfg.appName && cfg.port) {
    validateAppName(cfg.appName);
    validateAccentConfig(cfg);
    validatePort(cfg.port);
    return cfg;
  }
  const pick = ACCENTS[Math.floor(Math.random() * ACCENTS.length)];
  cfg = {
    version: 2,
    accent: pick.css,
    accentHue: pick.hue,
    accentName: pick.name,
    nextSeq: 1,
    createdAt: new Date().toISOString(),
    ...(cfg || {}),
  };
  cfg.accent = cfg.accent || pick.css;
  cfg.nextSeq = cfg.nextSeq || 1;
  cfg.appName = cfg.appName || defaultAppName();
  validateAppName(cfg.appName);
  validateAccentConfig(cfg);
  cfg.port = cfg.port || planPort(cfg.appName);
  validatePort(cfg.port);
  await fs.mkdir(PLANS_DIR, { recursive: true });
  await writeConfig(cfg);
  return cfg;
}

/* ---------------- listing ---------------- */
async function readHtmlItem(full, { name, kind, readSeq = false }) {
  const st = await fs.stat(full);
  let seq = null;
  let title = name;
  try {
    const head = (await fs.readFile(full, 'utf8')).slice(0, 4000);
    if (readSeq) {
      const seqMatch = head.match(/data-plan-seq="(\d+)"/);
      if (seqMatch) seq = Number(seqMatch[1]);
    }
    const titleMatch = head.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) title = decodeHtmlText(titleMatch[1].trim());
  } catch {}
  return { name, path: full, mtime: st.mtimeMs, seq, title, kind };
}

async function listPlans() {
  let entries;
  try {
    entries = await fs.readdir(PLANS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const html = entries.filter(
    e => e.isFile() && e.name.toLowerCase().endsWith('.html')
      && !e.name.startsWith('.') && !SYSTEM_FILES.has(e.name)
  );
  const withStat = await Promise.all(html.map(e => readHtmlItem(
    path.join(PLANS_DIR, e.name),
    { name: e.name, kind: 'plan', readSeq: true },
  )));
  // Order: seq desc when present, else mtime desc. Seq'd pages outrank legacy ones.
  return withStat.sort((a, b) => (b.seq ?? -1) - (a.seq ?? -1) || b.mtime - a.mtime);
}

/* ---------------- apps (stamped single-file skeletons) ---------------- */
// Stamped apps live in <repo>/apps/ by default (or docs/plans/apps/). Surface
// them in the picker so `plans` browses plans AND apps, not just plan pages.
async function listApps() {
  const dirs = [path.join(ROOT, 'apps'), path.join(PLANS_DIR, 'apps')];
  const seen = new Set();
  const out = [];
  for (const dir of dirs) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.html') || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (seen.has(full)) continue;
      seen.add(full);
      out.push(await readHtmlItem(full, {
        name: path.relative(ROOT, full),
        kind: 'app',
      }));
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// Combined browse list for the picker: plan pages first (seq order), then apps.
async function listBrowsable() {
  const [plans, apps] = await Promise.all([listPlans(), listApps()]);
  return [...plans, ...apps];
}


/* ---------------- plans hub (v17) ---------------- */
const HUB_DIR = process.env.PLANS_HUB_DIR || path.join(os.homedir(), '.claude', 'plans-hub');
const HUB_CONFIG_PATH = path.join(HUB_DIR, 'hub.config.json');
const HUB_REGISTRY_PATH = path.join(HUB_DIR, 'registry.json');
const HUB_INBOX_DIR = path.join(HUB_DIR, 'inbox');
const HUB_SCRIPT = path.join(HUB_DIR, 'hub.ts');
const HUB_LABEL = 'sh.claude.plans-hub';
const HUB_PLIST_SRC = path.join(HUB_DIR, `${HUB_LABEL}.plist`);
const HUB_PLIST_DST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${HUB_LABEL}.plist`);
const HUB_LOG = path.join(os.homedir(), '.claude', 'logs', 'plans-hub.log');
const HUB_WAITING_DIR = path.join(HUB_DIR, 'waiting');
const HUB_TUNNEL_LABEL = 'sh.claude.plans-hub-tunnel';
const HUB_TUNNEL_PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${HUB_TUNNEL_LABEL}.plist`);
const HUB_TUNNEL_LOG = path.join(os.homedir(), '.claude', 'logs', 'plans-hub-tunnel.log');
const HUB_TUNNEL_CONFIG = path.join(HUB_DIR, 'cloudflared.yml');   // ingress for a locally managed named tunnel
const TAILSCALE_APP_BIN = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
// Tailscale Serve port for the hub. Not 443: portless binds 443 on every
// interface (including the node's tailnet IP), so a Mac-local request to its
// own ts.net name would hit portless instead of Serve — and iMessage link
// cards are generated on the sending Mac. Other devices reach any port.
const TS_HUB_PORT = 8443;
const NOTIFY_DEDUPE_MS = 30 * 60_000;
const HUB_PREVIEW_DIR = path.join(HUB_DIR, 'previews');
const HUB_DONE_DIR = path.join(HUB_DIR, 'done');

async function readJsonOr(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}
async function hubPort() {
  const cfg = await readJsonOr(HUB_CONFIG_PATH, {});
  return validatePort(Number(process.env.PLANS_HUB_PORT || cfg.port || 47601));
}
async function hubHealth() {
  try {
    const r = await fetch(`http://127.0.0.1:${await hubPort()}/plans/_health`, { signal: AbortSignal.timeout(500) });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.hub === 'plans-hub' ? j : null;
  } catch { return null; }
}
// Is https://<app>.localhost actually routed to the hub right now? Bun's fetch
// honors `tls`; node's does not, so fall back to curl, then to "no".
async function hubRoutes(appName) {
  const url = `https://${appName}.localhost/plans/_ping`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(800), tls: { rejectUnauthorized: false } });
    if (r.ok) { const j = await r.json(); return !!(j && j.hub === 'plans-hub' && j.app === appName); }
  } catch {}
  if (have('curl')) {
    const r = spawnSync('curl', ['-sk', '-m', '1', url], { encoding: 'utf8' });
    try { const j = JSON.parse(r.stdout || ''); return !!(j && j.hub === 'plans-hub' && j.app === appName); } catch {}
  }
  return false;
}
function hubUrlFor(file, appName) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const base = path.basename(file);
  if (rel === `docs/plans/${base}`) return `https://${appName}.localhost/plans/${base}`;
  if (rel === `apps/${base}` || rel === `docs/plans/apps/${base}`) return `https://${appName}.localhost/apps/${base}`;
  return null;
}
function launchctl(...args) {
  return spawnSync('launchctl', args, { encoding: 'utf8' });
}
function hubDomain() { return `gui/${process.getuid()}`; }
function hubLoaded() { return launchctl('print', `${hubDomain()}/${HUB_LABEL}`).status === 0; }

async function hubRegister(argv) {
  const { flags } = parseFlags(argv);
  const quiet = 'quiet' in flags;
  const release = await acquireSequenceLock(path.join(path.dirname(HUB_REGISTRY_PATH), ".registry.lock"));
  try {
    const cfg = await ensureConfig();
    const port = await hubPort();
    const rootReal = await fs.realpath(ROOT);
    const reg = await readJsonOr(HUB_REGISTRY_PATH, { version: 1, apps: {} });
    if (!reg.apps || typeof reg.apps !== 'object') reg.apps = {};
    // Collision: the name belongs to a different, still-existing repo → suffix once.
    let name = cfg.appName;
    const owner = reg.apps[name];
    if (owner && owner.root !== rootReal && existsSync(owner.root)) {
      let n = 2;
      while (reg.apps[`${name}-${n}`] && reg.apps[`${name}-${n}`].root !== rootReal && existsSync(reg.apps[`${name}-${n}`].root)) n++;
      const next = `${name}-${n}`;
      console.log(`[plans hub] appName "${name}" already routes to ${owner.root}; this repo now uses "${next}" (docs/plans/plans.config.json updated — commit it).`);
      cfg.appName = validateAppName(next);
      await writeConfig(cfg);
      name = next;
    }
    const now = new Date().toISOString();
    const prev = reg.apps[name] || {};
    const isNew = prev.root !== rootReal;
    const entry = { root: rootReal, registeredAt: prev.registeredAt || now, lastSeen: now, aliasedAt: prev.aliasedAt || null };
    let aliased = false;
    if (!process.env.PLANS_HUB_OFFLINE && have('portless')) {
      const stale = !entry.aliasedAt || (Date.now() - Date.parse(entry.aliasedAt)) > 86_400_000;
      if (stale || 'force' in flags) {
        const r = spawnSync('portless', ['alias', name, String(port)], { encoding: 'utf8', timeout: 5000 });
        if (r.status === 0) { entry.aliasedAt = now; aliased = true; }
        else if (!quiet) console.error(`[plans hub] portless alias failed: ${String(r.stderr || r.stdout || '').trim()}`);
      }
    } else if (isNew && !quiet) {
      console.log('[plans hub] portless is not installed — pages open from file://. `npm i -g portless && portless service install` enables https://<appName>.localhost.');
    }
    reg.apps[name] = entry;
    await writeJsonAtomic(HUB_REGISTRY_PATH, reg);
    if (!process.env.PLANS_HUB_OFFLINE && !(await hubHealth())) {
      if (existsSync(HUB_PLIST_DST)) {
        if (hubLoaded()) launchctl('kickstart', '-k', `${hubDomain()}/${HUB_LABEL}`);
        else launchctl('bootstrap', hubDomain(), HUB_PLIST_DST);
      } else if (isNew && !quiet) {
        console.log(`[plans hub] hub agent not installed — run \`bun run plans hub install\` once; then https://${name}.localhost/plans/`);
      }
    }
    if (!quiet) console.log(`[plans hub] ${name} -> ${rootReal}${aliased ? ' (portless alias registered)' : ''} · https://${name}.localhost/plans/`);
    return name;
  } finally { await release(); }
}

async function hubInstall() {
  if (process.platform !== 'darwin') { console.error('[plans hub] launchd install is macOS-only; run `bun run plans hub run` under your own supervisor.'); process.exit(1); }
  if (!existsSync(HUB_SCRIPT) || !existsSync(HUB_PLIST_SRC)) { console.error(`[plans hub] missing ${HUB_SCRIPT} or ${HUB_PLIST_SRC}`); process.exit(1); }
  const bunBin = spawnSync('command', ['-v', 'bun'], { shell: true, encoding: 'utf8' }).stdout.trim() || process.execPath;
  const plist = readFileSync(HUB_PLIST_SRC, 'utf8').replaceAll('__BUN__', bunBin).replaceAll('__HOME__', os.homedir());
  await fs.mkdir(path.dirname(HUB_PLIST_DST), { recursive: true });
  await fs.mkdir(path.dirname(HUB_LOG), { recursive: true });
  await fs.writeFile(HUB_PLIST_DST, plist);
  if (hubLoaded()) launchctl('bootout', `${hubDomain()}/${HUB_LABEL}`);
  const r = launchctl('bootstrap', hubDomain(), HUB_PLIST_DST);
  if (r.status !== 0) { console.error(`[plans hub] launchctl bootstrap failed: ${(r.stderr || '').trim()}`); process.exit(1); }
  for (let i = 0; i < 20; i++) { if (await hubHealth()) break; await new Promise(res => setTimeout(res, 150)); }
  const h = await hubHealth();
  console.log(h ? `[plans hub] installed and running on 127.0.0.1:${h.port} (rss ${(h.rss / 1e6).toFixed(1)} MB) — agent ${HUB_LABEL}, log ${HUB_LOG}`
                : `[plans hub] agent installed but the hub is not answering yet — see ${HUB_LOG}`);
}

async function cmdHub(argv) {
  const sub = argv[0];
  if (sub === 'register') { await hubRegister(argv.slice(1)); return; }
  if (sub === 'install') return hubInstall();
  if (sub === 'uninstall') {
    if (hubLoaded()) launchctl('bootout', `${hubDomain()}/${HUB_LABEL}`);
    await fs.rm(HUB_PLIST_DST, { force: true });
    console.log('[plans hub] agent removed (registry, inbox, and portless aliases kept).');
    return;
  }
  if (sub === 'start') {
    if (!existsSync(HUB_PLIST_DST)) return hubInstall();
    if (hubLoaded()) launchctl('kickstart', '-k', `${hubDomain()}/${HUB_LABEL}`); else launchctl('bootstrap', hubDomain(), HUB_PLIST_DST);
    for (let i = 0; i < 20; i++) { if (await hubHealth()) break; await new Promise(res => setTimeout(res, 150)); }
    console.log((await hubHealth()) ? '[plans hub] running' : `[plans hub] not answering — see ${HUB_LOG}`);
    return;
  }
  if (sub === 'stop') { if (hubLoaded()) launchctl('bootout', `${hubDomain()}/${HUB_LABEL}`); console.log('[plans hub] stopped (agent unloaded until `plans hub start`).'); return; }
  if (sub === 'logs') {
    try { const lines = (await fs.readFile(HUB_LOG, 'utf8')).trimEnd().split('\n'); console.log(lines.slice(-40).join('\n')); }
    catch { console.log(`[plans hub] no log at ${HUB_LOG}`); }
    return;
  }
  if (sub === 'run') {
    const child = spawn(process.execPath.endsWith('bun') ? process.execPath : 'bun', ['--smol', HUB_SCRIPT], { stdio: 'inherit', env: process.env });
    child.on('exit', code => process.exit(code ?? 0));
    return;
  }
  if (sub === 'url') {
    const cfg = await ensureConfig();
    if (argv.includes('--remote')) {
      const info = await remoteInfo();
      if (!info.live) { console.error(`[plans hub] remote is ${info.enabled ? 'not reachable' : 'off'}${info.reason ? ` (${info.reason})` : ''} — bun run plans hub remote on`); process.exit(1); }
      console.log(remoteLink(info, `/${cfg.appName}/plans/`));
      return;
    }
    console.log(`https://${cfg.appName}.localhost/plans/`);
    return;
  }
  if (sub === 'remote') return hubRemote(argv.slice(1));
  if (sub === 'notify') return hubNotify(argv.slice(1));
  if (sub === 'status' || !sub) {
    const cfg = await ensureConfig();
    const h = await hubHealth();
    const reg = await readJsonOr(HUB_REGISTRY_PATH, { version: 1, apps: {} });
    const mine = reg.apps?.[cfg.appName];
    console.log(`hub:      ${h ? `running on 127.0.0.1:${h.port} · rss ${(h.rss / 1e6).toFixed(1)} MB · up ${h.uptime}s · ${h.routes} route(s)` : 'not running'}`);
    console.log(`agent:    ${existsSync(HUB_PLIST_DST) ? (hubLoaded() ? 'installed + loaded' : 'installed (not loaded)') : 'not installed — bun run plans hub install'}`);
    console.log(`portless: ${have('portless') ? 'installed' : 'missing'}`);
    console.log(`this repo: ${cfg.appName} -> ${mine ? mine.root : '(not registered — bun run plans hub register)'}${mine?.aliasedAt ? ` · alias ${mine.aliasedAt}` : ''}`);
    console.log(`url:      https://${cfg.appName}.localhost/plans/  (${(await hubRoutes(cfg.appName)) ? 'reachable' : 'not reachable'})`);
    const info = await remoteInfo();
    console.log(`remote:   ${info.enabled ? `${info.provider} · ${info.baseUrl ? `${info.baseUrl}/` : '(url unknown)'}${info.reason ? ` · ${info.reason}` : ' · live'}` : 'off — bun run plans hub remote on [--provider tailscale|funnel|ngrok|cloudflare]'}`);
    const n = await notifyConfig();
    console.log(`notify:   ${n.channel && n.channel !== 'off' ? `${n.channel}${n.to ? ` -> ${n.to}` : ''}${n.command ? ` (${n.command})` : ''}` : 'off — bun run plans hub notify set --channel imessage --to <your iMessage handle>'}`);
    return;
  }
  console.error('Usage: plans hub register [--quiet] | status | install | uninstall | start | stop | logs | url [--remote] | run | remote … | notify …');
  process.exit(1);
}


/* ---------------- remote access + notifications (v19) ---------------- */
async function hubConfig() { return readJsonOr(HUB_CONFIG_PATH, {}); }
async function writeHubConfig(cfg) { await fs.mkdir(HUB_DIR, { recursive: true }); await writeJsonAtomic(HUB_CONFIG_PATH, cfg); try { await fs.chmod(HUB_CONFIG_PATH, 0o600); } catch {} }
function tailscaleBin() {
  if (have('tailscale')) return 'tailscale';
  if (existsSync(TAILSCALE_APP_BIN)) return TAILSCALE_APP_BIN;
  return null;
}
function tailscaleStatus() {
  const bin = tailscaleBin();
  if (!bin) return null;
  const r = spawnSync(bin, ['status', '--json'], { encoding: 'utf8', timeout: 8000 });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}
function tailscaleDns(st) { return String(st?.Self?.DNSName || '').replace(/\.$/, ''); }
function tailscaleReady(st) { return !!st && st.BackendState === 'Running' && !!tailscaleDns(st); }
const TUNNEL_PROVIDERS = {
  // Agent-style providers run under launchd (sh.claude.plans-hub-tunnel) and
  // only ever print their public URL to the log; the last match wins.
  cloudflare: { bin: 'cloudflared', args: (port) => ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`],
    url: /https:\/\/([a-z0-9-]+)\.trycloudflare\.com(?![\w./-]*tunnel")/g, skip: (m) => m[1] === 'api',
    note: 'public quick tunnel; URL changes when the tunnel restarts' },
  ngrok: { bin: 'ngrok', args: (port) => ['http', String(port), '--log', 'stdout', '--log-format', 'json'],
    url: /https:\/\/([a-z0-9-]+)\.ngrok(?:-free)?\.(?:app|dev|io)/g, skip: () => false,
    note: 'public; random ngrok URL that changes when the agent restarts; free plans show a one-time "Visit site" interstitial' },
};
function tunnelUrlFromLog(provider) {
  const spec = TUNNEL_PROVIDERS[provider];
  if (!spec) return null;
  try {
    const m = [...readFileSync(HUB_TUNNEL_LOG, 'utf8').matchAll(spec.url)].filter(x => !spec.skip(x));
    return m.length ? m[m.length - 1][0] : null;
  } catch { return null; }
}
// { enabled, provider, baseUrl, secret, live, reason } — refreshes baseUrl from
// the provider (tailscale DNS name / tunnel log) and caches it in hub.config.json.
async function remoteInfo({ refresh = true } = {}) {
  const cfg = await hubConfig();
  const r = cfg.remote || {};
  const info = { enabled: r.enabled !== false && !!r.secret && !!r.provider, provider: r.provider || null, baseUrl: r.baseUrl || null, secret: r.secret || null, reason: '', live: false };
  if (!info.enabled) { info.reason = r.provider ? 'remote disabled' : 'remote not configured'; return info; }
  if (refresh && !process.env.PLANS_HUB_OFFLINE) {
    let next = null;
    if (info.provider === 'tailscale' || info.provider === 'funnel') {
      const st = tailscaleStatus();
      const tsPort = Number(r.tsPort) || TS_HUB_PORT;
      if (tailscaleReady(st)) next = `https://${tailscaleDns(st)}${tsPort === 443 ? '' : `:${tsPort}`}`;
      else info.reason = st ? `tailscale is ${st.BackendState || 'stopped'} — open the Tailscale menu bar app and log in` : 'tailscale CLI not found';
    } else if (info.provider === 'cloudflare' && r.named && r.hostname) {
      next = `https://${r.hostname}`;
      if (!tunnelLoaded()) info.reason = `tunnel agent ${HUB_TUNNEL_LABEL} is not loaded — bun run plans hub remote on`;
    } else if (TUNNEL_PROVIDERS[info.provider]) {
      next = tunnelUrlFromLog(info.provider);
      if (!next) info.reason = `tunnel URL not in ${HUB_TUNNEL_LOG} yet`;
      else if (!tunnelLoaded()) info.reason = `tunnel agent ${HUB_TUNNEL_LABEL} is not loaded — bun run plans hub remote on`;
    }
    if (next && next !== info.baseUrl) { info.baseUrl = next; cfg.remote = { ...r, baseUrl: next }; await writeHubConfig(cfg); }
  }
  info.live = !!info.baseUrl && !info.reason;
  return info;
}
function remoteLink(info, p) { return `${info.baseUrl}${p}${p.includes('?') ? '&' : '?'}key=${encodeURIComponent(info.secret)}`; }
function remotePathFor(file, appName) {
  const base = path.basename(file);
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (rel === `docs/plans/${base}`) return `/${appName}/plans/${base}`;
  if (rel === `apps/${base}` || rel === `docs/plans/apps/${base}`) return `/${appName}/apps/${base}`;
  return null;
}
function tunnelPlist(provider, port) {
  const spec = TUNNEL_PROVIDERS[provider];
  const bin = spawnSync('command', ['-v', spec.bin], { shell: true, encoding: 'utf8' }).stdout.trim();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${HUB_TUNNEL_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeHtml(bin)}</string>
${spec.args(port).map(a => `    <string>${escapeHtml(a)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${escapeHtml(HUB_TUNNEL_LOG)}</string>
  <key>StandardErrorPath</key><string>${escapeHtml(HUB_TUNNEL_LOG)}</string>
</dict>
</plist>
`;
}
function tunnelLoaded() { return launchctl('print', `${hubDomain()}/${HUB_TUNNEL_LABEL}`).status === 0; }
function stopTailscaleRemote(remote) {
  if (!remote?.enabled || !['tailscale', 'funnel'].includes(remote.provider)) return;
  const bin = tailscaleBin();
  if (!bin) throw new Error('Cannot retire previous remote: Tailscale CLI is unavailable.');
  const result = spawnSync(bin, [remote.provider === 'funnel' ? 'funnel' : 'serve', '--yes', `--https=${Number(remote.tsPort) || TS_HUB_PORT}`, 'off'], { encoding: 'utf8', timeout: 20000 });
  if (result.status !== 0) throw new Error(`Cannot retire previous ${remote.provider} listener: ${String(result.stderr || result.stdout || '').trim()}`);
}
async function hubRemote(argv) {
  const { flags, rest } = parseFlags(argv);
  const sub = rest[0] || 'status';
  const cfg = await hubConfig();
  const port = await hubPort();
  const fail = (msg) => { console.error(`[plans hub remote] ${msg}`); process.exit(1); };
  if (sub === 'status') {
    const info = await remoteInfo();
    if (!info.enabled) { console.log(`remote: off (${info.reason}) — bun run plans hub remote on [--provider tailscale|funnel|ngrok|cloudflare]`); return; }
    console.log(`remote: ${info.provider} · ${info.live ? 'live' : `not reachable — ${info.reason}`}`);
    if (info.baseUrl) {
      console.log(`home:   ${remoteLink(info, '/')}`);
      const mine = await loadConfig();
      if (mine?.appName) console.log(`repo:   ${remoteLink(info, `/${mine.appName}/plans/`)}`);
    }
    return;
  }
  if (sub === 'off') {
    const r = cfg.remote || {};
    stopTailscaleRemote(r);
    if (tunnelLoaded()) launchctl('bootout', `${hubDomain()}/${HUB_TUNNEL_LABEL}`);
    if (existsSync(HUB_TUNNEL_PLIST)) await fs.rm(HUB_TUNNEL_PLIST, { force: true });
    cfg.remote = { ...r, enabled: false, disabledAt: new Date().toISOString() };
    await writeHubConfig(cfg);
    console.log('[plans hub remote] off — the hub answers only https://<appName>.localhost again (key kept for a later `remote on`).');
    return;
  }
  if (sub === 'on') {
    const provider = flags.provider || cfg.remote?.provider || 'tailscale';
    if (!['tailscale', 'funnel', 'ngrok', 'cloudflare'].includes(provider)) fail(`unknown provider "${provider}"`);
    const requestedPort = Number(flags['ts-port']) || Number(cfg.remote?.tsPort) || TS_HUB_PORT;
    if ('ts-port' in flags && (!Number.isInteger(Number(flags['ts-port'])) || Number(flags['ts-port']) < 1 || Number(flags['ts-port']) > 65535)) fail('--ts-port must be an integer from 1 to 65535');
    const previous = cfg.remote;
    if (previous?.enabled && ['tailscale', 'funnel'].includes(previous.provider) &&
        (previous.provider !== provider || (Number(previous.tsPort) || TS_HUB_PORT) !== requestedPort)) {
      stopTailscaleRemote(previous);
      // If activation fails, persisted state truthfully records that the old listener is off.
      cfg.remote = { ...previous, enabled: false, disabledAt: new Date().toISOString() };
      await writeHubConfig(cfg);
    }
    const secret = cfg.remote?.secret || randomBytes(24).toString('base64url');
    let baseUrl = null;
    if (provider === 'tailscale' || provider === 'funnel') {
      const bin = tailscaleBin();
      if (!bin) fail('Tailscale is not installed — https://tailscale.com/download (the Mac app is enough; its CLI lives inside the app bundle).');
      const st = tailscaleStatus();
      if (!tailscaleReady(st)) fail(`Tailscale is ${st?.BackendState || 'unavailable'} — open the Tailscale menu bar app, log in (Tailscale › Log in), then rerun. MagicDNS + HTTPS certificates must be enabled for the tailnet (https://login.tailscale.com/admin/dns).`);
      const mode = provider === 'funnel' ? 'funnel' : 'serve';
      const tsPort = Number(flags['ts-port']) || Number(cfg.remote?.tsPort) || TS_HUB_PORT;
      const r = spawnSync(bin, [mode, '--bg', '--yes', `--https=${tsPort}`, `http://127.0.0.1:${port}`], { encoding: 'utf8', timeout: 30000 });
      if (r.status !== 0) fail(`tailscale ${mode} failed: ${String(r.stderr || r.stdout || '').trim()}`);
      baseUrl = `https://${tailscaleDns(st)}${tsPort === 443 ? '' : `:${tsPort}`}`;
      cfg.remote = { ...(cfg.remote || {}), tsPort };
      // A previous ngrok/cloudflare agent is no longer needed.
      if (tunnelLoaded()) launchctl('bootout', `${hubDomain()}/${HUB_TUNNEL_LABEL}`);
      if (existsSync(HUB_TUNNEL_PLIST)) await fs.rm(HUB_TUNNEL_PLIST, { force: true });
    } else if (provider === 'cloudflare' && (flags['tunnel-name'] || cfg.remote?.tunnelName)) {
      // Locally managed named tunnel: a permanent hostname whose ingress lives in
      // our own config file, so nothing has to be clicked in the Zero Trust
      // dashboard. One-time setup is `cloudflared tunnel login`, which writes
      // ~/.cloudflared/cert.pem — that cert is what lets us create the tunnel and
      // its DNS record from here. Unlike a quick tunnel the URL never rotates.
      if (!have('cloudflared')) fail('cloudflared is not installed — brew install cloudflared');
      const name = String(flags['tunnel-name'] || cfg.remote.tunnelName);
      const hostname = (flags.hostname || cfg.remote?.hostname || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (!hostname) fail('--hostname <hub.example.com> is required with --tunnel-name (a name inside a zone on your Cloudflare account).');
      const cert = path.join(os.homedir(), '.cloudflared', 'cert.pem');
      if (!existsSync(cert)) fail(`no Cloudflare origin certificate at ${cert} — run \`cloudflared tunnel login\` once and pick the zone that owns ${hostname}.`);
      const bin = spawnSync('command', ['-v', 'cloudflared'], { shell: true, encoding: 'utf8' }).stdout.trim();
      const deletedTunnel = (t) => !!t.deleted_at && !String(t.deleted_at).startsWith('0001-01-01');   // cloudflared prints the zero time for live tunnels
      const listTunnels = () => {
        const r = spawnSync(bin, ['tunnel', 'list', '--output', 'json'], { encoding: 'utf8', timeout: 30000 });
        try { return JSON.parse(r.stdout || '[]'); } catch { return []; }
      };
      let entry = listTunnels().find(t => t && t.name === name && !deletedTunnel(t));
      if (!entry) {
        const made = spawnSync(bin, ['tunnel', 'create', name], { encoding: 'utf8', timeout: 60000 });
        if (made.status !== 0) fail(`cloudflared tunnel create ${name} failed: ${String(made.stderr || made.stdout || '').trim()}`);
        entry = listTunnels().find(t => t && t.name === name && !deletedTunnel(t));
        if (!entry) fail(`created ${name} but could not read its id back from \`cloudflared tunnel list\`.`);
      }
      const creds = path.join(os.homedir(), '.cloudflared', `${entry.id}.json`);
      if (!existsSync(creds)) fail(`tunnel ${name} (${entry.id}) has no credentials file at ${creds} — it belongs to another machine; copy that file over or pick a different --tunnel-name.`);
      await fs.writeFile(HUB_TUNNEL_CONFIG, `# plans hub named tunnel — written by \`plans hub remote on --provider cloudflare --tunnel-name ${name}\`.
# Locally managed: the ingress rules live here, not in the Zero Trust dashboard.
tunnel: ${entry.id}
credentials-file: ${creds}
protocol: http2          # QUIC (UDP 7844) is blocked on some networks; http2 always connects
no-autoupdate: true
ingress:
  - hostname: ${hostname}
    service: http://127.0.0.1:${port}
  - service: http_status:404
`, { mode: 0o600 });
      const routeArgs = ['tunnel', 'route', 'dns', ...('overwrite-dns' in flags ? ['--overwrite-dns'] : []), name, hostname];
      const route = spawnSync(bin, routeArgs, { encoding: 'utf8', timeout: 60000 });
      if (route.status !== 0) {
        // Tolerate the record already pointing at this tunnel; refuse to clobber anything else.
        const dig = spawnSync('dig', ['+short', hostname, 'CNAME'], { encoding: 'utf8', timeout: 15000 }).stdout.trim();
        if (!dig.startsWith(`${entry.id}.cfargotunnel.com`)) {
          fail(`cloudflared tunnel route dns ${name} ${hostname} failed: ${String(route.stderr || route.stdout || '').trim()}\n${dig ? `${hostname} currently points at ${dig}` : `${hostname} has no CNAME`} — remove that record, or rerun with --overwrite-dns to replace it.`);
        }
      }
      if (tunnelLoaded()) { launchctl('bootout', `${hubDomain()}/${HUB_TUNNEL_LABEL}`); for (let i = 0; i < 40 && tunnelLoaded(); i++) await new Promise(res => setTimeout(res, 250)); }
      await fs.mkdir(path.dirname(HUB_TUNNEL_LOG), { recursive: true });
      await fs.writeFile(HUB_TUNNEL_LOG, '');
      await fs.writeFile(HUB_TUNNEL_PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${HUB_TUNNEL_LABEL}</string>
  <key>ProgramArguments</key><array><string>${escapeHtml(bin)}</string><string>tunnel</string><string>--no-autoupdate</string><string>--config</string><string>${escapeHtml(HUB_TUNNEL_CONFIG)}</string><string>run</string><string>${escapeHtml(name)}</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${escapeHtml(HUB_TUNNEL_LOG)}</string><key>StandardErrorPath</key><string>${escapeHtml(HUB_TUNNEL_LOG)}</string>
</dict></plist>
`, { mode: 0o600 });
      let r = null;
      for (let i = 0; i < 12; i++) { r = launchctl('bootstrap', hubDomain(), HUB_TUNNEL_PLIST); if (r.status === 0) break; await new Promise(res => setTimeout(res, 500)); }
      if (!r || r.status !== 0) fail(`launchctl bootstrap failed: ${(r?.stderr || '').trim()}`);
      // The hostname works the moment a connection registers; wait so the printed link is accurate.
      let registered = false;
      for (let i = 0; i < 60 && !registered; i++) {
        await new Promise(res => setTimeout(res, 500));
        try { registered = /Registered tunnel connection/.test(readFileSync(HUB_TUNNEL_LOG, 'utf8')); } catch {}
      }
      if (!registered) console.error(`[plans hub remote] ${name} started but has not registered a connection yet — see ${HUB_TUNNEL_LOG}; the hostname starts answering as soon as it does.`);
      baseUrl = `https://${hostname}`;
      cfg.remote = { ...(cfg.remote || {}), tunnelName: name, hostname, named: true };
    } else if (provider === 'cloudflare' && (flags['tunnel-token'] || cfg.remote?.tunnelToken)) {
      // Named tunnel (Cloudflare Zero Trust → Networks → Tunnels → cloudflared → token),
      // with a public hostname configured there; optionally behind an Access policy
      // that requires the WARP client. Stable URL, no interstitial.
      if (!have('cloudflared')) fail('cloudflared is not installed — brew install cloudflared');
      const token = flags['tunnel-token'] || cfg.remote.tunnelToken;
      const hostname = (flags.hostname || cfg.remote?.hostname || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (!hostname) fail('--hostname <hub.example.com> is required with --tunnel-token (the public hostname you mapped to http://127.0.0.1:' + port + ' in the tunnel).');
      if (tunnelLoaded()) { launchctl('bootout', `${hubDomain()}/${HUB_TUNNEL_LABEL}`); for (let i = 0; i < 40 && tunnelLoaded(); i++) await new Promise(res => setTimeout(res, 250)); }
      await fs.mkdir(path.dirname(HUB_TUNNEL_LOG), { recursive: true });
      await fs.writeFile(HUB_TUNNEL_LOG, '');
      const bin = spawnSync('command', ['-v', 'cloudflared'], { shell: true, encoding: 'utf8' }).stdout.trim();
      await fs.writeFile(HUB_TUNNEL_PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${HUB_TUNNEL_LABEL}</string>
  <key>ProgramArguments</key><array><string>${escapeHtml(bin)}</string><string>tunnel</string><string>--no-autoupdate</string><string>run</string><string>--token</string><string>${escapeHtml(token)}</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${escapeHtml(HUB_TUNNEL_LOG)}</string><key>StandardErrorPath</key><string>${escapeHtml(HUB_TUNNEL_LOG)}</string>
</dict></plist>
`, { mode: 0o600 });
      let r = null;
      for (let i = 0; i < 12; i++) { r = launchctl('bootstrap', hubDomain(), HUB_TUNNEL_PLIST); if (r.status === 0) break; await new Promise(res => setTimeout(res, 500)); }
      if (!r || r.status !== 0) fail(`launchctl bootstrap failed: ${(r?.stderr || '').trim()}`);
      baseUrl = `https://${hostname}`;
      cfg.remote = { ...(cfg.remote || {}), tunnelToken: token, hostname, named: true };
    } else if (TUNNEL_PROVIDERS[provider]) {
      const spec = TUNNEL_PROVIDERS[provider];
      if (!have(spec.bin)) fail(`${spec.bin} is not installed — brew install ${spec.bin}`);
      if (process.platform !== 'darwin') fail(`the ${spec.bin} agent is launchd-only here; run \`${spec.bin} ${spec.args(port).join(' ')}\` under your own supervisor.`);
      if (tunnelLoaded()) {
        launchctl('bootout', `${hubDomain()}/${HUB_TUNNEL_LABEL}`);
        // launchd tears the job down asynchronously; bootstrapping the same
        // label too early fails with "Bootstrap failed: 5: Input/output error".
        for (let i = 0; i < 40 && tunnelLoaded(); i++) await new Promise(res => setTimeout(res, 250));
      }
      await fs.mkdir(path.dirname(HUB_TUNNEL_LOG), { recursive: true });
      await fs.writeFile(HUB_TUNNEL_LOG, '');
      await fs.writeFile(HUB_TUNNEL_PLIST, tunnelPlist(provider, port));
      let r = null;
      for (let i = 0; i < 12; i++) {
        r = launchctl('bootstrap', hubDomain(), HUB_TUNNEL_PLIST);
        if (r.status === 0) break;
        await new Promise(res => setTimeout(res, 500));
      }
      if (!r || r.status !== 0) fail(`launchctl bootstrap failed: ${(r?.stderr || '').trim()}`);
      for (let i = 0; i < 60 && !baseUrl; i++) { await new Promise(res => setTimeout(res, 500)); baseUrl = tunnelUrlFromLog(provider); }
      if (!baseUrl) fail(`tunnel started but printed no URL yet — see ${HUB_TUNNEL_LOG}; \`plans hub remote status\` picks it up once it appears (a network filter such as Little Snitch may be holding ${spec.bin}).`);
    } else fail(`unknown provider "${provider}" (tailscale | funnel | ngrok | cloudflare)`);
    cfg.remote = { ...(cfg.remote || {}), enabled: true, provider, baseUrl, secret, enabledAt: new Date().toISOString() };
    await writeHubConfig(cfg);
    const info = await remoteInfo({ refresh: false });
    console.log(`[plans hub remote] on via ${provider} (${provider === 'tailscale' ? 'tailnet-only: your phone needs the Tailscale app connected' : provider === 'funnel' ? 'public via Tailscale Funnel' : cfg.remote?.named ? 'named Cloudflare tunnel; gate it with an Access policy if you want WARP-only' : TUNNEL_PROVIDERS[provider].note})`);
    console.log(`home: ${remoteLink(info, '/')}`);
    console.log('The hub picked the new config up already (mtime cache). Text yourself the link: bun run plans notify --test');
    return;
  }
  console.error('Usage: plans hub remote [status|on|off] [--provider tailscale|funnel|ngrok|cloudflare] [--ts-port N]');
  console.error('       named Cloudflare tunnel (permanent hostname): --provider cloudflare --tunnel-name plans-hub --hostname hub.example.com [--overwrite-dns]');
  console.error('       remotely managed token tunnel:                --provider cloudflare --tunnel-token T --hostname hub.example.com');
  process.exit(1);
}
async function notifyConfig() { const cfg = await hubConfig(); return cfg.notify && typeof cfg.notify === 'object' ? cfg.notify : { channel: 'off' }; }
// Phone-sized PNG of the plan page for the text (pattern from the GoFi Alfred
// workflow: text first, then the artwork). Headless Chromium, bounded, never
// fatal — no browser or PLANS_NO_PREVIEW=1 just means a text-only message.
function previewBrowser() {
  return [process.env.PLANS_PREVIEW_BROWSER, process.env.VISUAL_HISTORY_BROWSER, '/opt/homebrew/bin/chromium',
    '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].filter(Boolean).find(b => existsSync(b)) || null;
}
async function renderPreview(app, key, file) {
  if (process.env.PLANS_NO_PREVIEW || !file || !existsSync(file)) return null;
  const bin = previewBrowser();
  if (!bin) return null;
  const dir = path.join(HUB_PREVIEW_DIR, app);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const out = path.join(dir, `${key}.png`);
  await fs.rm(out, { force: true });
  // Fresh profile per shot: a shared profile keeps a stale SingletonLock after any
  // killed run and every later Chromium exits 21 without writing the PNG.
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'plans-hub-preview-'));
  // Do not wait for Chromium to exit: headless --screenshot in some builds writes the
  // PNG and then never quits. Poll for the file, let its size settle, then kill.
  const proc = spawn(bin, ['--headless=new', '--timeout=8000', '--virtual-time-budget=2000', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--window-size=430,932', '--force-device-scale-factor=2', `--screenshot=${out}`, pathToFileURL(file).href],
    { stdio: 'ignore' });
  const started = Date.now();
  let last = -1, stable = 0;
  while (Date.now() - started < 20000 && proc.exitCode === null) {
    await new Promise(res => setTimeout(res, 150));
    let size = -1;
    try { size = statSync(out).size; } catch {}
    if (size > 0 && size === last) { if (++stable >= 2) break; } else { stable = 0; last = size; }
  }
  if (proc.exitCode === null) { try { proc.kill(); } catch {} setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 2000).unref(); }
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  return existsSync(out) ? out : null;
}
// Fire-and-forget delivery. Never throws: a failed text must not stop `wait`.
// imessage transports: osascript (default — Messages.app, text then optional
// attachment) or imsg (https://github.com/steipete/imsg: `imsg send --file`,
// JSON ack; its post-send chat.db check can miss rows stored as attributedBody
// and report "may_have_completed" although the message went out).
// iMessage renders a link card (og:title/description/image, served by the hub
// for every remote page) only for a message that is nothing but the URL, so
// links go out as their own messages after the text: summary, then each link,
// then the optional PNG attachment. Messages.app drops back-to-back sends
// without a short pause, hence the `delay 1` between them.
function sendNotification(n, message, { file = null, links = [] } = {}) {
  if (process.env.PLANS_NO_NOTIFY) return { sent: false, reason: 'PLANS_NO_NOTIFY is set' };
  if (!n || !n.channel || n.channel === 'off') return { sent: false, reason: 'notify is off (bun run plans hub notify set --channel imessage --to <handle>)' };
  const urls = links.map(l => l.url).filter(Boolean);
  if (n.channel === 'imessage') {
    if (!n.to) return { sent: false, reason: 'notify.to is missing' };
    if (n.transport === 'imsg' && have('imsg')) {
      const one = (textArg, fileArg) => {
        const args = ['send', '--to', n.to, '--service', 'imessage', '--json'];
        if (textArg) args.push('--text', textArg);
        if (fileArg) args.push('--file', fileArg);
        const r = spawnSync('imsg', args, { encoding: 'utf8', timeout: 60000 });
        let ok = false;
        try { ok = !!JSON.parse(r.stdout || '{}').success; } catch {}
        return ok || /may_have_completed/.test(`${r.stdout}\n${r.stderr}`) ? null : ((r.stderr || r.stdout || '').trim() || `imsg exit ${r.status}`);
      };
      const errors = [one(message, null), ...urls.map(u => one(u, null)), ...(file ? [one(null, file)] : [])].filter(Boolean);
      return errors.length ? { sent: false, reason: errors[0] } : { sent: true, transport: 'imsg' };
    }
    const script = `on run argv
  set theTo to item 1 of argv
  set theFile to item 2 of argv
  tell application "Messages"
    set theService to 1st account whose service type = iMessage
    set theBuddy to participant theTo of theService
    repeat with i from 3 to (count of argv)
      send (item i of argv) to theBuddy
      delay 1
    end repeat
    if theFile is not "" then
      set theAttachment to POSIX file theFile as alias
      send theAttachment to theBuddy
    end if
  end tell
end run`;
    const r = spawnSync('osascript', ['-e', script, n.to, file || '', message, ...urls], { encoding: 'utf8', timeout: 40000 });
    return r.status === 0 ? { sent: true, transport: 'osascript' } : { sent: false, reason: (r.stderr || '').trim() || `osascript exit ${r.status}` };
  }
  if (n.channel === 'command') {
    if (!n.command) return { sent: false, reason: 'notify.command is missing' };
    const full = [message, ...urls].join('\n');
    const r = spawnSync('sh', ['-c', n.command], { input: full, encoding: 'utf8', timeout: 30000, env: { ...process.env, PLANS_NOTIFY_TEXT: full, PLANS_NOTIFY_FILE: file || '', PLANS_NOTIFY_LINKS: urls.join('\n') } });
    return r.status === 0 ? { sent: true, transport: 'command' } : { sent: false, reason: (r.stderr || '').trim() || `exit ${r.status}` };
  }
  return { sent: false, reason: `unknown channel "${n.channel}"` };
}
async function previewFor(n, item) {
  if (!n || n.preview !== true || !n.channel || n.channel === 'off' || !item) return null;
  try { return await renderPreview(item.app, `${item.slug}-${String(item.seq).padStart(3, '0')}`, item.file); } catch { return null; }
}
async function waitingMarkers() {
  const out = [];
  let appsDirs = [];
  try { appsDirs = await fs.readdir(HUB_WAITING_DIR); } catch { return out; }
  for (const app of appsDirs) {
    let files = [];
    try { files = await fs.readdir(path.join(HUB_WAITING_DIR, app)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const m = await readJsonOr(path.join(HUB_WAITING_DIR, app, f), null);
      if (!m) continue;
      // Stale marker: its `wait` process is gone → treat as not waiting.
      if (m.pid && !processIsAlive(m.pid)) { await fs.rm(path.join(HUB_WAITING_DIR, app, f), { force: true }); continue; }
      out.push({ ...m, app });
    }
  }
  return out.sort((a, b) => Date.parse(b.startedAt || 0) - Date.parse(a.startedAt || 0));
}
function shortTitle(t) { return String(t || '').replace(/\s+/g, ' ').trim().slice(0, 80); }
// { text, links } — the text is one message; each link is sent as its own
// message so it unfurls into the hub's per-page Open Graph card.
async function waitingMessage(items, { test = false } = {}) {
  const info = await remoteInfo();
  const link = (p) => info.live ? remoteLink(info, p) : null;
  const lines = [];
  const links = [];
  if (test) lines.push('Plans hub test — this is how Claude will reach you.');
  else if (items.length === 1) lines.push(`Claude is waiting on #${String(items[0].seq).padStart(3, '0')} ${shortTitle(items[0].title)} (${items[0].app}).`);
  else if (items.length > 1) lines.push(`Claude is waiting on ${items.length} plans: ${items.map(i => `#${String(i.seq).padStart(3, '0')} ${shortTitle(i.title)} (${i.app})`).join('; ')}.`);
  else lines.push('No plan is waiting on you right now.');
  for (const it of items.slice(0, 5)) {
    const p = `/${it.app}/plans/${path.basename(it.file)}`;
    links.push({ label: `#${String(it.seq).padStart(3, '0')} ${shortTitle(it.title)}`, url: link(p) || `https://${it.app}.localhost/plans/${path.basename(it.file)}` });
  }
  if (items.length !== 1 || test) links.push({ label: 'All plans', url: link('/') || null });
  if (!info.live) lines.push(info.enabled ? `Remote is not reachable right now: ${info.reason}.` : 'Remote access is off — links work on the LAN only.');
  return { text: lines.join('\n'), links: links.filter(l => l.url) };
}
async function hubNotify(argv) {
  const { flags, rest } = parseFlags(argv);
  const sub = rest[0] || 'status';
  const cfg = await hubConfig();
  if (sub === 'status') {
    const n = await notifyConfig();
    console.log(`notify: ${n.channel && n.channel !== 'off' ? `${n.channel}${n.to ? ` -> ${n.to}` : ''}${n.command ? ` (${n.command})` : ''}${n.channel === 'imessage' ? ` · transport ${n.transport === 'imsg' ? 'imsg' : 'osascript'}` : ''} · link cards on · PNG attachment ${n.preview === true ? (previewBrowser() ? 'on' : 'on (no Chromium found)') : 'off'}` : 'off'}`);
    return;
  }
  if (sub === 'set') {
    const channel = flags.channel || cfg.notify?.channel || 'imessage';
    if (!['imessage', 'command', 'off'].includes(channel)) { console.error('channel must be imessage | command | off'); process.exit(1); }
    const next = { ...(cfg.notify || {}), channel };
    if ('to' in flags) next.to = flags.to;
    if ('command' in flags) next.command = flags.command;
    if ('transport' in flags) { if (!['osascript', 'imsg'].includes(flags.transport)) { console.error('transport must be osascript | imsg'); process.exit(1); } next.transport = flags.transport; }
    if ('preview' in flags) next.preview = flags.preview !== 'off';
    if (channel === 'imessage' && !next.to) { console.error('imessage needs --to <phone or Apple ID email that iMessages you>'); process.exit(1); }
    if (channel === 'command' && !next.command) { console.error('command needs --command "<shell>" (message on stdin and in $PLANS_NOTIFY_TEXT)'); process.exit(1); }
    cfg.notify = next;
    await writeHubConfig(cfg);
    console.log(`[plans hub notify] ${channel}${next.to ? ` -> ${next.to}` : ''}${next.command ? ` (${next.command})` : ''}. Try it: bun run plans notify --test`);
    return;
  }
  if (sub === 'test') return cmdNotify(['--test']);
  console.error('Usage: plans hub notify [status | set --channel imessage|command|off [--to <handle>] [--transport osascript|imsg] [--preview on|off] [--command "…"] | test]');
  process.exit(1);
}
async function cmdNotify(argv) {
  const { flags } = parseFlags(argv);
  const items = 'test' in flags ? [] : await waitingMarkers();
  const message = await waitingMessage(items, { test: 'test' in flags });
  const n = await notifyConfig();
  const r = sendNotification(n, message.text, { file: items.length === 1 ? await previewFor(n, items[0]) : null, links: message.links });
  if (r.sent) console.log(`[plans notify] sent (${items.length} waiting, ${message.links.length} link${message.links.length === 1 ? '' : 's'})`);
  else { console.error(`[plans notify] not sent — ${r.reason}`); console.error(message.text); for (const l of message.links) console.error(l.url); process.exit(1); }
}
// Called by `plans wait`: writes/refreshes the marker and texts once per plan
// per NOTIFY_DEDUPE_MS (a restarted wait for the same plan stays quiet).
// iMessage fetches the page the instant the text lands, and a cold Open Graph
// card takes a few seconds to render — long enough for the preview to come back
// bare. Ask the local hub for each link first so the card is already on disk.
async function warmPreviewCards(links) {
  const cfg = await hubConfig();
  const secret = cfg.remote?.secret;
  if (!secret || !links?.length) return;
  const port = await hubPort();
  for (const l of links.slice(0, 6)) {
    let route = null;
    try { route = new URL(l.url).pathname; } catch { continue; }
    const url = `http://127.0.0.1:${port}${route}?key=${encodeURIComponent(secret)}`;
    try { const r = await fetch(url, { signal: AbortSignal.timeout(45000) }); await r.arrayBuffer(); } catch {}
  }
}
async function announceWaiting(cfg, plan, { started, notify }) {
  const key = `${plan.slug}-${String(plan.seq).padStart(3, '0')}`;
  const dir = path.join(HUB_WAITING_DIR, cfg.appName);
  const marker = path.join(dir, `${key}.json`);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const prev = await readJsonOr(marker, null);
  const entry = { app: cfg.appName, slug: plan.slug, seq: plan.seq, title: plan.title, file: plan.file, startedAt: new Date(started).toISOString(), pid: process.pid, notifiedAt: prev?.notifiedAt || null };
  await writeJsonAtomic(marker, entry);
  const recently = entry.notifiedAt && (Date.now() - Date.parse(entry.notifiedAt)) < NOTIFY_DEDUPE_MS;
  if (notify && !recently) {
    const n = await notifyConfig();
    const message = await waitingMessage([entry]);
    const preview = await previewFor(n, entry);
    await warmPreviewCards(message.links);
    const r = sendNotification(n, message.text, { file: preview, links: message.links });
    if (r.sent) { entry.notifiedAt = new Date().toISOString(); await writeJsonAtomic(marker, entry); console.error(`[plans wait] texted you the link`); }
    else console.error(`[plans wait] no text sent — ${r.reason}`);
  }
  return marker;
}


/* ---------------- lifecycle: done · status · inbox import (v19) ---------------- */
function planKey(slug, seq) { return `${slug}-${String(seq).padStart(3, '0')}`; }
function pageSuffix(slug, seq) { return `-${String(seq).padStart(3, '0')}-${slug}.html`; }
async function resolvePlan(slugArg, seqFlag) {
  const slug = (slugArg || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return null;
  const plans = (await listPlans()).filter(p => p.name.endsWith(`-${slug}.html`) && p.seq != null);
  let seq = Number(seqFlag);
  if (!Number.isInteger(seq) || seq < 1) { if (!plans.length) return null; seq = Math.max(...plans.map(p => p.seq)); }
  const plan = plans.find(p => p.seq === seq) || null;
  return { slug, seq, plan };
}
function submissionHash(inbox) { return createHash('sha256').update(JSON.stringify(inbox)).digest('hex'); }
function sameSubmission(done, inbox) {
  return !!(done && inbox && typeof inbox.receivedAt === 'string' && done.submittedAt === inbox.receivedAt &&
    (!done.submissionHash || done.submissionHash === submissionHash(inbox)));
}
function fullyImplemented(done, inbox) {
  return sameSubmission(done, inbox) && Array.isArray(done.items) && Array.isArray(inbox.decisions) &&
    inbox.decisions.every(d => d.status !== 'pending' && (d.status !== 'approved' || done.items.includes(d.id)));
}
function validateImport(value) {
  if (!value || value.version !== 2 || value.kind !== 'plan-decisions' ||
      typeof value.plan?.slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(value.plan.slug) ||
      !Number.isSafeInteger(value.plan.seq) || value.plan.seq < 1 ||
      (value.plan.repo != null && typeof value.plan.repo !== 'string') ||
      (value.submittedAt != null && (typeof value.submittedAt !== 'string' || !Number.isFinite(Date.parse(value.submittedAt)))) ||
      !Array.isArray(value.decisions) || value.decisions.length > 500) return false;
  const ids = new Set();
  for (const item of value.decisions) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
        !['approved', 'rejected', 'pending'].includes(item.status) ||
        !['group', 'kind', 'title', 'current', 'suggested'].every(k => typeof item[k] === 'string') ||
        typeof item.edited !== 'boolean') return false;
    ids.add(item.id);
  }
  return true;
}
async function cmdDone(argv) {
  const { flags, rest } = parseFlags(argv);
  const cfg = await ensureConfig();
  const r = await resolvePlan(rest[0], flags.seq);
  if (!r) { console.error('Usage: plans done <slug> [--seq N] [--items d01,d03] [--note "…"] [--commit sha,…]'); process.exit(1); }
  const key = planKey(r.slug, r.seq);
  const inboxFile = path.join(HUB_INBOX_DIR, cfg.appName, `${key}.json`);
  const inbox = await readJsonOr(inboxFile, null);
  if (!inbox && !('force' in flags)) { console.error(`[plans done] no submission in the hub inbox for ${key} (${inboxFile}). Wait for the reader to submit, import a legacy file (plans inbox import), or pass --force.`); process.exit(1); }
  const approved = Array.isArray(inbox?.decisions) ? inbox.decisions.filter(d => d.status === 'approved').map(d => d.id) : [];
  let items = 'items' in flags ? flags.items.split(',').map(x => x.trim()).filter(Boolean) : approved;
  if (inbox && items.some(id => !approved.includes(id))) throw new Error('Only approved decision IDs from the current submission can be marked done.');
  const commits = flags.commit ? flags.commit.split(',').map(x => x.trim()).filter(Boolean) : [];
  let head = null;
  try { head = spawnSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim() || null; } catch {}
  const dir = path.join(HUB_DONE_DIR, cfg.appName);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const out = path.join(dir, `${key}.json`);
  const prev = await readJsonOr(out, null);
  const matching = sameSubmission(prev, inbox) ? prev : null;
  items = [...new Set([...(matching?.items || []).filter(id => approved.includes(id)), ...items])];
  const entry = { app: cfg.appName, slug: r.slug, seq: r.seq, title: r.plan?.title || r.slug, file: r.plan?.path || null, doneAt: new Date().toISOString(),
    items, skipped: approved.filter(id => !items.includes(id)), note: flags.note || matching?.note || '', commits: [...new Set([...(matching?.commits || []), ...commits])], head, inbox: inbox ? inboxFile : null, submittedAt: inbox?.receivedAt || null, submissionHash: inbox ? submissionHash(inbox) : null };
  await writeJsonAtomic(out, entry);
  console.log(out);
  console.error(`[plans done] ${cfg.appName} · ${key} — ${items.length} item${items.length === 1 ? '' : 's'} recorded as implemented${entry.skipped.length ? ` (${entry.skipped.length} approved item${entry.skipped.length === 1 ? '' : 's'} not listed: ${entry.skipped.join(', ')})` : ''}`);
}
// Commits after the submission that mention the plan (#NNN, slug) or an
// approved item id — a hint, not proof; `plans done` is the record.
function gitHint(root, since, seq, slug, ids) {
  try {
    const r = spawnSync('git', ['-C', root, 'log', `--since=${since}`, '--format=%h %ad %s', '--date=short'], { encoding: 'utf8', timeout: 8000 });
    if (r.status !== 0) return null;
    const lines = r.stdout.trim().split('\n').filter(Boolean);
    const re = new RegExp(`#${String(seq).padStart(3, '0')}\\b|\\b${slug}\\b${ids.length ? `|\\b(?:${ids.join('|')})\\b` : ''}`, 'i');
    return { after: lines.length, mentions: lines.filter(l => re.test(l)).slice(0, 5) };
  } catch { return null; }
}
async function lifecycle(app, root) {
  const dir = path.join(root, 'docs', 'plans');
  let names = [];
  try { names = (await fs.readdir(dir)).filter(n => /^\d{4}-\d{2}-\d{2}-\d{3}-.+\.html$/.test(n)).sort(); } catch { return []; }
  const out = [];
  for (const n of names) {
    const [, date, seqStr, slug] = n.match(/^(\d{4}-\d{2}-\d{2})-(\d{3})-(.+)\.html$/);
    const seq = Number(seqStr);
    const key = planKey(slug, seq);
    let title = n;
    try { const t = (await fs.readFile(path.join(dir, n), 'utf8')).slice(0, 4000).match(/<title>([^<]+)<\/title>/i); if (t) title = decodeHtmlText(t[1].trim()).replace(/^#\d{3}\s+/, ''); } catch {}
    const waiting = await readJsonOr(path.join(HUB_WAITING_DIR, app, `${key}.json`), null);
    const inbox = await readJsonOr(path.join(HUB_INBOX_DIR, app, `${key}.json`), null);
    const done = await readJsonOr(path.join(HUB_DONE_DIR, app, `${key}.json`), null);
    const counts = Array.isArray(inbox?.decisions) ? inbox.decisions.reduce((c, d) => { c[d.status] = (c[d.status] || 0) + 1; return c; }, { approved: 0, rejected: 0, pending: 0 }) : null;
    const approvedIds = Array.isArray(inbox?.decisions) ? inbox.decisions.filter(d => d.status === 'approved').map(d => d.id) : [];
    let status = 'stamped';
    if (waiting && waiting.pid && processIsAlive(waiting.pid) && (!inbox || Date.parse(inbox.receivedAt) < Date.parse(waiting.startedAt))) status = 'waiting';
    else if (fullyImplemented(done, inbox)) status = 'implemented';
    else if (inbox) status = 'submitted';
    const hint = gitHint(root, inbox?.receivedAt || date, seq, slug, approvedIds);
    out.push({ app, root, file: n, seq, slug, title, date, status, submittedAt: inbox?.receivedAt || null, via: inbox?.via || null, counts, implementedAt: status === 'implemented' ? done.doneAt : null, doneItems: sameSubmission(done, inbox) ? done.items?.length ?? 0 : null, doneNote: done?.note || '', commits: done?.commits || [], git: hint });
  }
  return out;
}
async function cmdStatus(argv) {
  const { flags } = parseFlags(argv);
  const targets = [];
  if ('all' in flags) {
    const reg = await readJsonOr(HUB_REGISTRY_PATH, { version: 1, apps: {} });
    for (const [app, e] of Object.entries(reg.apps || {})) if (e && typeof e.root === 'string' && existsSync(e.root)) targets.push([app, e.root]);
  } else {
    const cfg = await ensureConfig();
    targets.push([cfg.appName, ROOT]);
  }
  const rows = [];
  for (const [app, root] of targets) rows.push(...await lifecycle(app, root));
  if ('json' in flags) { console.log(JSON.stringify(rows, null, 2)); return; }
  if (!rows.length) { console.log('No plan pages found.'); return; }
  const icon = { waiting: '⏳', submitted: '📨', implemented: '✅', stamped: '·' };
  let lastApp = null;
  for (const r of rows) {
    if (r.app !== lastApp) { console.log(`\n${r.app}  (${r.root})`); lastApp = r.app; }
    const sub = r.submittedAt ? `submitted ${r.submittedAt.slice(0, 10)}${r.via === 'import' ? ' (imported)' : ''} · ${r.counts?.approved || 0} ✓ ${r.counts?.rejected || 0} ✗${r.counts?.pending ? ` ${r.counts.pending} ○` : ''}` : 'not submitted';
    const impl = r.implementedAt ? `implemented ${r.implementedAt.slice(0, 10)} (${r.doneItems} items${r.commits.length ? `, ${r.commits.length} commits` : ''})${r.doneNote ? ` — ${r.doneNote}` : ''}` : r.submittedAt ? `NOT implemented (${r.doneItems || 0} approved items recorded for this submission)` : '';
    const git = r.git ? `${r.git.after} commits since${r.git.mentions.length ? `, ${r.git.mentions.length} mention it` : ''}` : 'no git';
    console.log(`  ${icon[r.status]} #${String(r.seq).padStart(3, '0')} ${r.title}  [${r.date}]`);
    console.log(`       ${sub}${impl ? ` · ${impl}` : ''} · git: ${git}`);
    for (const m of r.git?.mentions || []) console.log(`         ↳ ${m.slice(0, 100)}`);
  }
  const n = (s) => rows.filter(r => r.status === s).length;
  console.log(`\n${rows.length} plans · ${n('waiting')} waiting · ${n('submitted')} submitted-not-implemented · ${n('implemented')} implemented · ${n('stamped')} never submitted`);
}
async function cmdInbox(argv) {
  const { flags, rest } = parseFlags(argv);
  if (rest[0] !== 'import') { console.error('Usage: plans inbox import [file…]   (default: ~/Downloads/*-decisions.json)'); process.exit(1); }
  let files = rest.slice(1);
  if (!files.length) {
    const dl = path.join(os.homedir(), 'Downloads');
    try { files = (await fs.readdir(dl)).filter(n => n.endsWith('-decisions.json')).map(n => path.join(dl, n)); } catch {}
  }
  const reg = await readJsonOr(HUB_REGISTRY_PATH, { version: 1, apps: {} });
  let imported = 0;
  for (const file of files) {
    let d = null;
    try { if ((await fs.stat(file)).size <= 1_000_000) d = await readJsonOr(file, null); } catch {}
    if (!validateImport(d)) { console.log(`skip  ${path.basename(file)} — not a v2 plan-decisions payload`); continue; }
    const key = planKey(d.plan.slug, d.plan.seq);
    // Never guess between repositories with the same slug/sequence or basename.
    const candidates = [];
    for (const [app, e] of Object.entries(reg.apps || {})) {
      if (!e?.root || (d.plan.repo && d.plan.repo !== app && d.plan.repo !== path.basename(e.root))) continue;
      try { if ((await fs.readdir(path.join(e.root, 'docs', 'plans'))).some(n => n.endsWith(pageSuffix(d.plan.slug, d.plan.seq)))) candidates.push([app, e.root]); } catch {}
    }
    if (candidates.length > 1) { console.log(`skip  ${path.basename(file)} — ambiguous repository; use its unique appName in plan.repo`); continue; }
    const hit = candidates[0];
    if (!hit) {
      const guess = ['github', 'myscripts'].map(d2 => path.join(os.homedir(), d2, d.plan.repo || '')).find(p2 => d.plan.repo && existsSync(path.join(p2, 'docs', 'plans')));
      console.log(`skip  ${path.basename(file)} — repo "${d.plan.repo}" is not registered with the hub${guess ? ` (found ${guess}: run \`bun run plans hub register\` there, then re-run)` : ''}`);
      continue;
    }
    const [app, root] = hit;
    let names = [];
    try { names = await fs.readdir(path.join(root, 'docs', 'plans')); } catch {}
    const page = names.find(n => n.endsWith(pageSuffix(d.plan.slug, d.plan.seq)));
    if (!page) { console.log(`skip  ${path.basename(file)} — ${app} has no page for ${key}`); continue; }
    const dir = path.join(HUB_INBOX_DIR, app);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const out = path.join(dir, `${key}.json`);
    if (existsSync(out) && !('force' in flags)) { console.log(`keep  ${app}/${key} — inbox already has a submission (--force to replace)`); continue; }
    await writeJsonAtomic(out, { ...d, receivedAt: d.submittedAt || new Date((await fs.stat(file)).mtimeMs).toISOString(), app, page: path.join(root, 'docs', 'plans', page), via: 'import', importedFrom: file, importedAt: new Date().toISOString() });
    try { await fs.chmod(out, 0o600); } catch {}
    imported++;
    console.log(`ok    ${app}/${key} ← ${path.basename(file)} (submitted ${(d.submittedAt || '').slice(0, 10)})`);
  }
  console.log(`${imported} imported`);
}

async function cmdWait(argv) {
  const { flags, rest } = parseFlags(argv);
  const slug = (rest[0] || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) { console.error('Usage: plans wait <slug> [--seq N] [--timeout seconds] [--any] [--no-notify]'); process.exit(1); }
  const cfg = await ensureConfig();
  const plans = (await listPlans()).filter(p => p.name.endsWith(`-${slug}.html`) && p.seq != null);
  let seq = Number(flags.seq);
  if (!Number.isInteger(seq) || seq < 1) {
    if (!plans.length) { console.error(`No plan page for slug "${slug}" in ${PLANS_DIR}`); process.exit(1); }
    seq = Math.max(...plans.map(p => p.seq));
  }
  const plan = plans.find(p => p.seq === seq) || { title: slug, path: path.join(PLANS_DIR, `${slug}.html`) };
  const dir = path.join(HUB_INBOX_DIR, cfg.appName);
  const target = path.join(dir, `${slug}-${String(seq).padStart(3, '0')}.json`);
  const started = Date.now();
  const timeoutMs = Number(flags.timeout) > 0 ? Number(flags.timeout) * 1000 : 0;
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  async function ready() {
    try {
      const st = await fs.stat(target);
      return 'any' in flags || st.mtimeMs >= started - 1000;
    } catch { return false; }
  }
  if (await ready()) { console.log(target); return; }
  console.error(`[plans wait] ${cfg.appName} · ${slug} #${seq} — waiting for a submission at https://${cfg.appName}.localhost/plans/`);
  // v19: marker for the remote landing page + a text with the link.
  const marker = await announceWaiting(cfg, { slug, seq, title: plan.title, file: plan.path }, { started, notify: !('no-notify' in flags) });
  const clear = () => { try { rmSync(marker, { force: true }); } catch {} };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { clear(); process.exit(130); });
  await new Promise((resolve, reject) => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearInterval(poll); clearTimeout(deadline); try { watcher?.close(); } catch {} resolve(); };
    const check = () => ready().then(ok => { if (ok) finish(); }).catch(() => {});
    let watcher = null;
    try { watcher = fsWatch(dir, check); } catch {}
    const poll = setInterval(check, 2000);
    const deadline = timeoutMs ? setTimeout(() => { if (!done) { done = true; clearInterval(poll); try { watcher?.close(); } catch {} reject(new Error('timed out')); } }, timeoutMs) : null;
  }).catch(() => { clear(); console.error('[plans wait] timed out'); process.exit(2); });
  clear();
  console.log(target);
}

/* ---------------- open ---------------- */
function have(bin) {
  return spawnSync('command', ['-v', bin], { shell: true, stdio: 'ignore' }).status === 0;
}

async function openInBrowser(file) {
  let url = pathToFileURL(file).href;
  if (!process.env.PLANS_OPEN_FILE) {
    try {
      const cfg = await loadConfig();
      const hubUrl = cfg?.appName ? hubUrlFor(file, cfg.appName) : null;
      if (hubUrl && await hubHealth() && await hubRoutes(cfg.appName)) url = hubUrl;
    } catch {}
  }
  const custom = process.env.Z_AGENT_BROWSER;
  let cmd, args;
  if (custom) { cmd = custom; args = ['open', url]; }
  else if (process.platform === 'darwin') { cmd = 'open'; args = [url]; }
  else if (process.platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', url]; }
  else { cmd = 'xdg-open'; args = [url]; }
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', err => {
    console.error(`Could not open with "${cmd}": ${err.message}`);
    console.error(`Open it manually:\n  ${url}`);
  });
  child.unref();
  console.log(`Opening ${path.basename(file)}${url.startsWith('https://') ? ` at ${url}` : ''}`);
}

function fzfPick(plans) {
  const input = plans.map(p => `${label(p)}\t${p.path}`).join('\n');
  const res = spawnSync(
    'fzf',
    ['--with-nth=1', '--delimiter=\t', '--prompt=open> ', '--height=40%', '--reverse',
     '--header=Select a plan or app to open (docs/plans/ · apps/)'],
    { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] }
  );
  if (res.status !== 0 || !res.stdout.trim()) return null;
  return res.stdout.trim().split('\t')[1];
}

function label(p) {
  if (p.kind === 'app') return `[app] ${p.name}`;
  const seq = p.seq != null ? `#${String(p.seq).padStart(3, '0')} ` : '      ';
  return `${seq}${p.name}`;
}

function numberedPick(plans) {
  return new Promise(resolve => {
    console.log('\nPlans & apps in docs/plans/ (and apps/):\n');
    plans.forEach((p, i) => {
      const when = new Date(p.mtime).toISOString().slice(0, 10);
      const l = label(p);
      console.log(`  ${String(i + 1).padStart(2)}. ${l}${' '.repeat(Math.max(1, 58 - l.length))}${when}`);
    });
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\nOpen # (Enter = 1, q = quit): ', ans => {
      rl.close();
      const t = ans.trim().toLowerCase();
      if (t === 'q') return resolve(null);
      const idx = t === '' ? 0 : Number(t) - 1;
      resolve(plans[idx]?.path ?? null);
    });
  });
}

/* ---------------- new ---------------- */
function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      // A following `--flag` is the next flag, not this one's value (so
      // `--all --json` works); everything else is the value.
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[argv[i].slice(2)] = next; i++; }
      else flags[argv[i].slice(2)] = '';
    } else rest.push(argv[i]);
  }
  return { flags, rest };
}

async function cmdNew(argv) {
  const { flags, rest } = parseFlags(argv);
  const slug = (rest[0] || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) {
    console.error('Usage: plans new <slug> [--title "Title"] [--source "session/prompt provenance"]');
    process.exit(1);
  }
  let template;
  try {
    template = await fs.readFile(TEMPLATE_PATH, 'utf8');
  } catch {
    console.error(`Missing ${TEMPLATE_PATH} — rerun a Claude session (the SessionStart hook scaffolds it), copy it from ~/.claude/templates/plans/.plan-template.html, or run: node ~/.claude/templates/plans/manage-plans.mjs status "$PWD"`);
    process.exit(1);
  }
  const date = new Date().toISOString().slice(0, 10);
  const title = flags.title || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const source = flags.source || 'unspecified';
  const repo = path.basename(ROOT);
  // Sequence lock: two concurrent `new` (two sessions in one repo) must never
  // stamp the same #NNN. The seq is also reconciled against pages on disk so a
  // stale nextSeq (merge, restored config) cannot collide with an existing page.
  if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(slug)) {
    console.error('slug must be lowercase letters, digits, and hyphens (max 80 chars)');
    process.exit(1);
  }
  const releaseLock = await acquireSequenceLock();
  let dest;
  try {
    const cfg = await ensureConfig();
    const existing = await listPlans();
    const seq = Math.max(
      Number(cfg.nextSeq) || 1,
      ...existing.map(plan => (plan.seq ?? 0) + 1),
    );
    // v17: the page talks to the always-on hub through portless. The per-repo
    // loopback `port` stays in the config for pages stamped before v17.
    const endpoint = `https://${cfg.appName}.localhost`;
    const submissionToken = randomBytes(24).toString('base64url');
    const page = replaceLiterals(template, {
      __PLAN_SEQ_PAD__: String(seq).padStart(3, '0'),
      __PLAN_SEQ__: String(seq),
      __PLAN_TITLE_HTML__: escapeHtml(title),
      __PLAN_DATE_HTML__: escapeHtml(date),
      __PLAN_REPO_HTML__: escapeHtml(repo),
      __PLAN_SOURCE_HTML__: escapeHtml(source),
      __PLAN_SLUG_JSON__: jsLiteral(slug),
      __PLAN_TITLE_JSON__: jsLiteral(title),
      __PLAN_DATE_JSON__: jsLiteral(date),
      __PLAN_REPO_JSON__: jsLiteral(repo),
      __PLAN_SOURCE_JSON__: jsLiteral(source),
      __PLAN_ENDPOINT_JSON__: jsLiteral(endpoint),
      __PLAN_SUBMISSION_TOKEN_JSON__: jsLiteral(submissionToken),
      __PLAN_ACCENT_HUE__: String(cfg.accentHue),
      __PLAN_ACCENT__: cfg.accent,
      __PLANS_PORT__: String(cfg.port),
      // Pre-v16 placeholders (theme variants, older custom templates): one
      // literal that is safe in both HTML and quoted-JS contexts.
      __PLAN_TITLE__: legacyLiteral(title),
      __PLAN_DATE__: legacyLiteral(date),
      __PLAN_REPO__: legacyLiteral(repo),
      __PLAN_SOURCE__: legacyLiteral(source),
      __PLAN_SLUG__: legacyLiteral(slug),
    });
    const filename = `${date}-${String(seq).padStart(3, '0')}-${slug}.html`;
    dest = path.join(PLANS_DIR, filename);
    try {
      await fs.writeFile(dest, page, { flag: 'wx' });
    } catch (err) {
      console.error(`Refusing to overwrite existing ${filename}: ${err.message}`);
      process.exit(1);
    }
    cfg.nextSeq = seq + 1;
    await writeConfig(cfg);
    await writeIndex(['--quiet']);
  } finally {
    await releaseLock();
  }
  console.log(dest);
}

/* ---------------- app skeleton ---------------- */
// Stamping apps now belongs to appkit (~/.claude/templates/appkit), which
// composes the shell from named parts, records provenance in <repo>/.appkit/
// lock.json, and can preview + migrate upgrades. `plans app` stays as a thin
// alias so existing muscle memory and docs keep working.
//
// The pre-appkit path — copying docs/plans/.app-template*.html — is still here
// as a fallback for machines without appkit installed, and for named variants
// (--template changes) that have not been ported to a recipe yet.
async function cmdApp(argv) {
  const { flags, rest } = parseFlags(argv);
  const slug = (rest[0] || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) {
    console.error('Usage: plans app <slug> [--title "Title"] [--badge "TAG"] [--dest dir] [--template name] [--recipe name]');
    process.exit(1);
  }
  const destination = await resolveInsideRoot(flags.dest || 'apps', '--dest');

  // Delegate to appkit unless an unported named variant was explicitly asked for.
  const kitBin = path.join(process.env.HOME || '', '.claude', 'templates', 'appkit', 'bin', 'appkit.mjs');
  const wantsLegacyVariant = !!flags.template;
  if (!wantsLegacyVariant && existsSync(kitBin)) {
    const args = [kitBin, 'new', slug, '--recipe', flags.recipe || 'workspace', '--root', ROOT];
    if (flags.title) args.push('--title', flags.title);
    if (flags.badge) args.push('--badge', flags.badge);
    if (flags.dest) args.push('--dest', destination.relative);
    const rt = have('bun') ? 'bun' : 'node';
    const r = spawnSync(rt, args, { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }

  const tplFile = flags.template ? `.app-template-${flags.template}.html` : '.app-template.html';
  const candidates = [
    path.join(PLANS_DIR, tplFile),
    path.join(process.env.HOME || '', '.claude', 'templates', 'plans', tplFile),
  ];
  let template = null;
  for (const p of candidates) {
    try { template = await fs.readFile(p, 'utf8'); break; } catch {}
  }
  if (template == null) {
    console.error(`Missing ${tplFile} — rerun a Claude session (the SessionStart hook scaffolds it), or copy it from ~/.claude/templates/plans/.`);
    process.exit(1);
  }
  const title = flags.title || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const badge = flags.badge || slug.replace(/-/g, ' ').toUpperCase().slice(0, 12);
  const page = stampAppTemplate(template, {
    TITLE: title,
    BADGE: badge,
    SLUG: `app-${slug}`,
    DATE: new Date().toISOString().slice(0, 10),
    REPO: path.basename(ROOT),
  });
  const destDir = destination.resolved;
  await fs.mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, `${slug}.html`);
  try {
    await fs.writeFile(dest, page, { flag: 'wx' });
  } catch (err) {
    console.error(`Refusing to overwrite existing ${dest}: ${err.message}`);
    process.exit(1);
  }
  console.log(dest);
  const cfg = await ensureConfig();
  console.error(`Serve it (and every other page in this repo) portless: bun run plans serve <cmd> -> https://${cfg.appName}.localhost`);
}

/* ---------------- serve (portless) ---------------- */
// Run any dev/app server through portless so every HTML page in this repo is
// reached at the SAME stable https://<appName>.localhost URL — no hardcoded
// ports, no EADDRINUSE. portless injects a free PORT (+ HOST, PORTLESS_URL)
// into the child, so servers must listen on process.env.PORT.
async function cmdServe(argv) {
  let name = null;
  let local = false;
  for (;;) {
    if (argv[0] === '--name') { name = argv[1] || null; argv = argv.slice(2); continue; }
    if (argv[0] === '--local') { local = true; argv = argv.slice(1); continue; }
    break;
  }
  if (!argv.length) {
    console.error('Usage: plans serve [--name <appName>] [--local] <command> [args…]');
    console.error('Example: plans serve bun web/pipeline-server.ts');
    process.exit(1);
  }
  const cfg = await ensureConfig();
  name = validateAppName(name || cfg.appName);
  let bin = 'portless';
  let args = [name, ...argv];
  const env = { ...process.env };
  if (!have('portless')) {
    console.error('[plans serve] portless not found (npm i -g portless) — falling back to a direct run with an ephemeral PORT.');
    bin = argv[0];
    args = argv.slice(1);
    env.PORT = env.PORT || '0';
  } else {
    console.log(`[plans serve] ${name} -> https://${name}.localhost`);
    // v19: when the hub's remote provider is Tailscale, share this app on the
    // tailnet too (portless: `tailscale serve` per app on its own https port).
    // `--local` or PLANS_SERVE_LOCAL=1 keeps it LAN-only.
    if (!local && !env.PLANS_SERVE_LOCAL) {
      const info = await remoteInfo({ refresh: false }).catch(() => null);
      if (info?.enabled && (info.provider === 'tailscale' || info.provider === 'funnel')) {
        env[info.provider === 'funnel' ? 'PORTLESS_FUNNEL' : 'PORTLESS_TAILSCALE'] = '1';
        if (!have('tailscale') && existsSync(TAILSCALE_APP_BIN)) env.PATH = `${path.dirname(TAILSCALE_APP_BIN)}:${env.PATH || ''}`;
        console.log(`[plans serve] remote: ${info.provider} (portless prints the https://<node>.ts.net URL below; --local to skip)`);
      }
    }
  }
  const child = spawn(bin, args, { stdio: 'inherit', env });
  child.on('exit', code => process.exit(code ?? 0));
  child.on('error', err => { console.error(err.message); process.exit(1); });
}

/* ---------------- index dashboard ---------------- */
// Theme variants: plans.config.json may carry `"theme": "<name>"`. The hook
// copies matching page templates from ~/.claude/templates/plans/variants/<name>/;
// this function picks the matching dashboard CSS. Currently: "mono" (Geist
// monochrome, dashboard-aligned) or stock (default).
function indexCss(cfg) {
  const mono = cfg.theme === 'mono';
  const fonts = mono ? `
@font-face{font-family:'Geist Sans';src:url(../../assets/fonts/GeistSans.woff2) format('woff2');font-weight:100 900;font-display:swap}
@font-face{font-family:'Geist Mono';src:url(../../assets/fonts/GeistMono.woff2) format('woff2');font-weight:100 900;font-display:swap}
@font-face{font-family:'Geist Pixel Square';src:url(../../assets/fonts/GeistPixelSquare.woff2) format('woff2');font-weight:400;font-display:swap}` : '';
  const tokens = mono ? `
  --bg:#000;--surface-1:#0a0a0a;--surface-2:#0f0f0f;--surface-3:#141414;
  --hairline:#1f1f1f;--hairline-strong:#2a2a2a;
  --ink:#fafafa;--ink-muted:#a3a3a3;--ink-faint:#8a8a8a;
  --accent:${cfg.accent};--accent-ink:oklch(0.15 0.01 ${cfg.accentHue});
  --focus:var(--accent);--r:6px;
  --font-ui:'Geist Sans',system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --font-mono:'Geist Mono',ui-monospace,"SF Mono","Cascadia Code",Menlo,monospace;
  --font-display:'Geist Pixel Square',var(--font-mono);` : `
  --bg:oklch(0 0 0);--surface-1:oklch(0.169 0.004 265);--surface-2:oklch(0.214 0.005 265);
  --surface-3:oklch(0.255 0.006 265);--hairline:oklch(0.30 0.006 265);
  --hairline-strong:oklch(0.40 0.008 265);--ink:oklch(0.971 0 0);
  --ink-muted:oklch(0.74 0.012 265);--ink-faint:oklch(0.64 0.012 265);
  --accent:${cfg.accent};--accent-ink:oklch(0.17 0.03 ${cfg.accentHue});
  --focus:oklch(0.86 0.16 215);--r:10px;
  --font-ui:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --font-mono:ui-monospace,"SF Mono","Cascadia Code",Menlo,monospace;
  --font-display:var(--font-ui);`;
  // The dashboard is the repo's front door: a heading that names the repo, one
  // line of facts, a filter, then the pages newest-first. No eyebrow, no metric
  // tiles — the numbers live in the subtitle where they read as a sentence.
  return `${fonts}
:root{color-scheme:dark;${tokens}
  --ease-out:cubic-bezier(.16,1,.3,1);--d-fast:120ms;--d-state:200ms}
@media(prefers-color-scheme:light){:root${mono ? '.never' : ''}{color-scheme:light;
  --bg:#f8f7f4;--surface-1:#f4f3ef;--surface-2:#efede8;--surface-3:#e7e4dd;
  --hairline:#e4e1db;--hairline-strong:#d5d2ca;--ink:#15171c;--ink-muted:#4b4f59;--ink-faint:#5e636d;
  --accent:color-mix(in oklab,${cfg.accent} 62%,black);--accent-ink:#fff;--focus:oklch(.5 .12 245)}}
*{box-sizing:border-box}
html{scrollbar-color:var(--hairline-strong) transparent;accent-color:var(--accent)}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font-ui);
  font-size:.9375rem;line-height:1.55;-webkit-font-smoothing:antialiased;caret-color:var(--accent);
  font-variant-numeric:tabular-nums}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:4px}
::selection{background:var(--accent);color:var(--accent-ink)}
.wrap{max-width:900px;margin:0 auto;padding:40px 16px 64px}
h1{font-family:var(--font-display);font-size:${mono ? '1.5rem' : '1.75rem'};font-weight:${mono ? 400 : 700};
  letter-spacing:${mono ? '.03em' : '-.02em'};margin:0 0 6px;text-wrap:balance}
h1 .repo{color:var(--ink-muted);font-weight:500}
.sub{color:var(--ink-faint);font-family:var(--font-mono);font-size:.75rem;margin:0 0 28px;
  display:flex;gap:6px 14px;flex-wrap:wrap}
.sub b{color:var(--ink-muted);font-weight:600}
.sub .live{display:inline-flex;align-items:center;gap:6px}
.sub .live i{width:7px;height:7px;border-radius:50%;background:var(--accent);display:inline-block}
input.search{width:100%;background:var(--surface-1);border:1px solid var(--hairline);
  border-radius:var(--r);color:var(--ink);font-family:var(--font-ui);font-size:.9375rem;
  min-height:44px;padding:0 14px;margin-bottom:20px;transition:border-color var(--d-fast)}
input.search::placeholder{color:var(--ink-faint)}
input.search:hover{border-color:var(--hairline-strong)}
input.search:focus-visible{border-color:var(--accent);outline-offset:0;outline-color:transparent;box-shadow:0 0 0 3px color-mix(in oklch,var(--accent),transparent 80%)}
h2{font-family:var(--font-mono);font-size:.75rem;font-weight:600;letter-spacing:.1em;
  text-transform:uppercase;color:var(--ink-muted);margin:32px 0 10px;display:flex;align-items:baseline;gap:8px}
h2:first-of-type{margin-top:0}
h2 .n{color:var(--ink-faint);font-weight:400;letter-spacing:0}
a.row{display:flex;align-items:center;gap:12px;background:var(--surface-1);
  border:1px solid var(--hairline);border-radius:var(--r);padding:12px 16px;margin-bottom:8px;
  color:inherit;text-decoration:none;min-height:56px;
  transition:border-color var(--d-fast),background var(--d-fast),transform var(--d-fast) var(--ease-out)}
a.row:hover{border-color:var(--hairline-strong);background:var(--surface-2);transform:translateX(2px)}
a.row:active{transform:none}
a.row.hidden{display:none}
.seq{font-family:var(--font-mono);font-size:.75rem;font-weight:700;flex:none;
  background:var(--surface-3);border:1px solid var(--hairline);color:var(--ink-muted);
  padding:3px 9px;border-radius:${mono ? '4px' : '999px'};min-width:48px;text-align:center}
a.row.latest .seq{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.rt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.rt .t{font-weight:600;font-size:.9375rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt .f{font-family:var(--font-mono);font-size:.75rem;color:var(--ink-faint);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.when{font-family:var(--font-mono);font-size:.75rem;color:var(--ink-faint);flex:none}
.pill{font-family:var(--font-mono);font-size:10px;font-weight:700;letter-spacing:.05em;
  flex:none;background:var(--accent);color:var(--accent-ink);padding:2px 8px;
  border-radius:${mono ? '4px' : '999px'};text-transform:uppercase}
.empty{color:var(--ink-muted);padding:40px 24px;border:1px dashed var(--hairline-strong);
  border-radius:var(--r);text-align:center;max-width:52ch;margin:0 auto}
.empty b{display:block;color:var(--ink);font-weight:600;margin-bottom:6px}
.empty code{font-family:var(--font-mono);font-size:.875rem;background:var(--surface-2);padding:2px 7px;border-radius:5px}
.none{color:var(--ink-faint);font-size:.875rem;padding:8px 0 0}
@media(max-width:560px){.rt .t{white-space:normal;line-height:1.35}.when{display:none}.wrap{padding-top:28px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}`;
}

async function cmdIndex(argv) {
  const releaseLock = await acquireSequenceLock();
  try {
    await writeIndex(argv);
  } finally {
    await releaseLock();
  }
}

// Caller owns the sequence lock, including standalone index regeneration.
async function writeIndex(argv) {
  const quiet = argv.includes('--quiet');
  const cfg = await ensureConfig();
  const plans = await listPlans();
  const repo = path.basename(ROOT);
  const rows = plans.map(p => ({
    file: p.name,
    title: p.title.replace(/^#\d+\s*/, ''),
    seq: p.seq,
    date: (p.name.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1]
      || new Date(p.mtime).toISOString().slice(0, 10),
  }));
  const latestSeq = rows.reduce((m, r) => Math.max(m, r.seq ?? 0), 0);
  const updated = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  const apps = await listApps();
  const appRows = apps.map(a => ({ route: encodeURIComponent(path.basename(a.path)), file: path.relative(PLANS_DIR, a.path).split(path.sep).join('/'), title: a.title, name: a.name, date: new Date(a.mtime).toISOString().slice(0, 10) }));
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plans — ${escapeHtml(repo)}</title>
<!-- Generated dashboard. Rebuilt by \`plans.mjs index\` (SessionStart hook + \`plans new\`). Do not edit. -->
<style>${indexCss(cfg)}
</style>
</head>
<body>
<main class="wrap">
  <h1>Plans <span class="repo">· ${escapeHtml(repo)}</span></h1>
  <p class="sub">
    <span><b>${rows.length}</b> ${rows.length === 1 ? 'plan' : 'plans'}</span>
    ${latestSeq ? `<span>latest <b>#${String(latestSeq).padStart(3, '0')}</b> · ${escapeHtml(rows[0]?.date || '')}</span>` : ''}
    ${appRows.length ? `<span><b>${appRows.length}</b> ${appRows.length === 1 ? 'app' : 'apps'}</span>` : ''}
    <span class="live"><i></i>https://${escapeHtml(cfg.appName)}.localhost/plans/</span>
    <span>rebuilt ${escapeHtml(updated)}</span>
  </p>
  <input class="search" id="q" type="search" placeholder="Filter by title or file…" aria-label="Filter plans and apps" autocomplete="off">
  <h2 id="h-plans">Plans <span class="n" id="n-plans">${rows.length}</span></h2>
  <div id="list">
${rows.length === 0 ? `    <div class="empty"><b>No plan pages yet</b>Stamp the first one with <code>bun run plans new &lt;slug&gt; --title "…"</code>, fill in its decisions, and it appears here.</div>` : rows.map((r, i) => `    <a class="row${r.seq != null && r.seq === latestSeq && latestSeq > 0 ? ' latest' : ''}" href="${escapeHtml(r.file)}">
      <span class="seq">${r.seq != null ? '#' + String(r.seq).padStart(3, '0') : '·'}</span>
      <span class="rt"><span class="t">${escapeHtml(r.title)}</span><span class="f">${escapeHtml(r.file)}</span></span>
      ${i === 0 ? '<span class="pill">latest</span>' : ''}
      <span class="when">${escapeHtml(r.date)}</span>
    </a>`).join('\n')}
    <p class="none" id="none-plans" hidden>No plans match.</p>
  </div>
${appRows.length ? `  <h2 id="h-apps">Apps <span class="n" id="n-apps">${appRows.length}</span></h2>
  <div id="apps">
${appRows.map(a => `    <a class="row" data-app-file="${escapeHtml(a.route)}" href="${escapeHtml(a.file)}">
      <span class="seq">app</span>
      <span class="rt"><span class="t">${escapeHtml(a.title)}</span><span class="f">${escapeHtml(a.name)}</span></span>
      <span class="when">${escapeHtml(a.date)}</span>
    </a>`).join('\n')}
    <p class="none" id="none-apps" hidden>No apps match.</p>
  </div>` : ''}
</main>
<script>
(function(){
  if (/^https?:$/.test(location.protocol)) {
    var prefix = location.pathname.replace(/\\/plans\\/(?:index\\.html)?$/, '');
    document.querySelectorAll('[data-app-file]').forEach(function(link){
      link.setAttribute('href', prefix + '/apps/' + link.getAttribute('data-app-file'));
    });
  }
  var q = document.getElementById('q');
  function apply(){
    var v = q.value.trim().toLowerCase();
    [['list','none-plans','n-plans'],['apps','none-apps','n-apps']].forEach(function(ids){
      var box = document.getElementById(ids[0]); if(!box) return;
      var shown = 0;
      box.querySelectorAll('a.row').forEach(function(r){
        var hit = v === '' || r.textContent.toLowerCase().indexOf(v) !== -1;
        r.classList.toggle('hidden', !hit); if(hit) shown++;
      });
      var none = document.getElementById(ids[1]); if(none) none.hidden = shown !== 0;
      var n = document.getElementById(ids[2]); if(n) n.textContent = String(shown);
    });
  }
  q.addEventListener('input', apply);
  document.addEventListener('keydown', function(e){
    if(e.key === '/' && document.activeElement !== q){ e.preventDefault(); q.focus(); }
    if(e.key === 'Escape' && document.activeElement === q){ q.value = ''; apply(); q.blur(); }
  });
})();
</script>
</body>
</html>
`;
  await fs.mkdir(PLANS_DIR, { recursive: true });
  await fs.writeFile(path.join(PLANS_DIR, 'index.html'), html.replace(/[ \t]+$/gm, ''));
  if (!quiet) console.log(path.join(PLANS_DIR, 'index.html'));
}

/* ---------------- help ---------------- */
function cmdHelp() {
  console.log(`Plan-page toolchain for docs/plans/ — browse, create & index interactive HTML plans + apps.

Usage:
  bun run plans                 # interactive picker (fzf if available) — lists plans + apps
  bun run plans latest          # open the newest plan/app, no prompt
  bun run plans <substr>        # open first plan/app whose name or title matches
  bun run plans new <slug> [--title "T"] [--source "session/prompt provenance"]
                                # stamp a new interactive plan page (auto-numbered, repo accent)
  bun run plans app <slug> [--title "T"] [--badge "TAG"] [--dest dir] [--recipe workspace|records]
                                # stamp a single-file skeleton app via appkit (provenance +
                                # upgradeable). --template <name> = legacy variant copy.
  bun run plans index [--quiet] # regenerate docs/plans/index.html dashboard
  bun run plans serve [--name x] <cmd…>
                                # run a dev/app server through portless -> https://<appName>.localhost
  bun run plans wait <slug> [--seq N] [--timeout S] [--any]
                                # block until that plan's decisions land in the hub inbox; prints the path
  bun run plans hub [status|register|install|start|stop|logs|url [--remote]|run]
                                # v17 always-on hub: https://<appName>.localhost/plans/ via portless
  bun run plans hub remote [status|on|off] [--provider tailscale|funnel|ngrok|cloudflare]
                                # v19: reach every plan from your phone off-LAN (keyed link, then cookie)
  bun run plans hub notify [status|set --channel imessage|command|off --to <handle>|test]
                                # v19: how 'plans wait' texts you (iMessage to yourself, or a command)
  bun run plans notify [--test] # text the "waiting for you" link now
  bun run plans done <slug> [--items d01,d03] [--note "…"] [--commit sha]
                                # record that the approved decisions were executed (→ "implemented")
  bun run plans status [--all] [--json]
                                # lifecycle of every plan: submitted (✓/✗) → implemented, with a git hint
  bun run plans inbox import [file…]
                                # adopt pre-v17 <slug>-decisions.json downloads into the hub inbox
  bun run plans help            # print this message (also -h, --help)`);
}

/* ---------------- main ---------------- */
async function main() {
  const arg = process.argv[2];

  if (arg === 'help' || arg === '-h' || arg === '--help') return cmdHelp();
  if (arg === 'new') return cmdNew(process.argv.slice(3));
  if (arg === 'app') return cmdApp(process.argv.slice(3));
  if (arg === 'index') return cmdIndex(process.argv.slice(3));
  if (arg === 'serve') return cmdServe(process.argv.slice(3));
  if (arg === 'wait') return cmdWait(process.argv.slice(3));
  if (arg === 'hub') return cmdHub(process.argv.slice(3));
  if (arg === 'notify') return cmdNotify(process.argv.slice(3));
  if (arg === 'done') return cmdDone(process.argv.slice(3));
  if (arg === 'status') return cmdStatus(process.argv.slice(3));
  if (arg === 'inbox') return cmdInbox(process.argv.slice(3));

  const items = await listBrowsable();
  if (items.length === 0) {
    console.error(`No plan pages or apps found in ${PLANS_DIR} (or ./apps).`);
    console.error('Create one with `bun run plans new <slug> --title "Title"`');
    console.error('               or `bun run plans app <slug> --template changes`.');
    console.error('Run `bun run plans help` for all commands.');
    process.exit(1);
  }

  if (arg) {
    const q = arg.toLowerCase();
    const match =
      q === 'latest'
        ? items.reduce((newest, item) => item.mtime > newest.mtime ? item : newest)
        : items.find(p => p.name.toLowerCase().includes(q) || p.title.toLowerCase().includes(q));
    if (!match) {
      console.error(`No plan or app matches "${arg}". Available:`);
      items.forEach(p => console.error(`  ${label(p)}`));
      process.exit(1);
    }
    await openInBrowser(match.path);
    return;
  }

  if (items.length === 1) { await openInBrowser(items[0].path); return; }

  let chosen = null;
  if (process.stdin.isTTY && have('fzf')) chosen = fzfPick(items);
  else if (process.stdin.isTTY) chosen = await numberedPick(items);
  else chosen = items[0].path;

  if (!chosen) { console.log('Nothing selected.'); return; }
  await openInBrowser(chosen);
}

main().catch(err => { console.error(err.message); process.exitCode = 1; });
