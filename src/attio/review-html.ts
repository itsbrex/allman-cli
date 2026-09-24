import template from "../../apps/target-enrichment.html" with { type: "text" };
import type { reviewTargets } from "./target-matches.js";

/** Escape HTML script delimiters so CRM content cannot become executable markup. */
export function targetReviewHtml(report: ReturnType<typeof reviewTargets>) {
  if (template.split("/* ALLMAN_REPORT */null").length !== 2)
    throw new Error("Expected exactly one report placeholder in the enrichment template");
  return template.replace("/* ALLMAN_REPORT */null", () =>
    JSON.stringify(report)
      .replace(/</g, "\\u003c")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029")
  );
}
