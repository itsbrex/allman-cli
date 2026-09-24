import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlViewerService, viewerServiceStatus } from "@/activity/service.js";
import { usesLinkedIn } from "@/linkedin/session-control.js";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
vi.mock("node:fs", async (original) => ({ ...(await original<object>()), existsSync: () => true }));
const result = (stdout = "state = running\npid = 123\n", status = 0, stderr = "") => ({
  pid: 1,
  output: [null, stdout, stderr],
  stdout,
  stderr,
  status,
  signal: null,
});
afterEach(() => vi.clearAllMocks());
describe.runIf(process.platform === "darwin")("viewer launchd controls", () => {
  it("reports only service metadata, never launchd environment contents", () => {
    vi.mocked(spawnSync).mockReturnValue(result("state = running\npid = 123\nSECRET=private\n"));
    expect(viewerServiceStatus()).toMatchObject({ loaded: true, running: true, pid: 123 });
    expect(JSON.stringify(viewerServiceStatus())).not.toContain("private");
  });
  it("starts an unloaded service and stops only the exact loaded viewer", () => {
    vi.mocked(spawnSync)
      .mockReturnValueOnce(result("", 113, "Could not find service"))
      .mockReturnValueOnce(result())
      .mockReturnValueOnce(result());
    expect(controlViewerService("start")).toMatchObject({ running: true });
    expect(vi.mocked(spawnSync).mock.calls[1]?.[1]).toEqual([
      "bootstrap",
      `gui/${process.getuid?.()}`,
      expect.stringContaining("com.allman.activity-viewer.plist"),
    ]);
    vi.mocked(spawnSync)
      .mockReturnValueOnce(result())
      .mockReturnValueOnce(result())
      .mockReturnValueOnce(result("", 113, "Could not find service"));
    expect(controlViewerService("stop")).toMatchObject({ loaded: false });
    expect(vi.mocked(spawnSync).mock.calls[4]?.[1]).toEqual([
      "bootout",
      `gui/${process.getuid?.()}/com.allman.activity-viewer`,
    ]);
  });
  it("does not report lookup failures as a stopped service", () => {
    vi.mocked(spawnSync).mockReturnValue(result("", 1, "permission denied"));
    expect(() => viewerServiceStatus()).toThrow("rejected the lookup");
  });
});
it("classifies service and statusline as local without unguarding other commands", () => {
  expect(usesLinkedIn("service", {}, "activity")).toBe(false);
  expect(usesLinkedIn("statusline", {})).toBe(false);
  expect(usesLinkedIn("future-network-command", {}, "activity")).toBe(true);
});
