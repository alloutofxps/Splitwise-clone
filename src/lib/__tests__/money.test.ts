import { describe, expect, it } from "vitest";
import {
  convert,
  currency,
  formatMoney,
  minorUnitScale,
  parseAmount,
  toDecimalString,
} from "../money";

describe("currency metadata", () => {
  it("knows the zero- and three-decimal currencies", () => {
    expect(currency("JPY").decimals).toBe(0);
    expect(currency("KWD").decimals).toBe(3);
    expect(currency("USD").decimals).toBe(2);
    expect(minorUnitScale("BHD")).toBe(1000n);
    expect(minorUnitScale("KRW")).toBe(1n);
  });

  it("degrades gracefully for an unlisted code", () => {
    const info = currency("XYZ");
    expect(info.code).toBe("XYZ");
    expect(info.decimals).toBe(2);
  });
});

describe("parseAmount", () => {
  it("reads plain decimals", () => {
    expect(parseAmount("12.34", "USD")).toBe(1234n);
    expect(parseAmount("12", "USD")).toBe(1200n);
    expect(parseAmount("0.05", "USD")).toBe(5n);
    expect(parseAmount(".5", "USD")).toBe(50n);
  });

  it("handles both grouping conventions", () => {
    expect(parseAmount("1,234.56", "USD")).toBe(123456n);
    expect(parseAmount("1.234,56", "EUR")).toBe(123456n);
    expect(parseAmount("1,234", "USD")).toBe(123400n);
  });

  it("treats a short trailing group as a decimal", () => {
    // "1,23" cannot be grouping - there are only two digits after the comma.
    expect(parseAmount("1,23", "USD")).toBe(123n);
  });

  it("resolves a lone dot before three digits as a decimal point", () => {
    // Ambiguous between 1234 and 1.234. Reading a decimal point as grouping
    // would inflate the amount a thousandfold, so the parser takes the
    // cautious branch; the composer's input mask stops anyone typing this.
    expect(parseAmount("1.234", "USD")).toBe(123n);
    expect(parseAmount("10.005", "USD")).toBe(1001n);
    // A repeated separator can only be grouping.
    expect(parseAmount("1.234.567", "USD")).toBe(123456700n);
  });

  it("uses three decimals when the currency has them", () => {
    expect(parseAmount("1.234", "KWD")).toBe(1234n);
    expect(parseAmount("1,234", "KWD")).toBe(1234n);
  });

  it("respects the currency's decimal places", () => {
    expect(parseAmount("1200", "JPY")).toBe(1200n);
    expect(parseAmount("1200.7", "JPY")).toBe(1201n);
    expect(parseAmount("1.2345", "KWD")).toBe(1235n);
  });

  it("rounds half-up on the first dropped digit", () => {
    expect(parseAmount("10.005", "USD")).toBe(1001n);
    expect(parseAmount("10.004", "USD")).toBe(1000n);
  });

  it("strips symbols and whitespace", () => {
    expect(parseAmount("  $ 42.50 ", "USD")).toBe(4250n);
    expect(parseAmount("₹1,499", "INR")).toBe(149900n);
  });

  it("keeps a leading minus", () => {
    expect(parseAmount("-20", "USD")).toBe(-2000n);
  });

  it("returns null for input that is not a number", () => {
    expect(parseAmount("", "USD")).toBeNull();
    expect(parseAmount("abc", "USD")).toBeNull();
    expect(parseAmount("$", "USD")).toBeNull();
  });
});

describe("toDecimalString", () => {
  it("round-trips through parseAmount", () => {
    for (const [value, code] of [
      [123456n, "USD"],
      [1200n, "JPY"],
      [1234n, "KWD"],
      [-999n, "EUR"],
      [0n, "USD"],
    ] as const) {
      expect(parseAmount(toDecimalString(value, code), code)).toBe(value);
    }
  });

  it("pads the fractional part", () => {
    expect(toDecimalString(5n, "USD")).toBe("0.05");
    expect(toDecimalString(1n, "KWD")).toBe("0.001");
    expect(toDecimalString(1200n, "JPY")).toBe("1200");
  });
});

describe("formatMoney", () => {
  it("renders the right number of decimals per currency", () => {
    expect(formatMoney(123456n, "USD")).toContain("1,234.56");
    expect(formatMoney(1200n, "JPY")).toContain("1,200");
    expect(formatMoney(1200n, "JPY")).not.toContain(".");
  });

  it("uses a real minus sign for negatives", () => {
    expect(formatMoney(-500n, "USD").startsWith("−")).toBe(true);
  });

  it("can drop the symbol and trailing zeros", () => {
    expect(formatMoney(2000n, "USD", { bare: true, trimZeros: true })).toBe("20");
  });
});

describe("convert", () => {
  it("is a no-op for matching currencies", () => {
    expect(convert(12345n, "USD", "USD", "1.234")).toBe(12345n);
  });

  it("scales between currencies with the same decimals", () => {
    // 100.00 USD at 0.92 -> 92.00 EUR
    expect(convert(10000n, "USD", "EUR", "0.92")).toBe(9200n);
  });

  it("crosses a decimal-place boundary", () => {
    // 10.00 USD at 150 JPY/USD -> 1500 yen, which has no minor unit.
    expect(convert(1000n, "USD", "JPY", "150")).toBe(1500n);
    // 1500 yen back at 1/150 -> 10.00 USD
    expect(convert(1500n, "JPY", "USD", "0.006666666667")).toBe(1000n);
  });

  it("rounds half-up rather than truncating", () => {
    // 1.00 USD at 1.005 -> 1.005 EUR, which must land on 1.01 not 1.00.
    expect(convert(100n, "USD", "EUR", "1.005")).toBe(101n);
  });

  it("preserves sign", () => {
    expect(convert(-10000n, "USD", "EUR", "0.92")).toBe(-9200n);
  });
});
