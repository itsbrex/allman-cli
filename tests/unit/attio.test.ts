import { describe, expect, it, vi } from "vitest";
import { correlateAttio } from "@/attio/correlation.js";
import { AttioPeopleSource, exactAttioLookup, normalizeLinkedInUrl } from "@/attio/people.js";
import { contactId } from "@/mail/store.js";
import type { RelationshipContact } from "@/store/relationships.js";

const now = Date.parse("2026-09-19T23:00:00Z");
const url = "https://www.linkedin.com/in/alex-example";
const record = (id = "record-1", linkedin = url) => ({
  id: { workspace_id: "workspace", record_id: id },
  web_url: `https://app.attio.com/test/person/${id}`,
  values: {
    linkedin: [{ value: linkedin, active_until: null as string | null }],
    email_addresses: [{ email_address: "alex@example.test" }],
    name: [{ full_name: "Alex Example" }],
  },
});
const lookup = () => exactAttioLookup(url, [record()], true, new Date(now).toISOString());
const contacts = () =>
  new Map<string, RelationshipContact>([
    [
      "linkedin-person",
      {
        id: "linkedin-person",
        name: "Alex",
        linkedin: [{ account: "a", flagshipId: "ACo1" }],
        linkedinUrls: [url],
        emails: [],
        tags: [],
      },
    ],
    [
      contactId("email:alex@example.test"),
      {
        id: contactId("email:alex@example.test"),
        name: "Email",
        linkedin: [],
        emails: ["alex@example.test"],
        tags: ["VIP"],
      },
    ],
  ]);
describe("read-only Attio identity lookup", () => {
  it("normalizes vanity URL variants but rejects non-person URLs and preserves opaque IDs", () => {
    expect(normalizeLinkedInUrl("HTTP://uk.linkedin.com/in/Alex-Example/?trk=test#x")).toBe(url);
    expect(normalizeLinkedInUrl("linkedin.com/in/alex%2Dexample/")).toBe(url);
    for (const bad of [
      "https://linkedin.com.evil.test/in/alex",
      "https://www.linkedin.com/company/x",
      "https://linkedin.com/sales/lead/ACw",
      "https://linkedin.com/in/a%2Fb",
      "https://user@linkedin.com/in/alex",
    ])
      expect(normalizeLinkedInUrl(bad)).toBeNull();
    const opaque = "ACwAAACGDpABYSHW3LnQOXCrRImNYlhd0FQp3zI";
    expect(normalizeLinkedInUrl(`linkedin.com/in/${opaque}`)).toBe(
      `https://www.linkedin.com/in/${opaque}`
    );
  });
  it("rejects prefix collisions, historical attributes and duplicate people", () => {
    expect(exactAttioLookup(url, [record("r1", `${url}-other`)])).toMatchObject({
      status: "not-found",
      matches: [],
    });
    expect(exactAttioLookup(url, [record("r1"), record("r2")]).status).toBe("ambiguous");
    const old = record();
    old.values.linkedin = [{ value: url, active_until: "2020-01-01" }];
    expect(exactAttioLookup(url, [old]).status).toBe("not-found");
    expect(exactAttioLookup(url, [record()], false).status).toBe("unavailable");
  });
  it("calls only the read query endpoint and treats failures as unknown", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: [record()] })));
    const result = await new AttioPeopleSource("test-only", request).lookup(url);
    expect(result.status).toBe("matched");
    expect(request).toHaveBeenCalledWith(
      "https://api.attio.com/v2/objects/people/records/query",
      expect.objectContaining({ method: "POST", redirect: "error" })
    );
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body)).filter).toEqual({
      linkedin: { $contains: "alex-example" },
    });
    request.mockResolvedValue(new Response("secret response", { status: 403 }));
    const denied = await new AttioPeopleSource("test-only", request).lookup(url);
    expect(denied.status).toBe("unavailable");
    expect(JSON.stringify(denied)).not.toContain("secret response");
  });
  it("paginates before deciding uniqueness", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: Array.from({ length: 100 }, (_, i) => record(`noise-${i}`, `${url}-${i}`)),
          })
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [record()] })));
    expect((await new AttioPeopleSource("test-only", request).lookup(url)).status).toBe("matched");
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body)).offset).toBe(100);
  });
  it("bridges exact Attio emails to the LinkedIn person without persisting or merging by name", () => {
    const people = contacts();
    const redirects = correlateAttio(
      people,
      { schemaVersion: 1, lookups: { [url]: lookup() } },
      now
    );
    expect(redirects.get(contactId("email:alex@example.test"))).toBe("linkedin-person");
    expect(people.size).toBe(1);
    expect(people.get("linkedin-person")?.tags).toEqual(["VIP"]);
    expect(people.get("linkedin-person")?.emails).toEqual([]);
    expect(people.get("linkedin-person")?.attio?.recordId).toBe("record-1");
  });
  it("holds ambiguous, stale and manually unlinked identities for review", () => {
    for (const [item, status] of [
      [{ ...lookup(), status: "ambiguous" as const }, "ambiguous"],
      [{ ...lookup(), checkedAt: new Date(now - 86400000).toISOString() }, "stale"],
    ] as const) {
      const people = contacts();
      expect(correlateAttio(people, { schemaVersion: 1, lookups: { [url]: item } }, now).size).toBe(
        0
      );
      expect(people.get("linkedin-person")?.attio?.status).toBe(status);
    }
    const people = contacts();
    expect(
      correlateAttio(people, { schemaVersion: 1, lookups: { [url]: lookup() } }, now, ["a/ACo1"])
        .size
    ).toBe(0);
    expect(people.get("linkedin-person")?.attio?.status).toBe("unlinked");
  });
  it("never overrides a manually linked email identity", () => {
    const people = contacts(),
      email = people.get(contactId("email:alex@example.test"));
    if (email) email.linkedin = [{ account: "a", flagshipId: "someone-else" }];
    expect(
      correlateAttio(people, { schemaVersion: 1, lookups: { [url]: lookup() } }, now).size
    ).toBe(0);
    expect(people.get("linkedin-person")?.attio?.status).toBe("conflict");
  });
});
