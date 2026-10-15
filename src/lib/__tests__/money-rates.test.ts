import { describe, expect, it } from "vitest";
import { convert, exactRate, inverseRate } from "../money";

describe("paying a debt in another currency", () => {
  it("a full payment converts back to exactly what was owed", () => {
    // €20.00 owed, paid in dollars at about 1.08 dollars to the euro.
    const owed = 2000n;
    const paid = convert(owed, "EUR", "USD", "1.08");
    const rate = exactRate(owed, "EUR", paid, "USD");
    expect(convert(paid, "USD", "EUR", rate)).toBe(owed);
  });

  it("works between currencies with different decimal places", () => {
    for (const [owedCcy, paidCcy, approx] of [
      ["EUR", "JPY", "160"],
      ["JPY", "EUR", "0.00625"],
      ["KWD", "INR", "270"],
      ["INR", "KWD", "0.0037"],
    ] as const) {
      for (const owed of [1n, 99n, 12345n, 9999999n]) {
        const paid = convert(owed, owedCcy, paidCcy, approx);
        if (paid <= 0n) continue;
        const rate = exactRate(owed, owedCcy, paid, paidCcy);
        expect(convert(paid, paidCcy, owedCcy, rate), `${owed} ${owedCcy} paid in ${paidCcy}`).toBe(owed);
      }
    }
  });

  it("holds for many random amounts", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 2000; i++) {
      const owed = BigInt(1 + Math.floor(rand() * 5_000_000));
      const approx = (0.2 + rand() * 5).toFixed(6);
      const paid = convert(owed, "EUR", "USD", inverseRate(approx));
      if (paid <= 0n) continue;
      expect(convert(paid, "USD", "EUR", exactRate(owed, "EUR", paid, "USD"))).toBe(owed);
    }
  });

  it("gives a rate the API accepts: digits, at most 12 decimal places", () => {
    const rate = exactRate(1999n, "EUR", 2161n, "USD");
    expect(rate).toMatch(/^\d+(\.\d{1,12})?$/);
  });
});
