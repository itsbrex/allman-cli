import { describe, expect, it } from "vitest";
import { runGuardedChild } from "@/linkedin/session-run.js";

const guard = {
  ALLMAN_PROFILE: "jp",
  ALLMAN_NEO_MCP_URL: "http://127.0.0.1:9012/mcp",
  ALLMAN_EXPECTED_MEMBER_ID: "ACoJp123",
  ALLMAN_SESSION_RUN: "1",
} as const;

describe("runGuardedChild", () => {
  it("passes the guard variables and returns the exit code", async () => {
    const code = await runGuardedChild(
      [
        process.execPath,
        "-e",
        "process.exit(process.env.ALLMAN_PROFILE === 'jp' && process.env.ALLMAN_SESSION_RUN === '1' && process.env.ALLMAN_EXPECTED_MEMBER_ID === 'ACoJp123' ? 7 : 1)",
      ],
      guard
    );
    expect(code).toBe(7);
  });

  it("reports a signal exit as 128 plus the signal number", async () => {
    const code = await runGuardedChild(
      [process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"],
      guard
    );
    expect(code).toBe(143);
  });

  it("rejects when the command cannot start", async () => {
    await expect(runGuardedChild(["/nonexistent/lmc"], guard)).rejects.toThrow(/ENOENT/);
  });

  it("rejects an empty command", async () => {
    await expect(runGuardedChild([], guard)).rejects.toThrow(/session run <name> --/);
  });

  it("absorbs SIGINT while the child runs and removes its handlers afterwards", async () => {
    const before = process.listenerCount("SIGINT");
    const running = runGuardedChild(
      [process.execPath, "-e", "setTimeout(() => process.exit(0), 200)"],
      guard
    );
    expect(process.listenerCount("SIGINT")).toBe(before + 1);
    expect(await running).toBe(0);
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});
