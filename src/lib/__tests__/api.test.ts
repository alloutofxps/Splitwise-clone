import { describe, expect, it } from "vitest";
import { MAX_MINOR_UNITS, parseMinorUnits } from "@/lib/api";

/**
 * The money boundary.
 *
 * `MAX_MINOR_UNITS` is not a product limit, it is the point where the pipeline
 * stops being lossless: apportionment converts amounts to `number` to use as
 * weights, and a `number` holds integers exactly only up to 2^53-1. These
 * tests pin the boundary itself, because moving it silently reintroduces
 * float error into balances.
 */
describe("parseMinorUnits", () => {
  it("accepts the usual shapes", () => {
    expect(parseMinorUnits("1000")).toBe(1000n);
    expect(parseMinorUnits(" -250 ")).toBe(-250n);
    expect(parseMinorUnits(1000)).toBe(1000n);
    expect(parseMinorUnits(1000n)).toBe(1000n);
  });

  it("accepts the largest exactly representable amount", () => {
    expect(parseMinorUnits(MAX_MINOR_UNITS.toString())).toBe(MAX_MINOR_UNITS);
    expect(parseMinorUnits((-MAX_MINOR_UNITS).toString())).toBe(-MAX_MINOR_UNITS);
  });

  it("refuses one unit past it, in either direction", () => {
    // This exact value used to persist and then come back a minor unit short.
    expect(() => parseMinorUnits((MAX_MINOR_UNITS + 1n).toString())).toThrow(/too large/);
    expect(() => parseMinorUnits((-MAX_MINOR_UNITS - 1n).toString())).toThrow(/too large/);
  });

  it("refuses an amount past the database's own range, as a 422 not a 500", () => {
    // SQLite's 64-bit column used to be the only thing catching this, which
    // surfaced as an opaque server error.
    expect(() => parseMinorUnits("9".repeat(400))).toThrow(/too large/);
  });

  it("refuses shapes that are not whole minor units", () => {
    expect(() => parseMinorUnits("10.5")).toThrow();
    expect(() => parseMinorUnits(10.5)).toThrow();
    expect(() => parseMinorUnits("abc")).toThrow();
    expect(() => parseMinorUnits(null)).toThrow();
  });
});
