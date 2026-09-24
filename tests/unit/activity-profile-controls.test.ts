import { afterEach, expect, it, vi } from "vitest";
import { startActivityServer } from "@/activity/server.js";

interface ControlState {
  active: string | null;
  token: string;
  switching: boolean;
  error?: string;
}
const readState = (response: Response): Promise<ControlState> =>
  response.json() as Promise<ControlState>;

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

it("requires same-origin JSON and a per-viewer token before guarded activation", async () => {
  let active: string | null = "jp";
  const activate = vi.fn(async (name: string) => {
    active = name;
  });
  const server = await startActivityServer({
    root: "/unused",
    label: "Fixture",
    port: 0,
    profileControls: {
      read: () => ({ active, profiles: [{ name: "brian" }, { name: "jp" }] }),
      activate,
    },
  });
  cleanup.push(server.close);
  const origin = new URL(server.url).origin;
  const state = await fetch(`${server.url}api/profiles`).then(readState);
  expect(state.active).toBe("jp");
  const post = (headers: Record<string, string>, profile: unknown = "brian") =>
    fetch(`${server.url}api/profiles`, {
      method: "POST",
      headers,
      body: JSON.stringify({ profile }),
    });
  const headers = {
    "Content-Type": "application/json",
    Origin: origin,
    "X-Allman-Control-Token": state.token,
  };
  expect((await post({ "Content-Type": "application/json", Origin: origin })).status).toBe(403);
  expect((await post({ ...headers, Origin: "https://evil.example" })).status).toBe(403);
  expect((await post({ ...headers, "X-Allman-Control-Token": "wrong" })).status).toBe(403);
  expect((await post({ ...headers, "Content-Type": "text/plain" })).status).toBe(403);
  expect((await post(headers, "unknown")).status).toBe(400);
  expect(activate).not.toHaveBeenCalled();
  expect((await post(headers)).status).toBe(200);
  expect(activate).toHaveBeenCalledExactlyOnceWith("brian");
  expect((await fetch(`${server.url}api/profiles`).then(readState)).active).toBe("brian");
});

it("rejects overlapping switches and reports failure without claiming an active profile", async () => {
  let rejectSwitch: (error: Error) => void = () => {};
  let active: string | null = "jp";
  let started!: () => void;
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  const activate = vi.fn(async () => {
    active = null;
    started();
    await new Promise<void>((_, reject) => {
      rejectSwitch = reject;
    });
  });
  const server = await startActivityServer({
    root: "/unused",
    label: "Fixture",
    port: 0,
    profileControls: {
      read: () => ({ active, profiles: [{ name: "brian" }, { name: "jp" }] }),
      activate,
    },
  });
  cleanup.push(server.close);
  const state = await fetch(`${server.url}api/profiles`).then(readState);
  const request = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: new URL(server.url).origin,
      "X-Allman-Control-Token": state.token,
    },
    body: JSON.stringify({ profile: "brian" }),
  };
  const first = fetch(`${server.url}api/profiles`, request);
  await begun;
  expect((await fetch(`${server.url}api/profiles`, request)).status).toBe(409);
  rejectSwitch(new Error("Open both registered browsers and retry"));
  const failed = await first;
  expect(failed.status).toBe(409);
  expect((await readState(failed)).error).toContain("Open both");
  const after = await fetch(`${server.url}api/profiles`).then(readState);
  expect(after.active).toBeNull();
  expect(after.switching).toBe(false);
  expect(activate).toHaveBeenCalledTimes(1);
});

it("keeps controls disabled on a passive embedded viewer", async () => {
  const server = await startActivityServer({ root: "/unused", label: "Fixture", port: 0 });
  cleanup.push(server.close);
  expect(await fetch(`${server.url}api/profiles`).then(readState)).toEqual({
    enabled: false,
  });
  expect((await fetch(`${server.url}api/profiles`, { method: "POST" })).status).toBe(405);
});
