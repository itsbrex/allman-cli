#!/usr/bin/env bun
// PLANS_TPL_VERSION: 13
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
//   bun run plans help            # print usage (also -h, --help)
//
// Per-repo config lives at docs/plans/plans.config.json:
//   { version, accent, accentHue, accentName, appName, nextSeq, createdAt }
// The accent is randomized once per repo (by the SessionStart hook or on first
// `new`) and reused for every page so a repo's plans stay visually cohesive.
//
// Managed template: ~/.claude/templates/plans/ (auto-scaffolded + upgraded).

import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// fileURLToPath, NOT .pathname: URL pathnames keep percent-encoding, so a repo
// under a path with spaces (e.g. iCloud "Mobile Documents") would resolve to a
// bogus "Mobile%20Documents" root and silently write config/pages there.
const ROOT = process.env.__PLANS_ROOT || path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PLANS_DIR = path.join(ROOT, 'docs', 'plans');
const CONFIG_PATH = path.join(PLANS_DIR, 'plans.config.json');
const TEMPLATE_PATH = path.join(PLANS_DIR, '.plan-template.html');

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

/* ---------------- config ---------------- */
async function loadConfig() {
  try {
    return JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

// Stable per-repo app name for portless URLs (https://<appName>.localhost).
// Derived once from the repo folder name; edit plans.config.json to rename.
function defaultAppName() {
  return path.basename(ROOT).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

async function ensureConfig() {
  let cfg = await loadConfig();
  if (cfg && cfg.accent && cfg.nextSeq && cfg.appName) return cfg;
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
  await fs.mkdir(PLANS_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
}

/* ---------------- listing ---------------- */
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
  const withStat = await Promise.all(
    html.map(async e => {
      const full = path.join(PLANS_DIR, e.name);
      const st = await fs.stat(full);
      let seq = null;
      let title = e.name;
      try {
        const head = (await fs.readFile(full, 'utf8')).slice(0, 4000);
        const seqMatch = head.match(/data-plan-seq="(\d+)"/);
        if (seqMatch) seq = Number(seqMatch[1]);
        const titleMatch = head.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch) title = titleMatch[1].trim();
      } catch {}
      return { name: e.name, path: full, mtime: st.mtimeMs, seq, title, kind: 'plan' };
    })
  );
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
      const st = await fs.stat(full);
      let title = e.name;
      try {
        const head = (await fs.readFile(full, 'utf8')).slice(0, 4000);
        const m = head.match(/<title>([^<]+)<\/title>/i);
        if (m) title = m[1].trim();
      } catch {}
      out.push({ name: path.relative(ROOT, full), path: full, mtime: st.mtimeMs, seq: null, title, kind: 'app' });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// Combined browse list for the picker: plan pages first (seq order), then apps.
async function listBrowsable() {
  const [plans, apps] = await Promise.all([listPlans(), listApps()]);
  return [...plans, ...apps];
}

/* ---------------- open ---------------- */
function have(bin) {
  return spawnSync('command', ['-v', bin], { shell: true, stdio: 'ignore' }).status === 0;
}

function openInBrowser(file) {
  const url = `file://${file}`;
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
  console.log(`Opening ${path.basename(file)}`);
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
    if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1] ?? ''; i++; }
    else rest.push(argv[i]);
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
    console.error(`Missing ${TEMPLATE_PATH} — rerun a Claude session (the SessionStart hook scaffolds it), or copy it from ~/.claude/templates/plans/.plan-template.html`);
    process.exit(1);
  }
  const cfg = await ensureConfig();
  const seq = cfg.nextSeq;
  const date = new Date().toISOString().slice(0, 10);
  const title = flags.title || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const source = flags.source || 'unspecified';
  const repo = path.basename(ROOT);

  const page = template
    .replaceAll('__PLAN_SEQ_PAD__', String(seq).padStart(3, '0'))
    .replaceAll('__PLAN_SEQ__', String(seq))
    .replaceAll('__PLAN_TITLE__', title)
    .replaceAll('__PLAN_DATE__', date)
    .replaceAll('__PLAN_SLUG__', slug)
    .replaceAll('__PLAN_REPO__', repo)
    .replaceAll('__PLAN_SOURCE__', source)
    .replaceAll('__PLAN_ACCENT_HUE__', String(cfg.accentHue))
    .replaceAll('__PLAN_ACCENT__', cfg.accent);

  const filename = `${date}-${String(seq).padStart(3, '0')}-${slug}.html`;
  const dest = path.join(PLANS_DIR, filename);
  try {
    await fs.writeFile(dest, page, { flag: 'wx' });
  } catch (err) {
    console.error(`Refusing to overwrite existing ${filename}: ${err.message}`);
    process.exit(1);
  }
  cfg.nextSeq = seq + 1;
  await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
  await cmdIndex(['--quiet']);
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

  // Delegate to appkit unless an unported named variant was explicitly asked for.
  const kitBin = path.join(process.env.HOME || '', '.claude', 'templates', 'appkit', 'bin', 'appkit.mjs');
  const wantsLegacyVariant = !!flags.template;
  if (!wantsLegacyVariant && existsSync(kitBin)) {
    const args = [kitBin, 'new', slug, '--recipe', flags.recipe || 'workspace', '--root', ROOT];
    if (flags.title) args.push('--title', flags.title);
    if (flags.badge) args.push('--badge', flags.badge);
    if (flags.dest) args.push('--dest', flags.dest);
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
  const page = template
    .replaceAll('__APP_TITLE__', title)
    .replaceAll('__APP_BADGE__', badge)
    .replaceAll('__APP_SLUG__', `app-${slug}`)
    .replaceAll('__APP_DATE__', new Date().toISOString().slice(0, 10))
    .replaceAll('__APP_REPO__', path.basename(ROOT));
  const destDir = path.join(ROOT, flags.dest || 'apps');
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
  if (argv[0] === '--name') { name = argv[1] || null; argv = argv.slice(2); }
  if (!argv.length) {
    console.error('Usage: plans serve [--name <appName>] <command> [args…]');
    console.error('Example: plans serve bun web/pipeline-server.ts');
    process.exit(1);
  }
  const cfg = await ensureConfig();
  name = name || cfg.appName;
  let bin = 'portless';
  let args = [name, ...argv];
  if (!have('portless')) {
    console.error('[plans serve] portless not found (npm i -g portless) — falling back to a direct run with an ephemeral PORT.');
    bin = argv[0];
    args = argv.slice(1);
    process.env.PORT = process.env.PORT || '0';
  } else {
    console.log(`[plans serve] ${name} -> https://${name}.localhost`);
  }
  const child = spawn(bin, args, { stdio: 'inherit', env: process.env });
  child.on('exit', code => process.exit(code ?? 0));
  child.on('error', err => { console.error(err.message); process.exit(1); });
}

/* ---------------- index dashboard ---------------- */
// Theme variants: plans.config.json may carry `"theme": "<name>"`. The hook
// copies matching page templates from ~/.claude/templates/plans/variants/<name>/;
// this function picks the matching dashboard CSS. Currently: "mono" (Geist
// monochrome, dashboard-aligned) or stock (default).
function indexCss(cfg) {
  if (cfg.theme === 'mono') return `
/* Monochrome Geist variant — matches repos themed like the SF Ownership Desk. */
@font-face{font-family:'Geist Sans';src:url(../../assets/fonts/GeistSans.woff2) format('woff2');font-weight:100 900;font-display:swap}
@font-face{font-family:'Geist Mono';src:url(../../assets/fonts/GeistMono.woff2) format('woff2');font-weight:100 900;font-display:swap}
@font-face{font-family:'Geist Pixel Square';src:url(../../assets/fonts/GeistPixelSquare.woff2) format('woff2');font-weight:400;font-display:swap}
:root{
  color-scheme:dark;
  --bg:#000;--surface-1:#0a0a0a;--surface-2:#0f0f0f;--surface-3:#141414;
  --hairline:#1f1f1f;--hairline-strong:#262626;
  --ink:#fafafa;--ink-muted:#a3a3a3;--ink-faint:#737373;
  --accent:${cfg.accent};--accent-ink:oklch(0.15 0.01 ${cfg.accentHue});
  --btn-outline:rgba(255,255,255,.1);--elev-1:rgba(255,255,255,.04);
  --focus:var(--accent);--ease-out:cubic-bezier(.16,1,.3,1);
  --font-ui:'Geist Sans',system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --font-mono:'Geist Mono',ui-monospace,"SF Mono","Cascadia Code",Menlo,monospace;
  --font-pixel:'Geist Pixel Square',var(--font-mono);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font-ui);
  font-size:.9375rem;line-height:1.55;-webkit-font-smoothing:antialiased}
:focus-visible{outline:1px solid var(--focus);outline-offset:2px;border-radius:2px}
::selection{background:var(--accent);color:var(--accent-ink)}
.wrap{max-width:900px;margin:0 auto;padding:32px 16px 64px}
.eyebrow{font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:.08em;
  text-transform:uppercase;color:var(--ink-faint);display:flex;align-items:center;gap:10px;
  margin-bottom:12px}
.eyebrow .dot{width:8px;height:8px;background:var(--accent)}
h1{font-family:var(--font-pixel);font-size:1.5rem;font-weight:400;letter-spacing:.03em;
  margin:0 0 6px}
.sub{color:var(--ink-faint);font-family:var(--font-mono);font-size:11px;letter-spacing:.05em;
  text-transform:uppercase;margin:0 0 24px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;
  margin-bottom:24px}
.tile{background:var(--surface-1);border:1px solid var(--hairline);border-radius:8px;
  padding:14px 16px}
.tile .n{font-family:var(--font-pixel);font-size:1.25rem;font-weight:400;
  font-variant-numeric:tabular-nums}
.tile .l{font-family:var(--font-mono);font-size:10px;font-weight:600;color:var(--ink-faint);
  text-transform:uppercase;letter-spacing:.09em;margin-top:6px}
input.search{width:100%;background:var(--surface-1);border:1px solid var(--hairline-strong);
  border-radius:6px;color:var(--ink);font-family:var(--font-ui);font-size:.875rem;
  min-height:42px;padding:0 14px;margin-bottom:16px;outline:none;
  transition:border-color .15s}
input.search::placeholder{color:var(--ink-faint)}
input.search:focus{border-color:#404040}
a.row{display:flex;align-items:center;gap:12px;background:var(--surface-1);
  border:1px solid var(--hairline);border-radius:8px;padding:12px 16px;margin-bottom:8px;
  color:inherit;text-decoration:none;transition:border-color .15s,background .15s}
a.row:hover{border-color:var(--hairline-strong);background:var(--surface-2)}
a.row.hidden{display:none}
.seq{font-family:var(--font-mono);font-size:11px;font-weight:600;flex:none;
  background:var(--surface-3);border:1px solid var(--hairline-strong);color:var(--ink-muted);
  padding:3px 8px;border-radius:5px;min-width:44px;text-align:center}
a.row.latest .seq{background:var(--accent);border-color:transparent;color:var(--accent-ink)}
.rt{flex:1;min-width:0}
.rt .t{font-weight:500;font-size:.875rem;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}
.rt .f{font-family:var(--font-mono);font-size:11px;color:var(--ink-faint);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.when{font-family:var(--font-mono);font-size:11px;color:var(--ink-faint);flex:none;
  font-variant-numeric:tabular-nums}
.pill{font-family:var(--font-mono);font-size:9.5px;font-weight:600;letter-spacing:.05em;
  flex:none;background:var(--accent);color:var(--accent-ink);padding:2px 8px;
  border-radius:5px;text-transform:uppercase}
.empty{color:var(--ink-faint);text-align:center;padding:32px;
  border:1px dashed var(--hairline-strong);border-radius:8px;
  font-family:var(--font-pixel);font-size:.8125rem;letter-spacing:.05em;
  text-transform:uppercase}
.empty code{font-family:var(--font-mono);text-transform:none;letter-spacing:0}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}`;
  return `
:root{
  --bg:oklch(0 0 0);--surface-1:oklch(0.169 0.004 265);--surface-2:oklch(0.214 0.005 265);
  --surface-3:oklch(0.255 0.006 265);--hairline:oklch(0.30 0.006 265);
  --hairline-strong:oklch(0.40 0.008 265);--ink:oklch(0.971 0 0);
  --ink-muted:oklch(0.74 0.012 265);--ink-faint:oklch(0.62 0.012 265);
  --accent:${cfg.accent};--accent-ink:oklch(0.17 0.03 ${cfg.accentHue});
  --focus:oklch(0.86 0.16 215);
  --font-ui:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --font-mono:ui-monospace,"SF Mono","Cascadia Code",Menlo,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font-ui);
  font-size:.9375rem;line-height:1.55;-webkit-font-smoothing:antialiased}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:4px}
::selection{background:var(--accent);color:var(--accent-ink)}
.wrap{max-width:900px;margin:0 auto;padding:32px 16px 64px}
.eyebrow{font-family:var(--font-mono);font-size:.75rem;letter-spacing:.06em;
  text-transform:uppercase;color:var(--accent);display:flex;align-items:center;gap:8px;
  margin-bottom:12px}
.eyebrow .dot{width:9px;height:9px;border-radius:50%;background:var(--accent);
  box-shadow:0 0 12px -1px var(--accent)}
h1{font-size:1.75rem;font-weight:700;letter-spacing:-.02em;margin:0 0 4px}
.sub{color:var(--ink-faint);font-family:var(--font-mono);font-size:.75rem;margin:0 0 24px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;
  margin-bottom:24px}
.tile{background:var(--surface-1);border:1px solid var(--hairline);border-radius:12px;
  padding:12px 16px}
.tile .n{font-family:var(--font-mono);font-size:1.125rem;font-weight:600}
.tile .l{font-size:.75rem;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.06em}
input.search{width:100%;background:var(--surface-1);border:1px solid var(--hairline);
  border-radius:8px;color:var(--ink);font-family:var(--font-ui);font-size:.9375rem;
  min-height:44px;padding:0 14px;margin-bottom:16px;outline:none}
input.search:focus{border-color:var(--hairline-strong)}
a.row{display:flex;align-items:center;gap:12px;background:var(--surface-1);
  border:1px solid var(--hairline);border-radius:12px;padding:12px 16px;margin-bottom:10px;
  color:inherit;text-decoration:none;transition:border-color .15s,transform .15s}
a.row:hover{border-color:var(--accent);transform:translateY(-1px)}
a.row.hidden{display:none}
.seq{font-family:var(--font-mono);font-size:.75rem;font-weight:700;flex:none;
  background:var(--surface-3);border:1px solid var(--hairline);color:var(--ink-muted);
  padding:3px 9px;border-radius:999px;min-width:44px;text-align:center}
a.row.latest .seq{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.rt{flex:1;min-width:0}
.rt .t{font-weight:600;font-size:.875rem;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}
.rt .f{font-family:var(--font-mono);font-size:.75rem;color:var(--ink-faint);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.when{font-family:var(--font-mono);font-size:.75rem;color:var(--ink-faint);flex:none}
.pill{font-family:var(--font-mono);font-size:10px;font-weight:700;letter-spacing:.05em;
  flex:none;background:var(--accent);color:var(--accent-ink);padding:2px 8px;
  border-radius:999px;text-transform:uppercase}
.empty{color:var(--ink-faint);text-align:center;padding:32px;border:1px dashed var(--hairline);
  border-radius:12px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function cmdIndex(argv) {
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

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plans — ${esc(repo)}</title>
<!-- Generated dashboard. Rebuilt by \`plans.mjs index\` (SessionStart hook + \`plans new\`). Do not edit. -->
<style>${indexCss(cfg)}
</style>
</head>
<body>
<main class="wrap">
  <div class="eyebrow"><span class="dot"></span>plans · ${esc(repo)} · accent ${esc(cfg.accentName)}</div>
  <h1>Plan dashboard</h1>
  <p class="sub">regenerated ${esc(updated)} · newest first · #seq = creation order</p>
  <div class="tiles">
    <div class="tile"><div class="n">${rows.length}</div><div class="l">plans</div></div>
    <div class="tile"><div class="n">${latestSeq ? '#' + String(latestSeq).padStart(3, '0') : '—'}</div><div class="l">latest seq</div></div>
    <div class="tile"><div class="n">${esc(rows[0]?.date || '—')}</div><div class="l">last plan</div></div>
  </div>
  <input class="search" id="q" type="search" placeholder="Filter plans…" aria-label="Filter plans">
  <div id="list">
${rows.length === 0 ? '    <div class="empty">No plan pages yet. Create one with <code>bun run plans new &lt;slug&gt;</code>.</div>' : rows.map((r, i) => `    <a class="row${r.seq != null && r.seq === latestSeq && latestSeq > 0 ? ' latest' : ''}" href="${esc(r.file)}">
      <span class="seq">${r.seq != null ? '#' + String(r.seq).padStart(3, '0') : '·'}</span>
      <span class="rt"><span class="t">${esc(r.title)}</span><span class="f">${esc(r.file)}</span></span>
      ${i === 0 ? '<span class="pill">latest</span>' : ''}
      <span class="when">${esc(r.date)}</span>
    </a>`).join('\n')}
  </div>
</main>
<script>
document.getElementById('q').addEventListener('input', function () {
  var q = this.value.toLowerCase();
  document.querySelectorAll('a.row').forEach(function (r) {
    r.classList.toggle('hidden', q !== '' && r.textContent.toLowerCase().indexOf(q) === -1);
  });
});
</script>
</body>
</html>
`;
  await fs.mkdir(PLANS_DIR, { recursive: true });
  await fs.writeFile(path.join(PLANS_DIR, 'index.html'), html);
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
        ? items[0]
        : items.find(p => p.name.toLowerCase().includes(q) || p.title.toLowerCase().includes(q));
    if (!match) {
      console.error(`No plan or app matches "${arg}". Available:`);
      items.forEach(p => console.error(`  ${label(p)}`));
      process.exit(1);
    }
    openInBrowser(match.path);
    return;
  }

  if (items.length === 1) { openInBrowser(items[0].path); return; }

  let chosen = null;
  if (process.stdin.isTTY && have('fzf')) chosen = fzfPick(items);
  else if (process.stdin.isTTY) chosen = await numberedPick(items);
  else chosen = items[0].path;

  if (!chosen) { console.log('Nothing selected.'); return; }
  openInBrowser(chosen);
}

main().catch(err => { console.error(err.message); process.exitCode = 1; });
