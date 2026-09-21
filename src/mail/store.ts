import { createHash } from "node:crypto";
import { join } from "node:path";
import { readJson, writePrivate } from "../store/private-workspace.js";
import type {
  MailAccount,
  MailCoverage,
  MailMessage,
  MailSource,
  MailSourceConfig,
} from "./source.js";

export const stableId = (value: string) => createHash("sha256").update(value).digest("hex");
export function contactId(value: string): string {
  const h = stableId(value);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function emailAddress(value: string): string | null {
  const match = value.match(/<?([^<>\s]+@[^<>\s]+)>?/);
  return match?.[1]?.toLowerCase() ?? null;
}
export interface Contact {
  id: string;
  name: string;
  emails: string[];
  linkedin: { account: string; flagshipId: string }[];
  tags: string[];
  inboundDays?: number;
  outboundDays?: number;
}
export interface Identities {
  contacts: Record<string, Contact>;
}
export interface MailConfig {
  schemaVersion: 1;
  days: number;
  accounts: MailAccount[];
  source: MailSourceConfig;
}
export interface MailRun {
  account: MailAccount;
  after: string;
  before: string;
  cursor: string | null;
  pages: number;
  scanned: number;
  errors: { id: number; account_id: string; mailbox: string; code: string }[];
  coverage: MailCoverage | null;
  indexedComplete: boolean;
  completedAt: string | null;
}
export interface StoredMail extends MailMessage {
  key: string;
  copies: { id: number; mailbox: string }[];
  importedAt: string;
}
export class MailStore {
  constructor(readonly root: string) {}
  config() {
    return readJson<MailConfig | null>(join(this.root, "mail-config.json"), null);
  }
  identities() {
    return readJson<Identities>(join(this.root, "contacts.json"), { contacts: {} });
  }
  saveIdentities(value: Identities) {
    return writePrivate(join(this.root, "contacts.json"), value);
  }
  runs() {
    return readJson<Record<string, MailRun>>(join(this.root, "mail-runs.json"), {});
  }
  async messages(): Promise<StoredMail[]> {
    const index = await readJson<Record<string, string>>(join(this.root, "mail-index.json"), {});
    const messages: StoredMail[] = [];
    for (const path of Object.values(index)) {
      const msg = await readJson<StoredMail | null>(join(this.root, "mail", path), null);
      if (msg) messages.push(msg);
    }
    return messages;
  }
  async applyPage(messages: MailMessage[]): Promise<void> {
    const index = await readJson<Record<string, string>>(join(this.root, "mail-index.json"), {});
    const identities = await this.identities();
    for (const message of messages) {
      if (!message.account_id || !Number.isSafeInteger(message.id))
        throw new Error("Invalid mail source identity");
      const identity = message.message_id
        ? [message.message_id, message.sender, message.date_sent, message.subject]
        : [message.mailbox, message.id];
      const key = stableId(JSON.stringify([message.account_id, ...identity]));
      const file = `${key}.json`;
      const previous = await readJson<StoredMail | null>(join(this.root, "mail", file), null);
      const copies = [...(previous?.copies ?? [])];
      if (!copies.some((c) => c.id === message.id && c.mailbox === message.mailbox))
        copies.push({ id: message.id, mailbox: message.mailbox });
      // If a partial copy arrives later, retain the complete body already captured.
      const merged =
        message.partial && previous && !previous.partial
          ? { ...message, content: previous.content, partial: false }
          : message;
      await writePrivate(join(this.root, "mail", file), {
        ...merged,
        key,
        copies,
        importedAt: new Date().toISOString(),
      });
      index[key] = file;
      for (const raw of [
        message.sender,
        ...message.to.map((p) => p.address),
        ...message.cc.map((p) => p.address),
      ]) {
        const email = emailAddress(raw);
        if (!email) continue;
        const id = contactId(`email:${email}`);
        identities.contacts[id] ??= { id, name: email, emails: [email], linkedin: [], tags: [] };
      }
    }
    await this.saveIdentities(identities);
    await writePrivate(join(this.root, "mail-index.json"), index);
  }
}

/** Checkpoint only after durable records; interrupted pages safely replay. */
export async function ingestMail(
  store: MailStore,
  source: MailSource,
  config: MailConfig,
  options: {
    now?: Date;
    reconcile?: boolean;
    maxPages?: number;
    onPage?: (account: string, run: MailRun) => void;
  } = {}
) {
  const now = options.now ?? new Date(),
    runs = await store.runs();
  for (const account of config.accounts) {
    let run = runs[account.id];
    if (options.reconcile || !run || run.indexedComplete) {
      const floor = now.getTime() - config.days * 86400000;
      const since =
        !options.reconcile && run?.completedAt
          ? Math.max(floor, Date.parse(run.before) - 2 * 86400000)
          : floor;
      run = {
        account,
        after: new Date(since).toISOString(),
        before: now.toISOString(),
        cursor: null,
        pages: 0,
        scanned: 0,
        errors: [],
        coverage: null,
        indexedComplete: false,
        completedAt: null,
      };
    } else if (run.cursor === null && run.pages > 0) {
      // A prior pass ended with errors. Replay its frozen window instead of skipping failures.
      run = { ...run, pages: 0, scanned: 0, errors: [] };
    }
    runs[account.id] = run;
    const cursors = new Set<string>();
    for (let pages = 0; pages < (options.maxPages ?? Number.POSITIVE_INFINITY); pages++) {
      const page = await source.page({
        account: account.id,
        after: run.after,
        before: run.before,
        limit: 50,
        cursor: run.cursor,
      });
      if (page.account.id !== account.id || page.messages.some((m) => m.account_id !== account.id))
        throw new Error("Mail page account mismatch");
      if (page.next_cursor && (page.next_cursor === run.cursor || cursors.has(page.next_cursor)))
        throw new Error("Mail source returned a repeating cursor");
      if (page.next_cursor) cursors.add(page.next_cursor);
      await store.applyPage(page.messages);
      run.cursor = page.next_cursor;
      run.pages++;
      run.scanned += page.coverage.scanned_count;
      run.errors.push(...page.errors);
      run.coverage = page.coverage;
      if (!run.cursor) {
        run.indexedComplete = run.errors.length === 0;
        run.completedAt = run.indexedComplete ? now.toISOString() : null;
      }
      await writePrivate(join(store.root, "mail-runs.json"), runs);
      options.onPage?.(account.name, run);
      if (!run.cursor) break;
    }
  }
  return runs;
}
