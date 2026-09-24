import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// Exercise the standalone template's presentation seam without a browser or live CRM.
const template = readFileSync(
  new URL("../../apps/target-enrichment.html", import.meta.url),
  "utf8"
);
const helpers = template.slice(
  template.indexOf("const norm="),
  template.indexOf("function searchBlob")
);
const presentation = template.slice(
  template.indexOf("function dateParts"),
  template.indexOf("function closeSheet")
);
const outreach = template.slice(
  template.indexOf("function savedEmail"),
  template.indexOf("function openSheet")
);
const ui = runInNewContext(
  `${helpers}\n${presentation}\n${outreach}\n({displayDate,dateRange,profileDetails,latestJobChange,careerChange,careerSummary,matchesCareerFilters,savedEmail,mailtoDraft})`,
  { URL }
);
const profile = {
  linkedinUrl: "https://www.linkedin.com/in/example",
  observedAt: "2026-09-23T00:00:00Z",
  positions: [
    {
      title: "Old role",
      company: "Old Company",
      startDate: "2020",
      endDate: "2024-04",
      companyUrn: "urn:li:fsd_company:100",
    },
    {
      title: "New role",
      company: "Current Company",
      startDate: "2024-04",
      current: true,
      companyUrn: "urn:li:fsd_company:200",
    },
  ],
  education: [
    {
      school: "Example School",
      degree: "MBA",
      fieldOfStudy: "Finance",
      startDate: "2005",
      endDate: "2007",
      schoolUrn: "urn:li:fsd_school:12",
      companyUrn: "urn:li:fsd_company:300",
    },
  ],
  skills: ["Finance", { name: "Accounting" }, { unknown: "raw object" }],
};

