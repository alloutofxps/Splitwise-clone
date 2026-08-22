import { describe, expect, it } from "vitest";
import { beforeCursor, compareDesc, encodeCursor, parseCursor } from "../cursor";

const iso = "2026-03-14T20:15:00.000Z";

describe("cursor round trip", () => {
  it("survives encode and parse", () => {
    const parsed = parseCursor(encodeCursor(new Date(iso), "exp_abc"));
    expect(parsed?.time.toISOString()).toBe(iso);
    expect(parsed?.id).toBe("exp_abc");
  });

  it("accepts a Date or an ISO string", () => {
    expect(encodeCursor(new Date(iso), "x")).toBe(encodeCursor(iso, "x"));
  });

  it("splits on the first separator, so an id containing one survives", () => {
    const parsed = parseCursor(encodeCursor(iso, "exp|weird"));
    expect(parsed?.time.toISOString()).toBe(iso);
    expect(parsed?.id).toBe("exp|weird");
  });

  it("returns null rather than throwing on junk", () => {
    expect(parseCursor(null)).toBeNull();
    expect(parseCursor("")).toBeNull();
    expect(parseCursor("not-a-date|exp_1")).toBeNull();
    expect(parseCursor("banana")).toBeNull();
  });

  it("honours a bare timestamp from the older API", () => {
    const parsed = parseCursor(iso);
    expect(parsed?.time.toISOString()).toBe(iso);
    expect(parsed?.id).toBe("");
  });
});

describe("beforeCursor", () => {
  it("is empty with no cursor, so it can be spread unconditionally", () => {
    expect(beforeCursor("date", null)).toEqual([]);
  });

  it("degrades to a bare lt for a legacy cursor", () => {
    const [clause] = beforeCursor("date", parseCursor(iso));
    expect(clause).toEqual({ date: { lt: new Date(iso) } });
  });

  it("keeps ties reachable by tiebreaking on id", () => {
    const [clause] = beforeCursor("date", parseCursor(encodeCursor(iso, "exp_m")));
    expect(clause).toEqual({
      OR: [
        { date: { lt: new Date(iso) } },
        { date: new Date(iso), id: { lt: "exp_m" } },
      ],
    });
  });

  it("targets whichever timestamp column the table uses", () => {
    const [clause] = beforeCursor("createdAt", parseCursor(encodeCursor(iso, "act_1")));
    expect(Object.keys(clause)).toEqual(["OR"]);
    expect(JSON.stringify(clause)).toContain("createdAt");
  });
});

describe("compareDesc", () => {
  const row = (date: string, id: string) => ({ date, id });

  it("orders newest first", () => {
    expect(compareDesc(row("2026-03-14", "a"), row("2026-03-13", "a"))).toBeLessThan(0);
    expect(compareDesc(row("2026-03-13", "a"), row("2026-03-14", "a"))).toBeGreaterThan(0);
  });

  it("breaks ties on id, descending", () => {
    expect(compareDesc(row(iso, "exp_b"), row(iso, "exp_a"))).toBeLessThan(0);
    expect(compareDesc(row(iso, "exp_a"), row(iso, "exp_b"))).toBeGreaterThan(0);
    expect(compareDesc(row(iso, "exp_a"), row(iso, "exp_a"))).toBe(0);
  });

  /**
   * The property that actually matters. Paging works only if the comparator
   * and the cursor filter describe the same order: every row the merge places
   * after the cursor row must be one the filter would admit, and every row
   * placed before it must be one the filter would reject.
   */
  it("agrees with the filter it pages against", () => {
    const rows = [
      row("2026-03-14T20:15:00.000Z", "exp_c"),
      row("2026-03-14T20:15:00.000Z", "exp_b"),
      row("2026-03-14T20:15:00.000Z", "stl_a"),
      row("2026-03-13T09:00:00.000Z", "exp_z"),
    ];
    const sorted = [...rows].sort(compareDesc);

    // Page on the second row and confirm the rest are exactly the tail.
    const cursorRow = sorted[1];
    const cursor = parseCursor(encodeCursor(cursorRow.date, cursorRow.id))!;

    const admits = (candidate: { date: string; id: string }) => {
      const time = new Date(candidate.date).getTime();
      const at = cursor.time.getTime();
      return time < at || (time === at && candidate.id < cursor.id);
    };

    expect(sorted.slice(2).every(admits)).toBe(true);
    expect(sorted.slice(0, 2).some(admits)).toBe(false);
  });
});
