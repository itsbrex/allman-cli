import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { VERSION } from "../../version.js";
import {
  CONNECTIONS_DECORATION_ID,
  parseConnectionsResponse,
} from "../api/endpoints/connections.js";
import { readShieldPackage, type ShieldPage, verifyShieldPage } from "./shield.js";

export interface NeoConnectionOptions {
  endpoint: string;
  shieldPath?: string;
  count: number;
  start: number;
  expectedProfileId?: string;
}

export interface NeoOwner {
  profileId: string;
  profileSlug: string | null;
  name: string | null;
}

/** One bounded GET-only batch. Cookies and CSRF never leave the browser page. */
export async function readNeoConnections(options: NeoConnectionOptions) {
  if (!Number.isInteger(options.count) || options.count < 1 || options.count > 100)
    throw new Error("Neo MCP batch count must be 1–100.");
  if (!Number.isInteger(options.start) || options.start < 0)
    throw new Error("Neo MCP start must be a non-negative integer.");
  const endpoint = new URL(options.endpoint);
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("Neo MCP requires an HTTP loopback endpoint without credentials.");
  const shield = await readShieldPackage(options.shieldPath);
  const client = new Client({ name: "allman-cli", version: VERSION });
  let session: string | undefined;
  let targetId: string | undefined;
  let pageId: number | undefined;

  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool(
      { name, arguments: { ...args, ...(session ? { session } : {}) } },
      undefined,
      { timeout: 30_000 }
    );
    const handle = result._meta?.["com.browseros.neo/session"];
    if (typeof handle === "string") session = handle;
    return result;
  }
  async function run<T>(code: string): Promise<T> {
    const result = await call("run", { code, timeout: 25_000 });
    const body = result.structuredContent as
      | { ok?: boolean; error?: string; value?: T }
      | undefined;
    if (result.isError || body?.ok !== true)
      throw new Error(`Neo MCP: ${body?.error ?? "missing or unsuccessful structured result"}`);
    return body.value as T;
  }
  async function cdp<T>(method: string, params: Record<string, unknown>, sessionId?: string) {
    return run<T>(
      `return await browser.cdp(${JSON.stringify(method)}, ${JSON.stringify(params)}, ${JSON.stringify(sessionId) ?? "undefined"});`
    );
  }
  try {
    await client.connect(new StreamableHTTPClientTransport(endpoint), { timeout: 10_000 });
    await call("name_session", {
      name: "connection import",
      category: "data-extraction",
      summary: "Read-only connection batch into a local store.",
    });
    let extensionSession: string | undefined;
    const extensionPage: ShieldPage = {
      async goto(url) {
        targetId = (
          await cdp<{ targetId: string }>("Target.createTarget", { url, background: true })
        ).targetId;
        extensionSession = (
          await cdp<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true })
        ).sessionId;
      },
      async evaluate(fn, arg) {
        const value = await cdp<{
          result: { value: Awaited<ReturnType<typeof fn>> };
          exceptionDetails?: unknown;
        }>(
          "Runtime.evaluate",
          {
            expression: `(async () => { if (document.readyState === "loading") await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, {once:true})); return await (${fn.toString()})(${JSON.stringify(arg)}); })()`,
            awaitPromise: true,
            returnByValue: true,
            timeout: 10_000,
          },
          extensionSession
        );
        if (value.exceptionDetails) throw new Error("Shield runtime evaluation failed.");
        return value.result.value;
      },
    };
    const protection = await verifyShieldPage(extensionPage, shield, new Set([shield.extensionId]));
    await cdp("Target.closeTarget", { targetId });
    targetId = undefined;

    pageId = await run<number>(
      'return await browser.pages.newPage("https://www.linkedin.com/mynetwork/invite-connect/connections/");'
    );
    const params = new URLSearchParams({
      decorationId: CONNECTIONS_DECORATION_ID,
      q: "search",
      start: String(options.start),
      count: String(options.count),
      sortType: "RECENTLY_ADDED",
    });
    const code = `
      if (location.origin !== "https://www.linkedin.com") throw new Error("LinkedIn login required in Neo.");
      const cookie = document.cookie.split("; ").find(item => item.startsWith("JSESSIONID="));
      if (!cookie) throw new Error("LinkedIn login required in Neo.");
      const csrf = cookie.slice("JSESSIONID=".length).replace(/^"|"$/g, "");
      async function get(path) {
        const response = await fetch(path, {method:"GET", credentials:"include", redirect:"error",
          headers:{"csrf-token":csrf,"x-restli-protocol-version":"2.0.0","accept":"application/vnd.linkedin.normalized+json+2.1"}, signal:AbortSignal.timeout(10000)});
        if (!response.ok) throw new Error("LinkedIn HTTP " + response.status);
        return await response.json();
      }
      const me = await get("/voyager/api/me");
      const data = me.data ?? me;
      const ref = data["*miniProfile"];
      const profile = data.miniProfile ?? me.included?.find(item => item.entityUrn === ref);
      const id = /^(?:urn:li:fs_miniProfile:|urn:li:fsd_profile:)(ACo[A-Za-z0-9_-]+)$/.exec(profile?.entityUrn ?? ref ?? "")?.[1];
      if (!id) throw new Error("Cannot verify LinkedIn browser account.");
      const expected = ${JSON.stringify(options.expectedProfileId) ?? "undefined"};
      if (expected && id !== expected) throw new Error("LinkedIn browser account mismatch; selected store account was not changed.");
      const owner = {profileId:id,profileSlug:profile?.publicIdentifier ?? null,name:[profile?.firstName,profile?.lastName].filter(Boolean).join(" ") || null};
      const connections = await get(${JSON.stringify(`/voyager/api/relationships/dash/connections?${params}`)});
      if (!Array.isArray(connections.data?.["*elements"]) || !Array.isArray(connections.included)) throw new Error("Unexpected LinkedIn connections response.");
      // Return only fields needed by the existing parser; exclude unrelated metadata.
      connections.included = connections.included.map(item => Object.fromEntries(
        ["entityUrn","connectedMember","createdAt","publicIdentifier","firstName","lastName","headline","profilePicture","memorialized"]
          .filter(key => key in item).map(key => [key,item[key]])));
      return {owner,connections};
    `;
    const evaluation = await run<{
      value: { owner: NeoOwner; connections: Parameters<typeof parseConnectionsResponse>[0] };
      writtenToFile?: boolean;
      path?: string;
    }>(`return await browser.evaluate(${pageId}, {code:${JSON.stringify(code)}});`);
    // Neo spills large evaluations to local files, preserving their full JSON
    // inside explicit untrusted-content markers. Never follow arbitrary paths.
    if (evaluation.writtenToFile) {
      const root = await realpath(join(homedir(), ".browseros", "tool-output"));
      const path = evaluation.path;
      if (!path) throw new Error("Neo MCP omitted its evaluation output path.");
      const resolved = await realpath(path);
      const within = relative(root, resolved);
      const info = await lstat(path);
      if (within.startsWith("..") || !within || !info.isFile() || info.size > 4 * 1024 * 1024)
        throw new Error(
          "Neo MCP evaluation output must be a regular file inside its output directory, under 4 MiB."
        );
      const text = await readFile(path, "utf8");
      const nonce =
        /^\[UNTRUSTED_PAGE_CONTENT nonce=([a-f0-9]+) origin=https:\/\/www\.linkedin\.com(?:\/[^\]]*)?\]/.exec(
          text
        )?.[1];
      const end = nonce ? text.lastIndexOf(`\n[END_UNTRUSTED_PAGE_CONTENT nonce=${nonce}]`) : -1;
      if (end < 0) throw new Error("Neo MCP evaluation output has invalid content markers.");
      evaluation.value = JSON.parse(text.slice(text.indexOf("\n") + 1, end));
    }
    const result = evaluation;
    if (!result.value?.owner?.profileId || !result.value.connections)
      throw new Error("Neo MCP returned an incomplete connections result.");
    if (options.expectedProfileId && result.value.owner.profileId !== options.expectedProfileId)
      throw new Error("LinkedIn browser account mismatch.");
    const page = parseConnectionsResponse(result.value.connections, options.count);
    if (
      page.records.length !== result.value.connections.data?.["*elements"]?.length ||
      page.records.length > options.count
    )
      throw new Error(
        "LinkedIn returned incomplete connection records or exceeded the batch limit."
      );
    return {
      owner: result.value.owner,
      page,
      shield: protection,
    };
  } finally {
    try {
      if (pageId !== undefined) await run(`await browser.pages.close(${pageId});`);
    } finally {
      try {
        if (targetId) await cdp("Target.closeTarget", { targetId });
      } finally {
        await client.close();
      }
    }
  }
}
