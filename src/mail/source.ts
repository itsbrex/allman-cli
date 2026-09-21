import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

export interface MailAccount {
  id: string;
  name: string;
}
export interface MailMessage {
  id: number;
  account_id: string;
  account: string;
  mailbox: string;
  subject: string;
  sender: string;
  to: { name: string; address: string }[];
  cc: { name: string; address: string }[];
  content: string;
  date_received: string;
  date_sent: string | null;
  message_id: string | null;
  in_reply_to: string | null;
  references: string[];
  read: boolean | null;
  flagged: boolean | null;
  attachments: {
    filename: string;
    mime_type: string;
    size: number | null;
    content_id: string | null;
  }[];
  partial?: boolean;
  automated?: boolean;
}
export interface MailCoverage {
  scope: "indexed";
  archive_complete: false;
  eligible_count: number;
  scanned_count: number;
  returned_count: number;
  failed_count: number;
  has_more: boolean;
  last_sync: string | null;
  staleness_hours: number | null;
  capped_mailboxes: number;
  failed_jobs_count: number;
  warnings: string[];
}
export interface MailPage {
  schema_version: 1;
  account: MailAccount;
  messages: MailMessage[];
  errors: { id: number; account_id: string; mailbox: string; code: string }[];
  next_cursor: string | null;
  coverage: MailCoverage;
}
export interface MailSource {
  accounts(): Promise<MailAccount[]>;
  page(args: {
    account: string;
    after: string;
    before: string;
    limit: number;
    cursor?: string | null;
  }): Promise<MailPage>;
  close(): Promise<void>;
}
export interface MailSourceConfig {
  command: string;
  args: string[];
  pythonPath?: string;
}
export class McpMailSource implements MailSource {
  private client = new Client({ name: "allman-read-only-ingestion", version: "1.0.0" });
  async connect(config: MailSourceConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: {
        ...getDefaultEnvironment(),
        APPLE_MAIL_READ_ONLY: "1",
        FASTMCP_CHECK_FOR_UPDATES: "off",
        ...(config.pythonPath ? { PYTHONPATH: config.pythonPath } : {}),
      },
      stderr: "pipe",
    });
    // Drain diagnostics without copying private mail metadata into logs.
    transport.stderr?.on("data", () => {});
    try {
      await this.client.connect(transport);
    } catch (e) {
      await transport.close();
      throw e;
    }
  }
  private async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    if (!["list_accounts", "export_emails_page"].includes(name))
      throw new Error("Mail connector permits read tools only");
    const result = await this.client.callTool({ name, arguments: args }, undefined, {
      timeout: 120000,
    });
    if (result.isError)
      throw new Error(`Apple Mail ${name} failed; check local source diagnostics`);
    const structured = result.structuredContent as { result?: unknown } | undefined;
    if (structured) return (structured.result ?? structured) as T;
    const content = result.content as { type: string; text?: string }[];
    const text = content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    return JSON.parse(text) as T;
  }
  async accounts() {
    return this.call<MailAccount[]>("list_accounts", {});
  }
  async page(args: {
    account: string;
    after: string;
    before: string;
    limit: number;
    cursor?: string | null;
  }) {
    const tools = await this.client.listTools();
    if (!tools.tools.some((t) => t.name === "export_emails_page"))
      throw new Error(
        "Apple Mail server lacks export_emails_page. Update or select the ingestion-capable checkout."
      );
    const page = await this.call<MailPage>("export_emails_page", args);
    if (page.schema_version !== 1 || !Array.isArray(page.messages) || !page.coverage)
      throw new Error("Unsupported Apple Mail page schema");
    return page;
  }
  async close() {
    await this.client.close();
  }
}
