import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { logoutCommand } from "@/commands/logout.js";
import { Store } from "@/store/index.js";

vi.unmock("simple-git");
vi.mock("@/utils/output.js", () => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

it("clears private cookies without copying credentials into tracked auth metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "allman-logout-"));
  try {
    const store = new Store({ path: root });
    await store.init();
    await store.accounts.write("ACoFixture", {
      urn: "urn:li:fsd_profile:ACoFixture",
      profileSlug: "fixture",
      name: "Fixture",
      headline: null,
      profileUrl: null,
      imageUrl: null,
      userType: null,
      networkSize: null,
      status: "authenticated",
      lastSyncAt: null,
      cookieJar: { cookies: [{ key: "li_at", value: "private-synthetic-session" }] },
      cookiesUpdatedAt: new Date().toISOString(),
      requestIdentity: { userAgent: "Fixture/151", acceptLanguage: "en-US", mpVersion: "1.2.3" },
    });
    await store.git.flush();
    await logoutCommand({ store: root, account: "ACoFixture" });
    expect(await store.accounts.readCookies("ACoFixture")).toEqual({
      cookieJar: null,
      cookiesUpdatedAt: null,
    });
    const auth = JSON.parse(await readFile(join(root, "ACoFixture/AUTH.json"), "utf8"));
    expect(auth.status).toBe("unauthenticated");
    for (const field of ["cookieJar", "cookiesUpdatedAt", "requestIdentity"])
      expect(auth).not.toHaveProperty(field);
    const tracked = execFileSync("git", ["show", "HEAD:ACoFixture/AUTH.json"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(tracked).not.toContain("private-synthetic-session");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
