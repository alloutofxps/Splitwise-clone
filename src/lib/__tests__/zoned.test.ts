import { describe, expect, it } from "vitest";
import { daysInMonth, fromWallClock, isValidTimeZone, wallClock } from "../zoned";

describe("wall-clock conversion", () => {
  it("reads the local time in a zone", () => {
    // 18:30 UTC on 31 Jan is 00:00 on 1 Feb in India.
    const clock = wallClock(new Date("2026-01-31T18:30:00Z"), "Asia/Kolkata");
    expect(clock).toMatchObject({ year: 2026, month: 2, day: 1, hour: 0, minute: 0 });
  });

  it("round-trips a wall time back to the same instant", () => {
    for (const zone of ["Asia/Kolkata", "America/Los_Angeles", "Europe/London", "Pacific/Kiritimati", "UTC"]) {
      const instant = new Date("2026-07-15T09:45:12Z");
      expect(fromWallClock(wallClock(instant, zone), zone).toISOString()).toBe(instant.toISOString());
    }
  });

  it("resolves midnight on the 1st in the zone, not in UTC", () => {
    const start = fromWallClock({ year: 2026, month: 3, day: 1, hour: 0, minute: 0, second: 0 }, "Asia/Kolkata");
    expect(start.toISOString()).toBe("2026-02-28T18:30:00.000Z");
  });

  it("copes with a daylight-saving gap", () => {
    // 02:30 does not exist in New York on 8 March 2026; the instant just after is fine.
    const inGap = fromWallClock({ year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 }, "America/New_York");
    expect(Number.isNaN(inGap.getTime())).toBe(false);
  });

  it("knows month lengths, including leap February", () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it("validates zone names", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});
