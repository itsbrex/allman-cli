import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { statusCommand } from "@/commands/status.js";
import { cookiesFromPlaywright, serializeCookieJar } from "@/linkedin/api/cookies.js";
import { Store } from "@/store/index.js";
import { info, printData } from "@/utils/output.js";

vi.mock("@/utils/output.js", () => ({ info: vi.fn(), printData: vi.fn(), debug: vi.fn() }));
vi.mock("axios", () => ({ default: vi.fn() }));
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

async function savedAccount() {
  const store = new Store({ path: root });
  await store.init();
  const jar = await cookiesFromPlaywright([
    { name: "JSESSIONID", value: '"fixture"', domain: ".www.linkedin.com", path: "/" },
    { name: "li_at", value: "saved", domain: ".www.linkedin.com", path: "/" },
  ]);
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
    cookieJar: serializeCookieJar(jar),
    cookiesUpdatedAt: null,
    lastSyncAt: null,
  });
  return store;
}

describe("saved versus live authentication status", () => {
  it("labels saved authentication as unverified without making a network request", async () => {
    await savedAccount();
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await statusCommand({ store: root });
    expect(out.mock.calls.map(([line]) => String(line)).join("")).toMatch(/not checked.*LinkedIn/);
    expect(axios).not.toHaveBeenCalled();
  });

  it("reports a rejected saved session even when local metadata says authenticated", async () => {
    await savedAccount();
    vi.mocked(axios).mockResolvedValue({ status: 401, headers: {}, data: {} });
    await statusCommand({ store: root, check: true, json: true });
    expect(printData).toHaveBeenLastCalledWith([
      expect.objectContaining({
        status: "authenticated",
        sessionStatus: "unauthenticated",
        cookiesValid: true,
      }),
    ]);
  });

  it("verifies the expected account and persists response cookie updates", async () => {
    const store = await savedAccount();
    vi.mocked(axios).mockResolvedValue({
      status: 200,
      headers: { "set-cookie": ["li_at=renewed; Domain=.www.linkedin.com; Path=/; Secure"] },
      data: { miniProfile: { entityUrn: "urn:li:fs_miniProfile:ACoFixture" } },
    });
    await statusCommand({ store: root, check: true, json: true });
    expect(printData).toHaveBeenLastCalledWith([
      expect.objectContaining({ sessionStatus: "authenticated" }),
    ]);
    expect(JSON.stringify((await store.accounts.readCookies("ACoFixture"))?.cookieJar)).toContain(
      "renewed"
    );
  });

  it("reports an identity mismatch instead of authenticating the wrong account", async () => {
    await savedAccount();
    vi.mocked(axios).mockResolvedValue({
      status: 200,
      headers: {},
      data: { miniProfile: { entityUrn: "urn:li:fs_miniProfile:ACoOther" } },
    });
    await statusCommand({ store: root, check: true, json: true });
    expect(printData).toHaveBeenLastCalledWith([
      expect.objectContaining({
        sessionStatus: "error",
        sessionError: expect.stringMatching(/mismatch/i),
      }),
    ]);
  });
});
