import { describe, expect, it } from "vitest";
import {
  abs,
  caretInGrouped,
  convert,
  currency,
  currencySymbol,
  exactRate,
  formatMoney,
  inverseRate,
  isKnownCurrency,
  parseAmount,
  readTypedAmount,
  toDecimalString,
} from "../money";

/**
 * Exact answers from the money helpers: reading what someone typed, writing
 * amounts, converting with odd rates, and currencies the app doesn't list
 * (RULES.md M3, M4, M12). Mutation testing found these edges unchecked.
 */

describe("currencies", () => {
  it("falls back to US dollars when there is no code", () => {
    const usd = { code: "USD", name: "US Dollar", symbol: "$", decimals: 2 };
    expect(currency(null)).toEqual(usd);
    expect(currency("")).toEqual(usd);
  });

  it("finds a listed currency whatever its case", () => {
    expect(currency("jpy")).toEqual(currency("JPY"));
    expect(currency("jpy").symbol).toBe("¥");
  });

  it("keeps an unlisted code usable, with its real number of decimals", () => {
    expect(currency("djf")).toEqual({ code: "DJF", name: "DJF", symbol: "DJF", decimals: 0 });
    expect(currency("tnd").decimals).toBe(3);
    expect(currency("zzz")).toEqual({ code: "ZZZ", name: "ZZZ", symbol: "ZZZ", decimals: 2 });
  });

  it("knows real currencies, listed or not, and refuses made-up ones", () => {
    expect(isKnownCurrency("eur")).toBe(true);
    expect(isKnownCurrency("btn")).toBe(true);
    expect(isKnownCurrency("zzz")).toBe(false);
  });
});

describe("reading an amount someone typed or pasted", () => {
  const cases: [string, string, bigint | null][] = [
    ["", "USD", null],
    ["abc", "USD", null],
    ["-", "USD", null],
    ["+", "USD", null],
    [".", "USD", null],
    ["₹450", "INR", 45000n],
    [" 3.5 ", "USD", 350n],
    ["-20", "USD", -2000n],
    ["+20", "USD", 2000n],
    ["1,234.56", "USD", 123456n],
    ["1.234,56", "EUR", 123456n],
    ["12,50", "EUR", 1250n],
    ["1,234", "USD", 123400n],
    ["1.234", "USD", 123n],
    ["1.234", "KWD", 1234n],
    ["1,234", "KWD", 1234n],
    ["1.2.3", "USD", 12300n],
    [".5", "USD", 50n],
    ["5.", "USD", 500n],
    ["10.005", "USD", 1001n],
    ["10.004", "USD", 1000n],
    ["1,000", "JPY", 1000n],
    ["1.5", "JPY", 2n],
    ["1.4", "JPY", 1n],
  ];
  it.each(cases)("%j in %s", (input, code, expected) => {
    expect(parseAmount(input, code)).toBe(expected);
  });

  it("refuses something that isn't text", () => {
    expect(parseAmount(12 as unknown as string, "USD")).toBeNull();
  });
});

describe("writing amounts", () => {
  it("as plain decimals", () => {
    expect(toDecimalString(0n, "USD")).toBe("0.00");
    expect(toDecimalString(5n, "USD")).toBe("0.05");
    expect(toDecimalString(-123456n, "USD")).toBe("-1234.56");
    expect(toDecimalString(1000n, "JPY")).toBe("1000");
    expect(toDecimalString(1234n, "KWD")).toBe("1.234");
  });

  it("for people to read, with a real minus sign", () => {
    expect(formatMoney(123456n, "USD")).toBe("$1,234.56");
    expect(formatMoney(-1234n, "USD")).toBe("−$12.34");
    expect(formatMoney(1234n, "USD", { signed: true })).toBe("+$12.34");
    expect(formatMoney(-1234n, "USD", { signed: true })).toBe("−$12.34");
    expect(formatMoney(0n, "USD", { signed: true })).toBe("+$0.00");
    expect(formatMoney(123456n, "USD", { bare: true })).toBe("1,234.56");
    expect(formatMoney(1234.6, "USD")).toBe("$12.35");
  });

  it("for a code the browser can't format", () => {
    expect(formatMoney(1234n, "zz")).toBe("ZZ12.34");
    expect(formatMoney(1234n, "zz", { bare: true })).toBe("12.34");
    expect(formatMoney(1200n, "zz")).toBe("ZZ12.00");
    expect(formatMoney(-1234n, "zz", { signed: true })).toBe("−ZZ12.34");
  });

  it("as a symbol beside the amount field", () => {
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("JPY")).toBe("¥");
    expect(currencySymbol("zz")).toBe("ZZ");
    // The browser's own symbol wins over the app's list, so the field matches
    // how the browser writes the amount.
    expect(currencySymbol("KWD")).toBe("KWD");
  });
});

