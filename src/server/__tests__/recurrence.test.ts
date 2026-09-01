import { describe, expect, it } from "vitest";
import { nextOccurrence, occurrenceExpenseId } from "../recurrence";
import type { RecurrenceFrequency } from "@/lib/types";

/**
 * Date arithmetic for recurring expenses.
 *
 * This is the part of the app most likely to be quietly wrong: month stepping
 * has no natural definition for the 31st, JavaScript's `setMonth` overflows
 * rather than clamping, and nobody notices until the rent posts on March 3rd.
 *
 * Dates are constructed with the local-time `new Date(y, m, d)` form throughout,
 * because that is what the implementation manipulates (`getDate`, `setMonth`).
 * Using ISO strings here would test the runtime's timezone, not the logic.
 */

const on = (year: number, month1: number, day: number) =>
  new Date(year, month1 - 1, day);

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const step = (
  from: Date,
  frequency: RecurrenceFrequency,
  interval = 1,
  anchorDay?: number | null,
) => iso(nextOccurrence(from, frequency, interval, anchorDay));

describe("nextOccurrence: simple periods", () => {
  it("advances by days, weeks and fortnights", () => {
    expect(step(on(2026, 3, 14), "DAILY")).toBe("2026-03-15");
    expect(step(on(2026, 3, 14), "WEEKLY")).toBe("2026-03-21");
    expect(step(on(2026, 3, 14), "BIWEEKLY")).toBe("2026-03-28");
  });

  it("multiplies by the interval", () => {
    expect(step(on(2026, 3, 1), "DAILY", 10)).toBe("2026-03-11");
    expect(step(on(2026, 3, 1), "WEEKLY", 2)).toBe("2026-03-15");
    expect(step(on(2026, 3, 1), "BIWEEKLY", 2)).toBe("2026-03-29");
  });

  it("treats a zero or negative interval as one, rather than never advancing", () => {
    // A recurrence with interval 0 would otherwise loop on the same date until
    // the catch-up cap, posting sixty copies of the same expense.
    expect(step(on(2026, 3, 14), "DAILY", 0)).toBe("2026-03-15");
    expect(step(on(2026, 3, 14), "DAILY", -5)).toBe("2026-03-15");
    expect(step(on(2026, 1, 31), "MONTHLY", 0)).toBe("2026-02-28");
  });

  it("carries across month and year boundaries", () => {
    expect(step(on(2026, 12, 28), "WEEKLY")).toBe("2027-01-04");
    expect(step(on(2026, 1, 30), "BIWEEKLY")).toBe("2026-02-13");
  });
});

describe("nextOccurrence: month clamping", () => {
  it("clamps the 31st into a 30-day month", () => {
    expect(step(on(2026, 3, 31), "MONTHLY")).toBe("2026-04-30");
  });

  it("clamps the 31st into February", () => {
    expect(step(on(2026, 1, 31), "MONTHLY")).toBe("2026-02-28");
  });

  it("clamps to the 29th in a leap February", () => {
    expect(step(on(2028, 1, 31), "MONTHLY")).toBe("2028-02-29");
  });

  /**
   * The reason `anchorDay` exists. Without it, a rent anchored on the 31st is
   * clamped to the 28th in February and then stays on the 28th forever, having
   * silently lost four days a year. With it, every month reads the original
   * anchor and recovers.
   */
  it("recovers the anchor day after a clamp", () => {
    expect(step(on(2026, 2, 28), "MONTHLY", 1, 31)).toBe("2026-03-31");
    expect(step(on(2026, 4, 30), "MONTHLY", 1, 31)).toBe("2026-05-31");
  });

  it("does not skip a month when stepping from the 31st", () => {
    // Naive `setMonth(+1)` on the 31st of January lands in March. Every step
    // here must advance by exactly one month.
    let cursor = on(2026, 1, 31);
    const months: number[] = [];
    for (let i = 0; i < 12; i++) {
      cursor = nextOccurrence(cursor, "MONTHLY", 1, 31);
      months.push(cursor.getMonth() + 1);
    }
    expect(months).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1]);
  });

  it("steps quarters and years, clamping the same way", () => {
    expect(step(on(2026, 3, 14), "QUARTERLY")).toBe("2026-06-14");
    expect(step(on(2026, 11, 30), "QUARTERLY")).toBe("2027-02-28");
    expect(step(on(2026, 3, 14), "YEARLY")).toBe("2027-03-14");
    expect(step(on(2028, 2, 29), "YEARLY")).toBe("2029-02-28");
  });

  it("keeps a mid-month day untouched", () => {
    expect(step(on(2026, 1, 15), "MONTHLY")).toBe("2026-02-15");
    expect(step(on(2026, 1, 1), "MONTHLY")).toBe("2026-02-01");
  });
});

describe("nextOccurrence: invariants", () => {
  it("always moves forward, for every frequency and anchor", () => {
    const frequencies: RecurrenceFrequency[] = [
      "DAILY",
      "WEEKLY",
      "BIWEEKLY",
      "MONTHLY",
      "QUARTERLY",
      "YEARLY",
    ];

    // Every day of a leap year, against every frequency and a 31st anchor.
    for (const frequency of frequencies) {
      for (const anchor of [null, 1, 28, 29, 30, 31]) {
        let cursor = on(2028, 1, 1);
        for (let day = 0; day < 366; day++) {
          const next = nextOccurrence(cursor, frequency, 1, anchor);
          expect(next.getTime()).toBeGreaterThan(cursor.getTime());
          cursor = next;
        }
      }
    }
  });

  it("preserves the time of day, so a due date does not drift", () => {
    const at = new Date(2026, 0, 31, 9, 30, 0, 0);
    const next = nextOccurrence(at, "MONTHLY", 1, 31);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(30);
  });
});

describe("occurrenceExpenseId", () => {
  it("is stable for the same recurrence and date", () => {
    const date = new Date("2026-03-14T20:15:00.000Z");
    expect(occurrenceExpenseId("rec_1", date)).toBe(occurrenceExpenseId("rec_1", date));
  });

  /**
   * This is what makes catch-up idempotent: two people opening the app at once
   * compute the same primary key, so the second insert collides instead of
   * filing a second copy of the rent.
   */
  it("ignores the time of day, so racing callers agree", () => {
    const morning = new Date("2026-03-14T00:00:01.000Z");
    const evening = new Date("2026-03-14T23:59:59.000Z");
    expect(occurrenceExpenseId("rec_1", morning)).toBe(
      occurrenceExpenseId("rec_1", evening),
    );
  });

  it("differs across dates and across recurrences", () => {
    const date = new Date("2026-03-14T12:00:00.000Z");
    const other = new Date("2026-03-15T12:00:00.000Z");
    expect(occurrenceExpenseId("rec_1", date)).not.toBe(
      occurrenceExpenseId("rec_1", other),
    );
    expect(occurrenceExpenseId("rec_1", date)).not.toBe(
      occurrenceExpenseId("rec_2", date),
    );
  });
});
