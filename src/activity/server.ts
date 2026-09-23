import { createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { readActivitySnapshot } from "./journal.js";
import { createMetricsReader } from "./metrics.js";
import { activityHtml } from "./view.js";

export interface ActivityServer {
  url: string;
  close: () => Promise<void>;
  reused?: boolean;
}
export async function startActivityServer(options: {
  root: string;
  label: string;
  accountDir?: string;
  port?: number;
  publicOrigin?: string;
  artifact?: { html: string; ogImage: Uint8Array };
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
  const key = createHash("sha256").update(options.root).digest("hex");
  const scriptHashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(
      (match) =>
        `'sha256-${createHash("sha256")
          .update(match[1] ?? "")
          .digest("base64")}'`
    )
    .join(" ");
  const sockets = new Set<ServerResponse>();
  const metrics = options.accountDir
    ? createMetricsReader(options.accountDir, options.root)
    : undefined;
  let url = "";
  const server = createServer((req, res) => {
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
    if (request.pathname === "/api/identity") {
      res.end(JSON.stringify({ app: "allman-activity-v1", key }));
      return;
    }
    if (!["/api/snapshot", "/api/events"].includes(request.pathname)) {
      res.writeHead(404).end("{}");
      return;
    }
    const selected = request.searchParams.get("run") || undefined;
    const snapshot = () =>
      JSON.stringify({
        ...readActivitySnapshot(options.root, selected),
        label: options.label,
        viewKey: key,
        metrics: metrics?.(),
      });
    let initial: string;
    try {
      initial = snapshot();
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
    const poll = setInterval(() => {
      try {
        const value = snapshot();
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
    if (publicOrigin || options.artifact) throw error;
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