describe("the amount field, grouped as it is typed", () => {
  it("reads a typed comma as a decimal point", () => {
    expect(readTypedAmount("1,234,", "1,234", 6)).toEqual({ text: "1234.", significant: 5 });
    expect(readTypedAmount("1,2", "12", 2)).toEqual({ text: "1.2", significant: 2 });
    expect(readTypedAmount(",1,234", "1,234", 1)).toEqual({ text: ".1234", significant: 1 });
  });

  it("deletes the digit before a drawn comma that was deleted", () => {
    expect(readTypedAmount("1234", "1,234", 1)).toEqual({ text: "234", significant: 0 });
    expect(readTypedAmount("12345", "12,345", 2)).toEqual({ text: "1345", significant: 1 });
    expect(readTypedAmount("1,234567", "1,234,567", 5)).toEqual({ text: "123567", significant: 3 });
  });

  it("deletes just the digit when a digit beside a comma is deleted", () => {
    expect(readTypedAmount("1,23", "1,234", 4)).toEqual({ text: "123", significant: 3 });
  });

  it("drops drawn commas when a digit is typed", () => {
    expect(readTypedAmount("1,2345", "1,234", 6)).toEqual({ text: "12345", significant: 5 });
    expect(readTypedAmount("12,3456", "12,345", 7)).toEqual({ text: "123456", significant: 6 });
  });

  it("reads a pasted comma as a decimal point only when it can't be grouping", () => {
    expect(readTypedAmount("12,50", "", 5)).toEqual({ text: "12.50", significant: 5 });
    expect(readTypedAmount("12,50", "", 1)).toEqual({ text: "12.50", significant: 1 });
    expect(readTypedAmount("12,50", "", 2)).toEqual({ text: "12.50", significant: 2 });
    expect(readTypedAmount("1,2345", "", 6)).toEqual({ text: "1.2345", significant: 6 });
    expect(readTypedAmount("1250", "", 4)).toEqual({ text: "1250", significant: 4 });
    expect(readTypedAmount("1,234", "", 5)).toEqual({ text: "1234", significant: 4 });
    expect(readTypedAmount("1,234,567", "", 9)).toEqual({ text: "1234567", significant: 7 });
    expect(readTypedAmount("12,5.0", "", 6)).toEqual({ text: "125.0", significant: 5 });
  });

  it("puts the caret back after the same digits", () => {
    expect(caretInGrouped("1,234.5", 0)).toBe(0);
    expect(caretInGrouped("1,234.5", 1)).toBe(1);
    expect(caretInGrouped("1,234.5", 2)).toBe(3);
    expect(caretInGrouped("1,234.5", 5)).toBe(6);
    expect(caretInGrouped("1,234.5", 6)).toBe(7);
  });
});

describe("converting", () => {
  it("leaves the same currency alone, whatever its case", () => {
    expect(convert(100n, "usd", "USD", "2")).toBe(100n);
  });

  it("reads rates written loosely", () => {
    expect(convert(1000n, "USD", "EUR", ".5")).toBe(500n);
    expect(convert(1000n, "USD", "EUR", "5.")).toBe(5000n);
    expect(convert(1000n, "USD", "EUR", 0.5)).toBe(500n);
    expect(convert(1000n, "USD", "EUR", " 0.5 ")).toBe(500n);
  });

  it("treats a rate it can't use as one to one, keeping the size right", () => {
    for (const rate of ["abc", "0", "-1", ".", "", "x1.5", "1.5x"]) {
      expect(convert(5000n, "USD", "JPY", rate)).toBe(50n);
    }
  });

  it("rounds a debt half up, the same way either side of zero", () => {
    expect(convert(-1000n, "USD", "EUR", "0.5")).toBe(-500n);
    expect(convert(1n, "USD", "EUR", "0.5")).toBe(1n);
    expect(convert(-1n, "USD", "EUR", "0.5")).toBe(-1n);
  });
});

describe("rates for paying in another currency", () => {
  it("turns a rate round", () => {
    expect(inverseRate("4")).toBe("0.250000000000");
  });

  it("rounds the exact rate to the nearest last place, without trailing zeros", () => {
    expect(exactRate(1n, "USD", 3n, "USD")).toBe("0.333333333333");
    expect(exactRate(2n, "USD", 3n, "USD")).toBe("0.666666666667");
    expect(exactRate(1n, "USD", 2n, "USD")).toBe("0.5");
    expect(exactRate(2n, "USD", 1n, "USD")).toBe("2");
  });

  it("measures a difference either way", () => {
    expect(abs(-5n)).toBe(5n);
    expect(abs(5n)).toBe(5n);
    expect(abs(0n)).toBe(0n);
  });
});
