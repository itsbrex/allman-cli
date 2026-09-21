import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverCandidates } from "@/linkedin/auth/queryid-capture.js";

const open = vi.hoisted(() => vi.fn());
vi.mock("@/linkedin/auth/browser.js", () => ({ openBrowserContext: open }));
const cookieJar = {
  cookies: [{ key: "li_at", value: "fixture-session", domain: ".linkedin.com" }],
};
const qid = `voyagerSearchDashClusters.${"a".repeat(32)}`;
function session(kind = "persistent", cookieValue = "fixture-session") {
  const page = {
    on: vi.fn((_event, callback) =>
      callback({
        url: () => "https://static.licdn.com/aero-v1/fixture",
        headers: () => ({ "content-length": "2000000" }),
      })
    ),
    goto: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    kind,
    context: {
      newPage: vi.fn().mockResolvedValue(page),
      clearCookies: vi.fn(),
      addCookies: vi.fn(),
      cookies: vi.fn().mockResolvedValue([{ name: "li_at", value: cookieValue }]),
    },
    page,
    close: vi.fn().mockResolvedValue(undefined),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(qid)));
});
afterEach(() => vi.unstubAllGlobals());
describe("protected queryId capture", () => {
  it("passes account identity and capture purpose to the protected launcher", async () => {
    const browser = session();
    open.mockResolvedValueOnce(browser);
    await expect(discoverCandidates(cookieJar, "account-one")).resolves.toEqual([qid]);
    expect(open).toHaveBeenCalledWith({
      headless: true,
      purpose: "capture",
      identity: "account-one",
    });
    expect(browser.context.clearCookies).toHaveBeenCalledOnce();
    expect(browser.context.addCookies).toHaveBeenCalledOnce();
    expect(browser.page.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
  });
  it("uses a matching attached session without injecting or clearing cookies", async () => {
    const browser = session("cdp");
    open.mockResolvedValueOnce(browser);
    await expect(discoverCandidates(cookieJar)).resolves.toEqual([qid]);
    expect(browser.context.clearCookies).not.toHaveBeenCalled();
    expect(browser.context.addCookies).not.toHaveBeenCalled();
    expect(browser.page.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
  });
  it("refuses mismatched CDP identity before navigation and disconnects", async () => {
    const browser = session("cdp", "other-session");
    open.mockResolvedValueOnce(browser);
    await expect(discoverCandidates(cookieJar)).rejects.toThrow(
      "different or unknown LinkedIn session"
    );
    expect(browser.context.newPage).not.toHaveBeenCalled();
    expect(browser.context.addCookies).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });
});
