import { afterEach, describe, expect, it } from "vitest";
import { fromDateInput, toDateInput } from "../date-input";

const original = process.env.TZ;
afterEach(() => {
  if (original === undefined) delete process.env.TZ;
  else process.env.TZ = original;
});

describe("date field", () => {
  it("round-trips a picked day in zones either side of UTC", () => {
    for (const zone of ["Australia/Sydney", "Asia/Kolkata", "America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
      process.env.TZ = zone;
      for (const day of ["2026-01-01", "2026-03-08", "2026-04-05", "2026-10-25", "2026-12-31"]) {
        expect(toDateInput(fromDateInput(day)), `${zone} ${day}`).toBe(day);
      }
    }
  });

  it("puts the picked day at local midday", () => {
    process.env.TZ = "Australia/Sydney";
    const date = fromDateInput("2026-10-04");
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 9, 4, 12]);
  });

  it("stays on the same day when read in UTC, as the server does", () => {
    // Up to 12 hours either side; Kiritimati (UTC+14) is the known exception.
    for (const zone of ["Australia/Sydney", "Asia/Kolkata", "America/Los_Angeles", "Pacific/Pago_Pago"]) {
      process.env.TZ = zone;
      const date = fromDateInput("2026-06-15");
      expect(date.toISOString().slice(0, 10), zone).toBe("2026-06-15");
    }
  });

  it("shows the day where the person is, not the day in UTC", () => {
    // 20:00 UTC on 14 June is already 15 June in Sydney.
    const moment = new Date("2026-06-14T20:00:00Z");
    process.env.TZ = "Australia/Sydney";
    expect(toDateInput(moment)).toBe("2026-06-15");
    process.env.TZ = "America/Los_Angeles";
    expect(toDateInput(moment)).toBe("2026-06-14");
  });
});
