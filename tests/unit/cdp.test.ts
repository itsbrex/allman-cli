import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { createScopedCdp } from "@/linkedin/auth/cdp.js";

interface Message {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

let upstream: WebSocketServer;
let relay: Awaited<ReturnType<typeof createScopedCdp>>;
let client: WebSocket;
let commands: Message[];
let events: Message[];
let sequence: number;
let failAttach: boolean;
const replies = new Map<number, (value: Message) => void>();

beforeEach(async () => {
  commands = [];
  events = [];
  sequence = 0;
  failAttach = false;
  replies.clear();
  upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  upstream.on("connection", (socket) => {
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as Message;
      commands.push(message);
      const reply = (result: Record<string, unknown>) =>
        socket.send(JSON.stringify({ id: message.id, sessionId: message.sessionId, result }));
      if (message.method === "Target.createTarget") reply({ targetId: "owned" });
      else if (message.method === "Target.attachToTarget") {
        if (failAttach) {
          socket.send(
            JSON.stringify({
              id: message.id,
              error: { code: -32000, message: "Target disappeared" },
            })
          );
          return;
        }
        socket.send(
          JSON.stringify({
            method: "Target.attachedToTarget",
            params: { sessionId: "page-session", targetInfo: { targetId: "owned", type: "page" } },
          })
        );
        reply({ sessionId: "page-session" });
      } else if (message.method === "Target.closeTarget") reply({ success: true });
      else if (message.method === "Target.setAutoAttach") {
        const filter = message.params?.filter as { exclude: boolean }[] | undefined;
        if (!message.sessionId && !filter?.[0]?.exclude) {
          socket.send(
            JSON.stringify({
              method: "Target.attachedToTarget",
              params: {
                sessionId: "discarded-session",
                targetInfo: { targetId: "existing-discarded", type: "page" },
              },
            })
          );
        }
        reply({});
      } else reply({ echo: message.params });
    });
  });
  await once(upstream, "listening");
  relay = await createScopedCdp(`ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`);
  client = new WebSocket(relay.endpoint);
  client.on("message", (data) => {
    const message = JSON.parse(data.toString()) as Message;
    if (message.id !== undefined) {
      replies.get(message.id)?.(message);
      replies.delete(message.id);
    } else events.push(message);
  });
  await once(client, "open");
});

afterEach(async () => {
  client?.terminate();
  await relay?.close();
  for (const socket of upstream?.clients ?? []) socket.terminate();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

function request(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
  return new Promise<Message>((resolve) => {
    const id = ++sequence;
    replies.set(id, resolve);
    client.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

describe("scoped CDP attachment", () => {
  it("excludes existing discarded tabs and attaches new owned tabs before returning them", async () => {
    await request("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
    expect(events).toEqual([]);
    const created = await request("Target.createTarget", { url: "about:blank" });
    expect(created.result).toEqual({ targetId: "owned" });
    expect(events).toMatchObject([
      { method: "Target.attachedToTarget", params: { targetInfo: { targetId: "owned" } } },
    ]);
    expect(commands.some((command) => command.params?.targetId === "existing-discarded")).toBe(
      false
    );
  });

  it("preserves page-scoped child attachment and concurrent response routing", async () => {
    const params = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };
    await request("Target.setAutoAttach", params, "page-session");
    expect(commands.at(-1)).toMatchObject({ params, sessionId: "page-session" });
    expect(commands.at(-1)?.params).not.toHaveProperty("filter");
    const responses = await Promise.all([
      request("Runtime.evaluate", { expression: "1" }, "page-session"),
      request("Runtime.evaluate", { expression: "2" }, "other-page-session"),
    ]);
    expect(responses.map((response) => [response.sessionId, response.result])).toEqual([
      ["page-session", { echo: { expression: "1" } }],
      ["other-page-session", { echo: { expression: "2" } }],
    ]);
  });

  it("closes only owned tabs and refuses to terminate the borrowed browser", async () => {
    await request("Target.createTarget", { url: "about:blank" });
    expect((await request("Browser.close")).error?.message).toContain("borrowed browser");
    await relay.close();
    expect(commands.filter((command) => command.method === "Target.closeTarget")).toMatchObject([
      { params: { targetId: "owned" } },
    ]);
    expect(commands.some((command) => command.method === "Browser.close")).toBe(false);
  });

  it("returns attachment failures and cleans up the newly created target", async () => {
    failAttach = true;
    expect((await request("Target.createTarget", { url: "about:blank" })).error?.message).toBe(
      "Target disappeared"
    );
    await relay.close();
    expect(commands.at(-1)).toMatchObject({
      method: "Target.closeTarget",
      params: { targetId: "owned" },
    });
  });
});
