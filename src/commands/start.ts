/**
 * allman start — verify auth, sync from last sync date, then start listening.
 */

import { LinkedInError } from "../linkedin/api/client.js";
import { loadSession } from "../linkedin/api/session.js";
import { resolveStorePath, Store } from "../store/index.js";
import * as output from "../utils/output.js";
import { listenCommand } from "./listen.js";
import { loginCommand } from "./login.js";
import { syncCommand } from "./sync.js";

export interface StartOptions {
  account?: string;
  store?: string;
}

export async function startCommand(options: StartOptions): Promise<void> {
  const storePath = resolveStorePath(options.store);
  const store = new Store({ path: storePath });
  await store.init();

  // Check auth; login if needed
  let authenticated = false;
  let account = options.account;
  try {
    const session = await loadSession(store, options.account);
    account = session.profileId;
    authenticated = Boolean(session.accountRecord.requestIdentity?.mpVersion);
  } catch {
    authenticated = false;
  }

  if (!authenticated) {
    output.info("Verified session metadata missing — starting protected login...");
    await loginCommand({ account, store: options.store });
  }

  // Sync from last sync date (uses lastSyncAt automatically when --since is omitted)
  try {
    await syncCommand({ account, store: options.store });
  } catch (error) {
    // Saved metadata cannot prove that LinkedIn still accepts these cookies.
    // Recover once, retaining the selected identity. Other failures are not auth.
    if (!authenticated || !(error instanceof LinkedInError) || error.code !== "UNAUTHENTICATED")
      throw error;
    output.info("LinkedIn rejected the saved session — refreshing through protected login...");
    await loginCommand({ account, store: options.store });
    await syncCommand({ account, store: options.store });
  }

  // Start listen (runs indefinitely)
  await listenCommand({ account, store: options.store });
}
