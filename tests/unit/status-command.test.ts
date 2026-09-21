import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { statusCommand } from "@/commands/status.js";
import { Store } from "@/store/index.js";
import { info } from "@/utils/output.js";

vi.mock("@/utils/output.js", () => ({ info: vi.fn(), printData: vi.fn() }));
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "allman-status-"));
  vi.clearAllMocks();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
describe("account status guidance", () => {
  it("names the checked store when no account was found", async () => {
    await statusCommand({ store: root });
    expect(vi.mocked(info).mock.calls.flat().join("\n")).toContain(root);
    expect(vi.mocked(info).mock.calls.flat().join("\n")).toContain("allman store use");
  });
  it("distinguishes a browser-only import from expired CLI cookies", async () => {
    const store = new Store({ path: root });
    await store.init();
    await store.accounts.writeAuth("ACoFixture", {
      urn: "urn:li:fsd_profile:ACoFixture",
      profileSlug: "fixture",
      name: "Fixture",
      headline: null,
      profileUrl: null,
      imageUrl: null,
      userType: null,
      networkSize: null,
      status: "unauthenticated",
      lastSyncAt: null,
    });
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await statusCommand({ store: root });
    const rendered = output.mock.calls.map(([line]) => String(line)).join("");
    expect(rendered).toContain("not saved");
    expect(rendered).toContain("allman login");
    expect(rendered).not.toContain("expired");
  });
});
