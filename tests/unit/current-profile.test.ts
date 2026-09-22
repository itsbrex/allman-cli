import { describe, expect, it, vi } from "vitest";
import { type LinkedInApiClient, LinkedInError } from "@/linkedin/api/client.js";
import { getCurrentProfile } from "@/linkedin/api/endpoints/profiles.js";

const owner = {
  entityUrn: "urn:li:fs_miniProfile:ACoOwner",
  publicIdentifier: "owner",
  firstName: "Account",
  lastName: "Owner",
  occupation: "Owner headline",
};

describe("authenticated account identity", () => {
  it.each([
    {
      data: { "*miniProfile": owner.entityUrn },
      included: [{ ...owner, entityUrn: "urn:li:fs_miniProfile:ACoOther" }, owner],
    },
    { miniProfile: owner },
  ])("resolves the owner rather than the first profile in a response", async (response) => {
    const request = vi.fn().mockResolvedValue(response);
    const profile = await getCurrentProfile({ request } as unknown as LinkedInApiClient);
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      url: "https://www.linkedin.com/voyager/api/me",
    });
    expect(profile).toMatchObject({
      urn: "urn:li:fsd_profile:ACoOwner",
      name: "Account Owner",
      headline: "Owner headline",
      profileUrl: "https://www.linkedin.com/in/owner",
    });
  });

  it.each([
    {},
    { data: {}, included: [owner] },
    { data: { miniProfile: { entityUrn: "urn:li:fs_miniProfile:ACoOwner/invalid" } } },
  ])("rejects a response that does not prove account identity", async (response) => {
    const request = vi.fn().mockResolvedValue(response);
    await expect(getCurrentProfile({ request } as unknown as LinkedInApiClient)).rejects.toThrow(
      /identity/i
    );
  });

  it("preserves authentication failures instead of treating them as missing profile fields", async () => {
    const failure = new LinkedInError("rejected", "UNAUTHENTICATED", 401);
    const request = vi.fn().mockRejectedValue(failure);
    await expect(getCurrentProfile({ request } as unknown as LinkedInApiClient)).rejects.toBe(
      failure
    );
  });
});
