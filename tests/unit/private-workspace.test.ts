import { afterEach, describe, expect, it, vi } from "vitest";
import { workspaceRoot } from "@/store/private-workspace.js";

afterEach(() => vi.unstubAllEnvs());
describe("private workspace isolation", () => {
  it("keeps default mail outside the Git-backed LinkedIn store", () => {
    const root = workspaceRoot("/tmp/linkedin-store");
    expect(root).toContain("/.local/share/allman/relationship-workspaces/");
  });
  it("rejects an override nested inside the LinkedIn store", () => {
    vi.stubEnv("ALLMAN_RELATIONSHIP_STORE", "/tmp/linkedin-store/mail");
    expect(() => workspaceRoot("/tmp/linkedin-store")).toThrow("outside the LinkedIn store");
  });
});
