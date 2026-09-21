import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import WebSocket, { WebSocketServer } from "ws";

interface Message {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface Pending {
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** Resolve HTTP discovery without exposing browser state or credentials in logs. */
async function websocketEndpoint(endpoint: string): Promise<string> {
  if (/^wss?:/.test(endpoint)) return endpoint;
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/json/version`, {
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`CDP discovery failed: HTTP ${response.status}`);
  const value = (await response.json()) as { webSocketDebuggerUrl?: unknown };
  if (typeof value.webSocketDebuggerUrl !== "string")
    throw new Error("CDP discovery did not return a browser WebSocket endpoint");
  const url = new URL(value.webSocketDebuggerUrl);
  if (!/^wss?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("CDP discovery returned an invalid browser WebSocket endpoint");
  return url.href;
}

/**
 * Playwright initializes every target when attaching to a browser. Discarded
 * tabs have no renderer and never answer Page/Runtime initialization commands.
 * Allman only needs its own tabs in the existing persistent context. This local
 * CDP relay excludes pre-existing targets and attaches each tab allman creates.
 * Page-scoped auto-attach (frames/workers) and the browser's context stay intact.
 */
export async function createScopedCdp(endpoint: string): Promise<{
  endpoint: string;
  close(): Promise<void>;
}> {
  const upstream = new WebSocket(await websocketEndpoint(endpoint), {
    handshakeTimeout: 15_000,
    perMessageDeflate: false,
  });
  await once(upstream, "open");
  const pending = new Map<number, Pending>();
  const owned = new Set<string>();
  let sequence = 0;
  let client: WebSocket | undefined;
  let closing: Promise<void> | undefined;
  const route = `/${randomUUID()}`;
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    path: route,
    perMessageDeflate: false,
    maxPayload: 64 * 1024 * 1024,
  });

  function request(message: Message, timeout = 0): Promise<Message> {
    if (upstream.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("CDP browser connection closed"));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = timeout
        ? setTimeout(() => {
            pending.delete(id);
            reject(new Error(`CDP ${message.method} timed out after ${timeout}ms`));
          }, timeout)
        : undefined;
      pending.set(id, { resolve, reject, timer });
      upstream.send(JSON.stringify({ ...message, id }));
    });
  }

  function send(message: Message) {
    if (client?.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
  }

  function close(): Promise<void> {
    closing ??= (async () => {
      client?.terminate();
      await Promise.allSettled(
        [...owned].map((targetId) =>
          request({ method: "Target.closeTarget", params: { targetId } }, 1_000)
        )
      );
      upstream.terminate();
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error("CDP browser connection closed"));
      }
      pending.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    })();
    return closing;
  }

  upstream.on("message", (data) => {
    let message: Message;
    try {
      message = JSON.parse(data.toString()) as Message;
    } catch {
      void close();
      return;
    }
    if (message.id !== undefined) {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      item.resolve(message);
    } else {
      if (message.method === "Target.targetDestroyed") {
        owned.delete(String(message.params?.targetId));
      }
      send(message);
    }
  });
  upstream.on("error", () => void close());
  upstream.on("close", () => void close());
  server.on("connection", (socket) => {
    if (client || closing) {
      socket.close(1008, "This connection is already in use");
      return;
    }
    client = socket;
    socket.on("error", () => void close());
    socket.on("close", () => void close());
    socket.on("message", (data) => {
      void forward(data.toString()).catch(() => void close());
    });
  });

  async function forward(data: string) {
    const message = JSON.parse(data) as Message;
    const { id, sessionId } = message;
    if (typeof id !== "number" || typeof message.method !== "string")
      throw new Error("Invalid CDP request");
    try {
      // Browser-wide attachment must not wake, pause, or initialize other tabs.
      if (!sessionId && message.method === "Target.setAutoAttach") {
        message.params = { ...message.params, filter: [{ exclude: true }] };
      }
      if (message.method === "Browser.close") {
        send({
          id,
          sessionId,
          error: { code: -32000, message: "Cannot close a borrowed browser" },
        });
        return;
      }
      const response = await request(message);
      if (message.method === "Target.createTarget" && !response.error) {
        const targetId = response.result?.targetId;
        if (typeof targetId !== "string") throw new Error("CDP did not return a new target ID");
        owned.add(targetId);
        // The attached event must reach Playwright before createTarget resolves.
        const attached = await request(
          { method: "Target.attachToTarget", params: { targetId, flatten: true } },
          15_000
        );
        if (attached.error) throw new Error(attached.error.message);
      }
      if (message.method === "Target.closeTarget" && !response.error && response.result?.success)
        owned.delete(String(message.params?.targetId));
      send({ ...response, id, ...(sessionId ? { sessionId } : {}) });
    } catch (error) {
      send({
        id,
        sessionId,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  try {
    await once(server, "listening");
    return { endpoint: `ws://127.0.0.1:${(server.address() as AddressInfo).port}${route}`, close };
  } catch (error) {
    await close();
    throw error;
  }
}
