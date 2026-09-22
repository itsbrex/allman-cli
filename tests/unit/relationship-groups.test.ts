import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { groupsCommand } from "@/commands/groups.js";
import { readJson } from "@/store/private-workspace.js";
import { filterContacts, type RelationshipSnapshot } from "@/store/relationships.js";

const snapshot = {
  contacts: [
    { id: "a", name: "A", tags: ["buyer", "west"], emails: [], linkedin: [] },
    { id: "b", name: "B", tags: ["buyer", "east", "paused"], emails: [], linkedin: [] },
    { id: "c", name: "C", tags: ["investor", "west"], emails: [], linkedin: [] },
  ],
  timeline: [],
} as unknown as RelationshipSnapshot;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("composes OR, AND and NOT without changing existing tag semantics", () => {
  expect(
    filterContacts(snapshot, {
      anyTag: ["buyer", "investor"],
      allTags: ["west"],
      withoutTags: ["paused"],
    }).map((c) => c.id)
  ).toEqual(["a", "c"]);
  expect(
    filterContacts(snapshot, { tag: "buyer", withoutTags: ["paused"] }).map((c) => c.id)
  ).toEqual(["a"]);
  expect(filterContacts(snapshot, { allTags: ["buyer", "west"] }).map((c) => c.id)).toEqual(["a"]);
});
it("persists private groups and rejects traversal and unknown actions", async () => {
  const root = await mkdtemp(join(tmpdir(), "allman-groups-"));
  vi.stubEnv("ALLMAN_RELATIONSHIP_STORE", join(root, "private"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  const opts = {
    store: join(root, "store"),
    anyTag: ["buyer", "investor"],
    withoutTags: ["paused"],
  };
  try {
    await groupsCommand("set", "prospects", opts);
    const path = join(root, "private/relationship-settings.json");
    expect(await readJson(path, {})).toMatchObject({
      lists: { prospects: { anyTag: opts.anyTag, withoutTags: ["paused"] } },
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(groupsCommand("set", "../unsafe", opts)).rejects.toThrow("Name");
    await expect(groupsCommand("set", "__proto__", opts)).rejects.toThrow("Name");
    await expect(groupsCommand("unknown", "prospects", opts)).rejects.toThrow("Use group");
    await groupsCommand("delete", "prospects", opts);
    expect(await readJson(path, {})).toMatchObject({ lists: {} });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
