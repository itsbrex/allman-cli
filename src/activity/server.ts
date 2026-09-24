import { createHash, randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { readActivitySnapshot } from "./journal.js";
import { createMetricsReader } from "./metrics.js";
import { activityHtml } from "./view.js";

export interface ActivityServer {
  url: string;
  close: () => Promise<void>;
  reused?: boolean;
}
export interface ActivityViewContext {
  root: string;
  label: string;
  accountDir?: string;
  profile?: string;
}
export interface ActivityProfileControls {
  read: () => { active: string | null; profiles: Array<{ name: string }> };
  activate: (name: string) => Promise<void>;
}
export async function startActivityServer(options: {
  root: string;
  label: string;
  accountDir?: string;
  port?: number;
  publicOrigin?: string;
  artifact?: { html: string; ogImage: Uint8Array };
  resolveContext?: () => Promise<ActivityViewContext | null>;
  profileControls?: ActivityProfileControls;
}): Promise<ActivityServer> {
  const publicOrigin = options.publicOrigin ? new URL(options.publicOrigin) : undefined;
  if (
    publicOrigin &&
    (!/^https?:$/.test(publicOrigin.protocol) ||
      !publicOrigin.hostname.endsWith(".localhost") ||
      publicOrigin.username ||
      publicOrigin.password ||
      publicOrigin.pathname !== "/" ||
      publicOrigin.search ||
      publicOrigin.hash)
  )
    throw new Error("Activity public origin must be a local .localhost HTTP(S) origin");
  const html = options.artifact?.html ?? activityHtml;
  const contextKey = (context: ActivityViewContext | null) =>
    context ? createHash("sha256").update(context.root).digest("hex") : null;
  const key = contextKey(options);
  const currentContext = async (): Promise<ActivityViewContext | null> => {
    try {
      return options.resolveContext ? await options.resolveContext() : options;
    } catch {
      return null;
    }
  };
  const scriptHashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(
      (match) =>
        `'sha256-${createHash("sha256")
          .update(match[1] ?? "")
          .digest("base64")}'`
    )
    .join(" ");
  const sockets = new Set<ServerResponse>();
  let metricsKey: string | null = null;
  let metrics: ReturnType<typeof createMetricsReader> | undefined;
  let url = "";
  const controlToken = randomBytes(32).toString("hex");
  let switching = false;
  const server = createServer(async (req, res) => {
    const listener = new URL(url);
    const origin = publicOrigin ?? listener;
    const request = new URL(req.url ?? "/", url);
    const staticEntry = ["/", "/apps/activity.html", "/apps/activity-og.png"].includes(
      request.pathname
    );
    // Portless uses changeOrigin and forwards the original authority separately.
    // Trust only this loopback listener and the exact configured local origin.
    const localProxy =
      publicOrigin &&
      [listener.host, `localhost:${listener.port}`].includes(req.headers.host ?? "") &&
      req.headers["x-forwarded-host"] === publicOrigin.host &&
      req.headers["x-forwarded-proto"] === publicOrigin.protocol.slice(0, -1);
    if (
      (req.headers.host !== origin.host && !localProxy) ||
      (req.headers.origin && req.headers.origin !== origin.origin) ||
      (req.headers["sec-fetch-site"] === "cross-site" && !staticEntry)
    ) {
      res.writeHead(403).end("Local same-origin access only");
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src ${scriptHashes}; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
    );
    if (request.pathname === "/api/profiles" && options.profileControls) {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "GET") {
        try {
          res.end(
            JSON.stringify({
              ...options.profileControls.read(),
              enabled: true,
              switching,
              token: controlToken,
            })
          );
        } catch {
          res.writeHead(503).end(JSON.stringify({ error: "Profile registry unavailable" }));
        }
        return;
      }
      if (req.method === "POST") {
        if (
          req.headers.origin !== origin.origin ||
          req.headers["x-allman-control-token"] !== controlToken ||
          req.headers["content-type"] !== "application/json"
        ) {
          res
            .writeHead(403)
            .end(JSON.stringify({ error: "Reload this dashboard before switching accounts" }));
          return;
        }
        if (switching) {
          res.writeHead(409).end(JSON.stringify({ error: "An account switch is already running" }));
          return;
        }
        switching = true;
        try {
          let body = "";
          for await (const chunk of req) {
            body += chunk.toString();
            if (Buffer.byteLength(body) > 4096) throw new Error("Request too large");
          }
          const name: unknown = JSON.parse(body).profile;
          if (
            typeof name !== "string" ||
            !options.profileControls.read().profiles.some((p) => p.name === name)
          ) {
            res.writeHead(400).end(JSON.stringify({ error: "Choose a registered account" }));
            return;
          }
          await options.profileControls.activate(name);
          res.end(JSON.stringify({ ...options.profileControls.read(), enabled: true }));
        } catch (error) {
          res.writeHead(409).end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Account switch failed",
            })
          );
        } finally {
          switching = false;
        }
        return;
      }
    }
    if (req.method !== "GET") {
      res.writeHead(405).end("Read-only viewer");
      return;
    }
    if (request.pathname === "/" || request.pathname === "/apps/activity.html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
      return;
    }
    if (request.pathname === "/apps/activity-og.png" && options.artifact) {
      res.setHeader("Content-Type", "image/png");
      res.end(options.artifact.ogImage);
      return;
    }
    res.setHeader("Content-Type", "application/json");
    if (request.pathname === "/api/profiles") {
      res.end(JSON.stringify({ enabled: false }));
      return;
    }
    if (request.pathname === "/api/identity") {
      const context = await currentContext();
      res.end(
        JSON.stringify({
          app: "allman-activity-v1",
          key: contextKey(context),
          profile: context?.profile ?? null,
          followsActiveProfile: Boolean(options.resolveContext),
        })
      );
      return;
    }
    if (!["/api/snapshot", "/api/events"].includes(request.pathname)) {
      res.writeHead(404).end("{}");
      return;
    }
    let selected = request.searchParams.get("run") || undefined;
    let selectedKey: string | null | undefined = request.searchParams.get("view") || undefined;
    const empty = () =>
      JSON.stringify({
        run: null,
        runs: [],
        label: "No active profile · paused or unavailable",
        viewKey: "no-active-profile",
        metrics: null,
      });
    const snapshot = async () => {
      const context = await currentContext();
      const activeKey = contextKey(context);
      if (selectedKey !== undefined && activeKey !== selectedKey) selected = undefined;
      selectedKey = activeKey;
      if (!context) {
        metrics = undefined;
        metricsKey = null;
        return empty();
      }
      if (metricsKey !== activeKey) {
        metricsKey = activeKey;
        metrics = context.accountDir
          ? createMetricsReader(context.accountDir, context.root)
          : undefined;
      }
      const result = JSON.stringify({
        ...readActivitySnapshot(context.root, selected),
        label: context.label,
        profile: context.profile,
        viewKey: activeKey,
        metrics: metrics?.(),
      });
      // Store scans can take time: discard data if another process switched meanwhile.
      if (options.resolveContext && contextKey(await currentContext()) !== activeKey)
        return empty();
      return result;
    };
    let initial: string;
    try {
      initial = await snapshot();
    } catch {
      res.writeHead(400).end(JSON.stringify({ error: "Cannot read requested activity run" }));
      return;
    }
    if (request.pathname === "/api/snapshot") {
      res.end(initial);
      return;
    }
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    sockets.add(res);
    res.write(`data: ${initial}\n\n`);
    let previous = initial;
    let pending = false;
    const poll = setInterval(async () => {
      if (pending || res.destroyed) return;
      pending = true;
      try {
        const value = await snapshot();
        if (res.destroyed) return;
        if (value !== previous) {
          if (res.writableLength > 1_000_000) {
            res.end();
            return;
          }
          res.write(`data: ${value}\n\n`);
          previous = value;
        }
      } catch {
        res.write("event: unavailable\ndata: {}\n\n");
      } finally {
        pending = false;
      }
    }, 400);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
    res.on("close", () => {
      clearInterval(poll);
      clearInterval(heartbeat);
      sockets.delete(res);
    });
  });
  const bind = (port: number) =>
    new Promise<void>((resolve, reject) => {
      const error = (err: Error) => {
        server.removeListener("listening", listening);
        reject(err);
      };
      const listening = () => {
        server.removeListener("error", error);
        resolve();
      };
      server.once("error", error);
      server.once("listening", listening);
      server.listen(port, "127.0.0.1");
    });
  const requestedPort = options.port ?? 8767;
  try {
    await bind(requestedPort);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || requestedPort === 0) throw error;
    // Portless owns the assigned port. An ephemeral fallback would point the proxy
    // at the wrong listener and must fail instead of silently changing accounts.
    if (publicOrigin || options.artifact || options.resolveContext) throw error;
    const existing = `http://127.0.0.1:${requestedPort}/`;
    try {
      const identity = (await fetch(`${existing}api/identity`, {
        signal: AbortSignal.timeout(800),
      }).then((r) => r.json())) as { app?: string; key?: string };
      if (identity.app === "allman-activity-v1" && identity.key === key)
        return { url: existing, close: async () => {}, reused: true };
    } catch {
      /* A different local app owns this port. */
    }
    await bind(0);
  }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Activity server did not bind");
  url = `http://127.0.0.1:${address.port}/`;
  return {
    url: publicOrigin ? `${publicOrigin.origin}/apps/activity.html` : url,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.end();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
