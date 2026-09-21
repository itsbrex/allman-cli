import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MailMessage, MailPage, MailSource } from "@/mail/source.js";
import { ingestMail, type MailConfig, MailStore } from "@/mail/store.js";

const account = { id: "account-a", name: "Work" };
const message: MailMessage = {
  id: 1,
  account_id: account.id,
  account: account.name,
  mailbox: "Inbox",
  subject: "Hello",
  sender: "Person <person@example.test>",
  to: [{ name: "Me", address: "me@example.test" }],
  cc: [],
  content: "Hello",
  date_received: "2026-09-01T00:00:00Z",
  date_sent: "2026-09-01T00:00:00Z",
  message_id: "<message@example.test>",
  in_reply_to: null,
  references: [],
  read: false,
  flagged: false,
  attachments: [],
};
const config: MailConfig = {
  schemaVersion: 1,
  days: 90,
  accounts: [account],
  source: { command: "unused", args: [] },
};
const page = (cursor: string | null, rows = [message]): MailPage => ({
  schema_version: 1,
  account,
  messages: rows,
  errors: [],
  next_cursor: cursor,
  coverage: {
    scope: "indexed",
    archive_complete: false,
    eligible_count: 2,
    scanned_count: rows.length,
    returned_count: rows.length,
    failed_count: 0,
    has_more: !!cursor,
    last_sync: null,
    staleness_hours: null,
    capped_mailboxes: 0,
    failed_jobs_count: 0,
    warnings: [],
  },
});
let root: string, store: MailStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-mail-"));
  store = new MailStore(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe("read-only mail ingestion", () => {
  it("resumes exact cursor after interruption, deduplicates replay, writes private files", async () => {
    const calls: unknown[] = [];
    const source: MailSource = {
      accounts: async () => [account],
      close: async () => {},
      page: async (args) => {
        calls.push(args);
        return args.cursor ? page(null) : page("second");
      },
    };
    await ingestMail(store, source, config, { now: new Date("2026-09-19T00:00:00Z"), maxPages: 1 });
    expect((await store.runs())[account.id]?.indexedComplete).toBe(false);
    await ingestMail(store, source, config, { now: new Date("2026-09-20T00:00:00Z") });
    expect(calls[1]).toMatchObject({ cursor: "second", before: "2026-09-19T00:00:00.000Z" });
    expect(await store.messages()).toHaveLength(1);
    expect((await store.runs())[account.id]?.indexedComplete).toBe(true);
    expect((await stat(join(root, "mail-index.json"))).mode & 0o777).toBe(0o600);
  });
  it("reconciles the full history window after index backfill", async () => {
    const source = { page: vi.fn().mockResolvedValue(page(null)) } as unknown as MailSource;
    await ingestMail(store, source, config, { now: new Date("2026-09-19T00:00:00Z") });
    await ingestMail(store, source, config, {
      now: new Date("2026-09-20T00:00:00Z"),
      reconcile: true,
    });
    expect(source.page).toHaveBeenLastCalledWith(
      expect.objectContaining({ after: "2026-06-22T00:00:00.000Z", cursor: null })
    );
  });
  it("keeps account copies separate and coalesces moves within an account", async () => {
    await store.applyPage([
      message,
      { ...message, id: 2, mailbox: "Archive" },
      { ...message, account_id: "b", account: "Other" },
    ]);
    const rows = await store.messages();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.account_id === account.id)?.copies).toHaveLength(2);
  });
  it("does not advance a cursor if a page crosses account boundaries", async () => {
    const source = {
      page: vi
        .fn()
        .mockResolvedValue({ ...page(null), messages: [{ ...message, account_id: "other" }] }),
    } as unknown as MailSource;
    await expect(ingestMail(store, source, config)).rejects.toThrow("account mismatch");
    expect(await store.messages()).toHaveLength(0);
  });
  it("keeps failed windows retryable and refuses repeating cursors", async () => {
    const failed = {
      ...page(null, []),
      errors: [{ id: 1, account_id: account.id, mailbox: "Inbox", code: "missing_emlx" }],
    };
    const source = { page: vi.fn().mockResolvedValue(failed) } as unknown as MailSource;
    await ingestMail(store, source, config);
    expect((await store.runs())[account.id]?.indexedComplete).toBe(false);
    source.page = vi.fn().mockResolvedValue(page("loop"));
    await expect(ingestMail(store, source, config)).rejects.toThrow("repeating cursor");
  });
});
