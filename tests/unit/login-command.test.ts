import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loginCommand } from "@/commands/login.js";
import { runLogin } from "@/linkedin/auth/playwright-auth.js";
import { Store } from "@/store/index.js";

vi.mock("@/linkedin/auth/playwright-auth.js", () => ({ runLogin: vi.fn() }));
vi.mock("@/utils/output.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  success: vi.fn(),
  printData: vi.fn(),
  error: (message: string) => {
    throw new Error(message);
  },
}));
let root: string;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
describe("CLI login account identity", () => {
  it.each([
    "owner",
    undefined,
  ])("preserves known profile metadata when re-login omits it (account=%s)", async (account) => {
    root = await mkdtemp(join(tmpdir(), "allman-login-"));
    const store = new Store({ path: root });
    await store.init();
    const known = {
      urn: "urn:li:fsd_profile:ACoExpected",
      profileSlug: "owner",
      name: "Owner",
      headline: "Known headline",
      profileUrl: "https://www.linkedin.com/in/owner",
      imageUrl: "https://example.test/avatar",
      userType: null,
      networkSize: 50,
      status: "unauthenticated" as const,
      lastSyncAt: "2026-09-20T12:00:00.000Z",
    };
    await store.accounts.writeAuth("ACoExpected", known);
    await store.accounts.createAlias("owner", "ACoExpected");
    vi.mocked(runLogin).mockResolvedValue({
      success: true,
      profileUrn: known.urn,
      profileUrl: null,
      name: null,
      headline: null,
      imageUrl: null,
      cookieJar: { cookies: [] },
    });
    await loginCommand({ store: root, account, salesnav: false });
    expect(await store.accounts.readAuth("ACoExpected")).toEqual({
      ...known,
      status: "authenticated",
    });
    expect((await store.accounts.readCookies("ACoExpected"))?.cookieJar).toEqual({ cookies: [] });
  });
  it("refuses a different browser account before storing cookies or redirecting the alias", async () => {
    root = await mkdtemp(join(tmpdir(), "allman-login-"));
    const store = new Store({ path: root });
    await store.init();
    await store.accounts.writeAuth("ACoExpected", {
      urn: "urn:li:fsd_profile:ACoExpected",
      profileSlug: "owner",
      name: "Owner",
      headline: null,
      profileUrl: null,
      imageUrl: null,
      userType: null,
      networkSize: null,
      status: "unauthenticated",
      lastSyncAt: null,
    });
    await store.accounts.createAlias("owner", "ACoExpected");
    vi.mocked(runLogin).mockResolvedValue({
      success: true,
      profileUrn: "urn:li:fsd_profile:ACoOther",
      profileUrl: "https://www.linkedin.com/in/other",
      name: "Other",
      headline: null,
      imageUrl: null,
      cookieJar: { cookies: [] },
    });
    await expect(loginCommand({ store: root, account: "owner" })).rejects.toThrow(
      "account mismatch"
    );
    expect(await store.accounts.resolveId("owner")).toBe("ACoExpected");
    expect(await store.accounts.readCookies("ACoOther")).toBeNull();
  });
});
