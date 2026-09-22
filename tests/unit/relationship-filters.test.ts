import { expect, it } from "vitest";
import { relationshipScore } from "@/relationships/rank.js";
import {
  filterContacts,
  type RelationshipSnapshot,
  selectContacts,
} from "@/store/relationships.js";

const rank = relationshipScore([], 0);
const snapshot = {
  contacts: [
    {
      id: "a",
      name: "Ann",
      tags: ["buyer"],
      company: "Example",
      geo: "San Diego",
      linkedin: [{ account: "account", flagshipId: "a" }],
      rank: { ...rank, score: 60 },
      qualifications: { sales: { match: true, confidence: 0.9, freshness: "fresh" } },
    },
    {
      id: "b",
      name: "Bob",
      tags: ["buyer"],
      company: "Example",
      geo: "San Diego",
      linkedin: [],
      rank: { ...rank, score: 80 },
      qualifications: { sales: { match: true, confidence: 1, freshness: "stale" } },
    },
    {
      id: "c",
      name: "Cam",
      tags: [],
      company: "Elsewhere",
      geo: "London",
      linkedin: [],
      rank: { ...rank, score: 10, pinned: true },
      qualifications: {},
    },
  ],
  timeline: [],
} as unknown as RelationshipSnapshot;
it("composes rank, ICP, tags and location without merging scores", () => {
  expect(
    filterContacts(snapshot, {
      icp: "sales",
      tag: "buyer",
      geo: "Diego",
      minConfidence: 0.8,
      minRank: 50,
    }).map((c) => c.id)
  ).toEqual(["a"]);
  expect(filterContacts(snapshot, { icp: "sales", fit: "stale" }).map((c) => c.id)).toEqual(["b"]);
  expect(filterContacts(snapshot, { icp: "sales", fit: "unknown" }).map((c) => c.id)).toEqual([
    "c",
  ]);
  expect(filterContacts(snapshot, { sort: "rank" }).map((c) => c.id)).toEqual(["c", "b", "a"]);
});
it("includes observed account identities with no message history", () => {
  expect(
    filterContacts(snapshot, { account: "account", channel: "linkedin" }).map((c) => c.id)
  ).toEqual(["a"]);
});
it("fails on invalid or incomplete filter parameters", () => {
  expect(() => filterContacts(snapshot, { minRank: NaN })).toThrow("min-rank");
  expect(() => filterContacts(snapshot, { minConfidence: 1.1, icp: "sales" })).toThrow(
    "min-confidence"
  );
  expect(() => filterContacts(snapshot, { fit: "yes" })).toThrow("requires --icp");
});

it("saved unknown groups retain semantics and additional filters narrow them", () => {
  const grouped = {
    ...snapshot,
    lists: { unknown: { icp: "sales", fit: "unknown" as const }, buyers: { tag: "buyer" } },
  };
  expect(selectContacts(grouped, { list: "unknown" }).map((c) => c.id)).toEqual(["c"]);
  expect(selectContacts(grouped, { list: "buyers", minRank: 70 }).map((c) => c.id)).toEqual(["b"]);
  expect(() => selectContacts(grouped, { list: "constructor" })).toThrow("Unknown saved list");
});
it("confidence threshold still applies when stale results are explicitly selected", () => {
  const mixed = {
    ...snapshot,
    contacts: snapshot.contacts.map((c) =>
      c.id === "b"
        ? { ...c, qualifications: { sales: { ...c.qualifications?.sales, confidence: 0.2 } } }
        : c
    ),
  } as RelationshipSnapshot;
  expect(filterContacts(mixed, { icp: "sales", fit: "stale", minConfidence: 0.8 })).toHaveLength(0);
});
