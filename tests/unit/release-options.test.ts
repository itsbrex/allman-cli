import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { VERSION } from "@/version.js";
import {
  assertPublicationTarget,
  releaseOptions,
  repositoryFromRemote,
} from "../../scripts/release-options.ts";

it("defaults to local packaging and requires explicit publication target", () => {
  expect(releaseOptions(["2026-09-22.1-beta"]).dryRun).toBe(true);
  expect(() => releaseOptions(["2026-09-22.1-beta", "--publish"])).toThrow("repository");
  expect(() =>
    releaseOptions(["2026-09-22.1-beta", "--publish", "--dry-run", "--repo", "owner/repo"])
  ).toThrow("mutually");
  expect(releaseOptions(["--repo", "owner/repo", "2026-09-22.1-beta", "--publish"])).toMatchObject({
    dryRun: false,
    repo: "owner/repo",
  });
});
it("cannot accidentally publish fork artifacts to a different remote", () => {
  expect(repositoryFromRemote("git@github.com:itsbrex/allman-cli.git")).toBe("itsbrex/allman-cli");
  expect(() =>
    assertPublicationTarget(
      "tarkaai/allman-cli",
      "https://github.com/itsbrex/allman-cli.git",
      "git@github.com:itsbrex/allman-cli.git"
    )
  ).toThrow("both origin");
  expect(() =>
    assertPublicationTarget(
      "itsbrex/allman-cli",
      "https://github.com/itsbrex/allman-cli.git",
      "git@github.com:tarkaai/allman-cli.git"
    )
  ).toThrow("both origin");
  expect(() =>
    assertPublicationTarget(
      "itsbrex/allman-cli",
      "https://github.com/itsbrex/allman-cli.git",
      "git@github.com:itsbrex/allman-cli.git"
    )
  ).not.toThrow();
  expect(() => repositoryFromRemote("https://github.com.evil.test/owner/repo")).toThrow("GitHub");
});
it("keeps executable and package versions aligned", () => {
  expect(
    JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version
  ).toBe(VERSION);
});
