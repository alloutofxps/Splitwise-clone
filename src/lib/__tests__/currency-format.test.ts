import { describe, expect, it } from "vitest";
import { currencyFormat, formatMoney, toDecimalString } from "../money";

/**
 * The rolling figure (components/ui/rolling-figure.tsx) hands NumberFlow a
 * number and these Intl options. What it shows must be exactly what
 * formatMoney writes everywhere else, or the figure would change its look the
 * moment NumberFlow takes over.
 */
describe("currencyFormat", () => {
  const cases: [string, bigint][] = [
    ["EUR", 3140n],
    ["EUR", 0n],
    ["EUR", 123456789n],
    ["USD", 5n],
    ["GBP", 99999n],
    ["JPY", 4800n],
    ["INR", 1234567n],
    ["KWD", 12345n],
  ];

  it.each(cases)("writes %s %s the way formatMoney does", (code, minor) => {
    const rolled = new Intl.NumberFormat("en-US", currencyFormat(code)).format(Number(toDecimalString(minor, code)));
    expect(rolled).toBe(formatMoney(minor, code));
  });
});
