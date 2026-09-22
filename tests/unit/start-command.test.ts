import { beforeEach, describe, expect, it, vi } from "vitest";
import { listenCommand } from "@/commands/listen.js";
import { loginCommand } from "@/commands/login.js";
import { startCommand } from "@/commands/start.js";
import { syncCommand } from "@/commands/sync.js";
import { LinkedInError } from "@/linkedin/api/client.js";
import { loadSession } from "@/linkedin/api/session.js";

vi.mock("@/store/index.js", () => ({
  resolveStorePath: () => "/fixture-store",
  Store: class {
    init = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock("@/linkedin/api/session.js", () => ({ loadSession: vi.fn() }));
vi.mock("@/commands/login.js", () => ({ loginCommand: vi.fn() }));
vi.mock("@/commands/sync.js", () => ({ syncCommand: vi.fn() }));
vi.mock("@/commands/listen.js", () => ({ listenCommand: vi.fn() }));
vi.mock("@/utils/output.js", () => ({ info: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadSession).mockResolvedValue({
    profileId: "ACoOwner",
    accountRecord: { requestIdentity: { mpVersion: "1.13.46745" } },
  } as Awaited<ReturnType<typeof loadSession>>);
});

describe("start session recovery", () => {
  it("refreshes older exports before realtime needs the captured application version", async () => {
    vi.mocked(loadSession).mockResolvedValue({
      profileId: "ACoOwner",
      accountRecord: {},
    } as Awaited<ReturnType<typeof loadSession>>);
    await startCommand({ store: "/fixture-store" });
    expect(loginCommand).toHaveBeenCalledExactlyOnceWith({
      account: "ACoOwner",
      store: "/fixture-store",
    });
    expect(syncCommand).toHaveBeenCalledOnce();
    expect(listenCommand).toHaveBeenCalledOnce();
  });
  it("refreshes a rejected saved session once, bound to the original account, then resumes sync and listen", async () => {
    vi.mocked(syncCommand).mockRejectedValueOnce(
      new LinkedInError("rejected", "UNAUTHENTICATED", 401)
    );
    await startCommand({ store: "/fixture-store" });
    expect(loginCommand).toHaveBeenCalledExactlyOnceWith({
      account: "ACoOwner",
      store: "/fixture-store",
    });
    expect(syncCommand).toHaveBeenCalledTimes(2);
    expect(listenCommand).toHaveBeenCalledOnce();
  });

  it("does not loop or start listening if the refreshed session is still rejected", async () => {
    const rejected = new LinkedInError("rejected", "UNAUTHENTICATED", 401);
    vi.mocked(syncCommand).mockRejectedValue(rejected);
    await expect(startCommand({ store: "/fixture-store" })).rejects.toBe(rejected);
    expect(loginCommand).toHaveBeenCalledOnce();
    expect(syncCommand).toHaveBeenCalledTimes(2);
    expect(listenCommand).not.toHaveBeenCalled();
  });

  it.each([
    "RATE_LIMITED",
    "FORBIDDEN",
    "NETWORK_ERROR",
  ] as const)("does not re-login on %s", async (code) => {
    const failure = new LinkedInError("request failed", code);
    vi.mocked(syncCommand).mockRejectedValue(failure);
    await expect(startCommand({ store: "/fixture-store" })).rejects.toBe(failure);
    expect(loginCommand).not.toHaveBeenCalled();
    expect(listenCommand).not.toHaveBeenCalled();
  });

  it("never attempts a second login after initial authentication was required", async () => {
    vi.mocked(loadSession).mockRejectedValue(new Error("Account not authenticated"));
    vi.mocked(syncCommand).mockRejectedValue(new LinkedInError("rejected", "UNAUTHENTICATED", 401));
    await expect(startCommand({ account: "owner", store: "/fixture-store" })).rejects.toThrow(
      "rejected"
    );
    expect(loginCommand).toHaveBeenCalledOnce();
  });
});
