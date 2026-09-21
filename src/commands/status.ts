import { isAuthenticated, loadCookieJar } from "../linkedin/api/cookies.js";
import { resolveStorePath, Store } from "../store/index.js";
import { info, printData } from "../utils/output.js";

export interface StatusOptions {
  account?: string;
  store?: string;
  json?: boolean;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  const storePath = resolveStorePath(options.store);
  const store = new Store({ path: storePath });
  await store.init();

  const profileIds = options.account
    ? [(await store.accounts.resolveId(options.account)) ?? options.account]
    : await store.accounts.list();

  if (profileIds.length === 0) {
    if (options.json) {
      printData([]);
      return;
    }
    info(`No accounts found in ${storePath}.`);
    info(
      "Select an existing store with `allman store use <path>`, or run `allman login` to save a CLI session here."
    );
    return;
  }

  const statuses = await Promise.all(
    profileIds.map(async (profileId) => {
      const record = await store.accounts.read(profileId);
      if (!record) return null;
      const jar = loadCookieJar(record);
      const hasValidCookies = await isAuthenticated(jar);
      const config = await store.accounts.readConfig(profileId);
      return {
        profileId,
        slug: record.profileSlug,
        name: record.name,
        status: record.status,
        cookiesValid: hasValidCookies,
        cookiesSaved: record.cookieJar !== null,
        cookiesUpdatedAt: record.cookiesUpdatedAt,
        lastSyncAt: record.lastSyncAt,
        proxy: config.proxy ? `${config.proxy.host}:${config.proxy.port}` : null,
        storePath,
      };
    })
  );

  const results = statuses.filter(Boolean);

  if (options.json) {
    printData(results);
    return;
  }

  for (const s of results) {
    if (!s) continue;
    const cookieStatus = s.cookiesValid
      ? "✓ present (local check)"
      : s.cookiesSaved
        ? "✗ missing or invalid session — run `allman login`"
        : "not saved — run `allman login` to authorize CLI access";
    process.stdout.write(`Account: ${s.slug ?? s.profileId}\n`);
    process.stdout.write(`  Name:    ${s.name ?? "unknown"}\n`);
    process.stdout.write(`  ID:      ${s.profileId}\n`);
    process.stdout.write(`  Status:  ${s.status}\n`);
    process.stdout.write(`  Cookies: ${cookieStatus}\n`);
    if (s.lastSyncAt)
      process.stdout.write(`  Synced:  ${new Date(s.lastSyncAt).toLocaleString()}\n`);
    if (s.proxy) process.stdout.write(`  Proxy:   ${s.proxy}\n`);
    process.stdout.write(`  Store:   ${s.storePath}\n\n`);
  }
}