describe("enrichment drawer presentation", () => {
  it("uses only explicit valid recipients and encodes draft parameters", () => {
    for (const invalid of [
      null,
      "javascript:alert(1)",
      "a@example.test\r\nBcc:other@example.test",
      "a@example.test,b@example.test",
    ])
      expect(ui.savedEmail(invalid)).toBe("");
    const uri = new URL(
      ui.mailtoDraft(
        "person+tag@example.test",
        "Plans & timing\nFollow-up",
        "Hi,\n\nLet's compare notes?"
      )
    );
    expect(decodeURIComponent(uri.pathname)).toBe("person+tag@example.test");
    expect(uri.searchParams.get("subject")).toBe("Plans & timing Follow-up");
    expect(uri.searchParams.get("body")).toBe("Hi,\n\nLet's compare notes?");
    expect(ui.mailtoDraft(undefined, "Check-in", "Hello")).toMatch(/^mailto:\?subject=/);
  });
  it("renders linked work and education timelines without raw provider objects", () => {
    const html = ui.profileDetails(profile);
    expect(html).toContain('datetime="2024-04">Apr 2024</time> – Present');
    expect(html).toContain('datetime="2005">2005</time> – <time datetime="2007">2007</time>');
    expect(html).toContain("MBA · Finance");
    for (const id of [100, 200, 300])
      expect(html).toContain(`https://www.linkedin.com/company/${id}/`);
    expect(html).toContain("Current role");
    expect(html).toContain("Accounting");
    expect(html).not.toMatch(/companyUrn|schoolUrn|startDate|raw object|\[object Object\]/);
  });
  it("highlights newest dated start and describes evidence for an employer move", () => {
    const html = ui.latestJobChange(profile);
    expect(html).toContain("Apr 2024");
    expect(html).toContain("New role");
    expect(html).not.toContain("Old role");
    expect(html).toContain("Employer move");
    expect(html).toContain("not independent confirmation");
  });
  it("preserves date precision and rejects invalid dates", () => {
    expect(ui.displayDate("2024")).toBe("2024");
    expect(ui.displayDate("2024-04")).toBe("Apr 2024");
    expect(ui.displayDate("2024-02-29")).toBe("Feb 29, 2024");
    for (const date of ["2024-13", "2023-02-29", "unknown", null])
      expect(ui.displayDate(date)).toBe("");
    expect(ui.dateRange(null, null)).toBe("Dates unavailable");
    expect(ui.dateRange("2024", null)).toContain("end date unavailable");
  });
  it("does not call future or undated roles the latest recorded change", () => {
    const html = ui.latestJobChange({
      ...profile,
      positions: [
        ...profile.positions,
        { title: "Future", startDate: "2027-01" },
        { title: "Undated", current: true },
      ],
    });
    expect(html).toContain("New role");
    expect(html).not.toContain("Future");
    expect(html).toContain("Some roles have no start date");
    expect(ui.latestJobChange({ positions: [] })).toContain("No dated role history available");
  });
  it("escapes text and falls back to source profile when entity IDs are missing", () => {
    const html = ui.profileDetails({
      ...profile,
      positions: [
        {
          title: '<img src=x onerror="alert(1)">',
          company: "Unknown",
          companyUrn: "javascript:alert(1)",
          description: "<script>bad()</script>",
        },
      ],
      education: [{ degree: "MBA", schoolUrn: "urn:li:fsd_school:12" }],
    });
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("/company/12");
    expect(html).toContain("School name unavailable");
    expect(html).toContain('href="https://www.linkedin.com/in/example"');
  });
  it("separates internal title changes from employer moves without claiming promotion", () => {
    const internal = {
      ...profile,
      positions: profile.positions.map((p) => ({ ...p, companyUrn: "urn:li:fsd_company:100" })),
    };
    expect(ui.careerChange(internal).kind).toBe("internal");
    expect(ui.careerChange(internal).reason).toContain(
      "Promotion versus lateral move is not established"
    );
    expect(ui.careerChange(profile).kind).toBe("employer");
  });
  it("does not infer departures from overlapping roles, missing IDs, or ambiguous dates", () => {
    const prior = profile.positions[0]!;
    const latest = profile.positions[1]!;
    expect(
      ui.careerChange({ ...profile, positions: [{ ...prior, current: true }, latest] }).kind
    ).toBe("overlap");
    expect(
      ui.careerChange({ ...profile, positions: [{ ...prior, endDate: null }, latest] }).kind
    ).toBe("unknown");
    expect(
      ui.careerChange({ ...profile, positions: [prior, { ...latest, companyUrn: null }] }).kind
    ).toBe("unknown");
    expect(
      ui.careerChange({ ...profile, positions: [{ ...prior, endDate: "2024" }, latest] }).kind
    ).toBe("unknown");
    expect(
      ui.careerChange({
        ...profile,
        positions: [prior, latest, { ...latest, title: "Concurrent" }],
      }).kind
    ).toBe("unknown");
  });
  it("filters against snapshot date and excludes uncertain date windows", () => {
    const recent = {
      ...profile,
      positions: [profile.positions[0], { ...profile.positions[1], startDate: "2026-08" }],
    };
    expect(ui.matchesCareerFilters(recent, "90", "employer")).toBe(true);
    expect(ui.matchesCareerFilters(recent, "30", "all")).toBe(false);
    expect(ui.matchesCareerFilters(recent, "90", "internal")).toBe(false);
    expect(
      ui.matchesCareerFilters(
        { ...recent, positions: [{ ...recent.positions[1], startDate: "2026" }] },
        "90",
        "all"
      )
    ).toBe(false);
    expect(ui.matchesCareerFilters({}, "90", "all")).toBe(false);
    expect(ui.matchesCareerFilters({}, "all", "all")).toBe(true);
  });
  it("constructs linked career summaries locally from recorded fields", () => {
    const html = ui.careerSummary(profile);
    expect(html).toContain("Career summary");
    expect(html).toContain("Current role:");
    expect(html).toContain("2 saved roles");
    expect(html).toContain("MBA · Finance");
    expect(html).toContain("no AI inference");
    expect(html).toContain("https://www.linkedin.com/company/200/");
  });
  it("keeps all inline scripts syntactically valid", () => {
    for (const match of template.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
      expect(() => new Function(match[1] ?? "")).not.toThrow();
  });
});
