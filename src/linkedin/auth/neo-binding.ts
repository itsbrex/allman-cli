/** Prove that a BrowserOS neo MCP endpoint drives the same browser as a CDP endpoint. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { VERSION } from "../../version.js";
import type { ManagedProfile } from "../session-control.js";

const LIST_PAGES =
  'const r = await browser.cdp("Target.getTargets", {}); return r.targetInfos.filter((t) => t.type === "page").map((t) => t.targetId);';

export async function neoPageTargetIds(endpoint: string): Promise<Set<string>> {
  const client = new Client({ name: "allman-cli", version: VERSION });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)), { timeout: 10_000 });
    const result = await client.callTool(
      { name: "run", arguments: { code: LIST_PAGES, timeout: 10_000 } },
      undefined,
      { timeout: 15_000 }
    );
    const body = result.structuredContent as
      | { ok?: boolean; error?: string; value?: unknown }
      | undefined;
    if (
      result.isError ||
      body?.ok !== true ||
      !Array.isArray(body.value) ||
      !body.value.every((id) => typeof id === "string")
    )
      throw new Error(`Neo MCP target listing failed: ${body?.error ?? "unexpected result"}`);
    return new Set(body.value as string[]);
  } finally {
    await client.close();
  }
}

export async function cdpPageTargetIds(
  endpoint: string,
  fetcher: typeof fetch = fetch
): Promise<Set<string>> {
  const response = await fetcher(new URL("/json/list", endpoint), {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`CDP target listing failed: HTTP ${response.status}`);
  const list: unknown = await response.json();
  if (!Array.isArray(list)) throw new Error("CDP target listing failed: unexpected result");
  return new Set(
    list
      .filter(
        (t): t is { id: string; type: string } =>
          typeof t === "object" && t !== null && t.type === "page" && typeof t.id === "string"
      )
      .map((t) => t.id)
  );
}

export async function assertSameBrowser(
  profile: Pick<ManagedProfile, "name" | "browser">,
  deps = { neo: neoPageTargetIds, cdp: cdpPageTargetIds }
): Promise<void> {
  const mcp = profile.browser.mcpEndpoint;
  if (!mcp)
    throw new Error(
      `Profile "${profile.name}" has no MCP endpoint. Run \`allman session bind-mcp ${profile.name} --mcp <url>\` first. No LinkedIn request was made.`
    );
  const [neo, cdp] = await Promise.all([deps.neo(mcp), deps.cdp(profile.browser.cdpEndpoint)]);
  if (neo.size === 0 || cdp.size === 0)
    throw new Error(
      `Cannot bind ${mcp} to ${profile.browser.cdpEndpoint}: a browser lists no open pages. Open a tab in profile "${profile.name}" and retry. No LinkedIn request was made.`
    );
  if (![...neo].some((id) => cdp.has(id)))
    throw new Error(
      `MCP endpoint ${mcp} is not the browser at ${profile.browser.cdpEndpoint} for profile "${profile.name}". No LinkedIn request was made.`
    );
}
