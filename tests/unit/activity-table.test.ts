import { runInNewContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "@/activity/journal.js";
import { activityTableScript } from "@/activity/table.js";
import { activityHtml, activityScript } from "@/activity/view.js";

type Row = Record<string, string | number> & { key: string; sequence: number };
interface Preferences {
  order: string[];
  visible: string[];
  sort: { key: string; direction: string };
  density: string;
  pageSize: number;
}
interface TableModel {
  defaults(): Preferences;
  preferences(value: unknown): Preferences;
  project(runId: string, events: ActivityEvent[]): Row[];
  filter(rows: Row[], filters?: Record<string, string | boolean>, selected?: Set<string>): Row[];
  sort(rows: Row[], order: Preferences["sort"]): Row[];
  paginate(
    rows: Row[],
    page: number,
    pageSize: number
  ): { rows: Row[]; page: number; pages: number; start: number; end: number; total: number };
  move(order: string[], key: string, before?: string): string[];
  selectionState(
    rows: Row[],
    selected: Set<string>
  ): { checked: boolean; indeterminate: boolean; count: number };
  csv(rows: Row[], columns: string[]): string;
}
const table = runInNewContext(`${activityTableScript}; createActivityTableModel()`) as TableModel;
const event = (
  sequence: number,
  status: ActivityEvent["status"] = "saved",
  person: ActivityEvent["person"] = { id: "person-1", name: "Alex Example" }
): ActivityEvent => ({
  sequence,
  status,
  person,
  stage: "Deep enrichment",
  at: "2026-09-22T18:00:00Z",
});

describe("embedded event table", () => {
  it("compiles the exact served script without build-time dependencies", () => {
    expect(() => new Script(activityScript)).not.toThrow();
    const embedded = activityHtml.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(embedded).toBe(activityScript);
    expect(activityHtml).not.toMatch(/<script[^>]+src=|<link[^>]+(?:stylesheet|fonts)/);
  });

  it("keeps multiple steps per person but deduplicates replayed event IDs", () => {
    const found = event(1, "found");
    const rows = table.project("run-a", [
      found,
      found,
      event(2),
      event(3, "processing"),
      event(4, "phase"),
    ]);
    expect(rows.map((row) => row.key)).toEqual(["run-a:1", "run-a:2"]);
    expect(table.project("run-b", [found])[0]?.key).toBe("run-b:1");
  });

  it("combines filters, searches hidden fields and matches accents without conflating companies", () => {
    const rows = table.project("run", [
      event(1, "saved", {
        id: "p1",
        name: "Zoë Example",
        company: "Acme 12",
        location: "San José",
        title: "VP Strategy",
      }),
      event(2, "failed", {
        id: "p2",
        name: "Zoë Example",
        company: "Acme 2",
        location: "San Diego",
      }),
      event(3, "saved", { id: "c1", name: "Acme 12", kind: "company", location: "San José" }),
    ]);
    expect(
      table
        .filter(rows, {
          query: "zoe strategy",
          kind: "Person",
          company: "ACME",
          location: "jose",
          outcome: "saved",
          stage: "Deep enrichment",
        })
        .map((r) => r.key)
    ).toEqual(["run:1"]);
    expect(table.filter(rows, { kind: "Company" }).map((r) => r.key)).toEqual(["run:3"]);
    expect(table.filter(rows, { query: "zoe missing" })).toHaveLength(0);
    expect(
      table.filter(rows, { selectedOnly: true }, new Set(["run:2"])).map((r) => r.key)
    ).toEqual(["run:2"]);
  });

  it("sorts numeric text naturally, leaves blanks last in either direction, and preserves ties", () => {
    const rows = table.project("run", [
      event(1, "saved", { id: "p1", name: "Person 10", company: "Acme" }),
      event(2, "saved", { id: "p2", name: "Person 2", company: "Acme" }),
      event(3, "saved", { id: "p3", name: "Person 3" }),
    ]);
    expect(table.sort(rows, { key: "name", direction: "asc" }).map((r) => r.sequence)).toEqual([
      2, 3, 1,
    ]);
    for (const direction of ["asc", "desc"]) {
      expect(table.sort(rows, { key: "company", direction }).map((r) => r.sequence)).toEqual([
        1, 2, 3,
      ]);
    }
    expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3]);
  });

  it("orders dates chronologically and places invalid timestamps last", () => {
    const rows = table.project("run", [
      { ...event(1), at: "2026-09-22T09:00:00-07:00" },
      { ...event(2), at: "2026-09-22T15:30:00Z" },
      { ...event(3), at: "invalid" },
    ]);
    expect(table.sort(rows, { key: "at", direction: "asc" }).map((r) => r.sequence)).toEqual([
      2, 1, 3,
    ]);
    expect(table.sort(rows, { key: "at", direction: "desc" }).map((r) => r.sequence)).toEqual([
      1, 2, 3,
    ]);
  });

  it("recovers corrupt or old preferences without losing columns or rendering an empty table", () => {
    expect(table.preferences(null)).toEqual(table.defaults());
    const prefs = table.preferences({
      order: ["company", "company", "unknown"],
      visible: [],
      sort: { key: "bad", direction: "bad" },
      density: "bad",
      pageSize: -1,
    });
    expect(prefs.order[0]).toBe("company");
    expect(new Set(prefs.order).size).toBe(10);
    expect(prefs.visible).toEqual(table.defaults().visible);
    expect(prefs.sort).toEqual({ key: "at", direction: "desc" });
    expect(prefs.pageSize).toBe(25);
    expect(prefs.density).toBe("comfortable");
    expect(
      table.preferences({ visible: ["name", "name", "invalid"], density: "compact", pageSize: 100 })
        .visible
    ).toEqual(["name"]);
  });

  it("reorders columns at both boundaries without mutating the saved order", () => {
    const order = ["name", "company", "stage"];
    expect(table.move(order, "stage", "name")).toEqual(["stage", "name", "company"]);
    expect(table.move(order, "name")).toEqual(["company", "stage", "name"]);
    expect(table.move(order, "name", "name")).toEqual(order);
    expect(table.move(order, "bad", "company")).toEqual(order);
    expect(order).toEqual(["name", "company", "stage"]);
  });

  it("paginates, clamps stale page numbers after filters, and handles empty results", () => {
    const rows = table.project(
      "run",
      Array.from({ length: 61 }, (_, i) => event(i + 1))
    );
    const second = table.paginate(rows, 2, 25);
    expect(second.rows).toHaveLength(25);
    expect([second.start, second.end, second.pages]).toEqual([26, 50, 3]);
    expect(table.paginate(rows.slice(0, 3), 3, 25).page).toBe(1);
    expect(table.paginate([], 99, 25)).toMatchObject({
      rows: [],
      start: 0,
      end: 0,
      page: 1,
      pages: 1,
      total: 0,
    });
    expect(table.paginate(rows, -2, 8).rows).toHaveLength(25);
  });

  it("calculates select-all over filtered results across pages, ignoring hidden selections", () => {
    const rows = table.project(
      "run",
      Array.from({ length: 31 }, (_, i) => event(i + 1))
    );
    const selected = new Set(rows.slice(0, 25).map((r) => r.key));
    expect(table.selectionState(rows, selected)).toEqual({
      checked: false,
      indeterminate: true,
      count: 25,
    });
    expect(table.selectionState(rows.slice(0, 10), selected)).toEqual({
      checked: true,
      indeterminate: false,
      count: 10,
    });
    expect(table.selectionState([], selected)).toEqual({
      checked: false,
      indeterminate: false,
      count: 0,
    });
    for (const row of rows) selected.add(row.key);
    expect(table.selectionState(rows, selected).checked).toBe(true);
  });

  it("exports only chosen columns in order, quotes cells, and neutralizes spreadsheet formulas", () => {
    const rows = table.project("run", [
      event(1, "saved", {
        id: "private-id",
        name: '=HYPERLINK("bad")',
        company: 'One, "Two"\nThree',
      }),
    ]);
    const csv = table.csv(rows, ["company", "name"]);
    expect(csv).toBe(
      '"Company","Person / company"\r\n"One, ""Two""\nThree","\'=HYPERLINK(""bad"")"'
    );
    expect(csv).not.toContain("private-id");
    const first = rows[0];
    if (!first) throw new Error("Missing projected fixture");
    for (const name of [" +SUM(1)", "@SUM(1)", "-1+2", "\tformula", "\nformula"]) {
      const result = table.csv([{ ...first, name }], ["name"]);
      expect(result).toContain(`"'${name}"`);
    }
  });
});
