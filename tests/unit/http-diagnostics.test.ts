import { expect, it } from "vitest";
import { requestEndpoint, retryAfterSeconds } from "@/utils/http-diagnostics.js";

it("parses HTTP dates and rejects invalid Retry-After without guessing", () => {
  const now = Date.parse("2026-09-24T20:00:00Z");
  expect(retryAfterSeconds("Thu, 24 Sep 2026 20:02:00 GMT", now)).toBe(120);
  expect(retryAfterSeconds("Thu, 24 Sep 2026 19:00:00 GMT", now)).toBe(0);
  for (const value of ["-1", "1.5", "", [], "9007199254740992", "unknown"])
    expect(retryAfterSeconds(value, now)).toBeUndefined();
});
it("keeps credentials and query values out of request diagnostics", () => {
  expect(
    requestEndpoint("https://www.linkedin.com/sales-api/profiles/(id:123,authToken:secret)")
  ).not.toContain("secret");
  expect(
    requestEndpoint("https://user:secret@www.linkedin.com/sales-api/fixture?token=secret#secret")
  ).toBe("https://www.linkedin.com/sales-api/fixture");
});
