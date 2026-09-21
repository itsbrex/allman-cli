import { resolveStorePath, Store } from "../store/index.js";
import { info, success } from "../utils/output.js";

export interface StoreCmdOptions {
  store?: string;
}

export async function storeUseCommand(path: string): Promise<void> {
  const storePath = await realpath(path);
  const store = new Store({ path: storePath });
  if (!(await store.accounts.list()).length)
    throw new Error(`No accounts found in ${storePath}. Select an existing populated store.`);
  await saveStoreDefault(storePath);
  success(`Default store saved: ${storePath}`);
  if (process.env.ALLMAN_STORE)
    info("ALLMAN_STORE remains an explicit override of this saved default.");
}

export async function storePathCommand(options: StoreCmdOptions): Promise<void> {
  const storePath = resolveStorePath(options.store);
  process.stdout.write(`${storePath}\n`);
}

export async function storeCommitCommand(
  message: string | undefined,
  options: StoreCmdOptions
): Promise<void> {
  const storePath = resolveStorePath(options.store);
  const store = new Store({ path: storePath });
  await store.init();

  store.git.scheduleCommit(message ?? "chore: manual commit");
  await store.git.flush();
  success("Committed.");
}

export async function storeStatusCommand(options: StoreCmdOptions): Promise<void> {
  const storePath = resolveStorePath(options.store);
  const store = new Store({ path: storePath });
  await store.init();

  const accounts = await store.accounts.list();
  let conversationCount = 0;
  for (const id of accounts) {
    const convs = store.forAccount(id);
    const convIds = await convs.list();
    conversationCount += convIds.length;
  }

  info(`Store: ${storePath}`);
  info(`  Accounts:      ${accounts.length}`);
  info(`  Conversations: ${conversationCount}`);
}

import { realpath } from "node:fs/promises";
import { saveStoreDefault } from "../store/config.js";
