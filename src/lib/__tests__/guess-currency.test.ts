import { describe, expect, it } from "vitest";
import { guessCurrencyFor as guessCurrency } from "../guess-currency";
import { CURRENCIES } from "../money";

describe("guessCurrency", () => {
  it("trusts the time zone over a US English phone", () => {
    expect(guessCurrency("Europe/Lisbon", "en-US")).toBe("EUR");
    expect(guessCurrency("Europe/London", "en-US")).toBe("GBP");
    expect(guessCurrency("Asia/Kolkata", "en-US")).toBe("INR");
    expect(guessCurrency("America/Toronto", "en-US")).toBe("CAD");
    expect(guessCurrency("Europe/Zurich", "de-DE")).toBe("CHF");
  });

  it("covers the whole euro area, not just the big countries", () => {
    for (const zone of ["Europe/Tallinn", "Europe/Riga", "Europe/Vilnius", "Europe/Ljubljana", "Europe/Zagreb", "Europe/Luxembourg", "Europe/Malta", "Asia/Nicosia"]) {
      expect(guessCurrency(zone, "en-US")).toBe("EUR");
    }
  });

  it("falls back to the language setting when the time zone says nothing", () => {
    expect(guessCurrency("Etc/UTC", "pt-PT")).toBe("EUR");
    expect(guessCurrency(undefined, "ja-JP")).toBe("JPY");
    expect(guessCurrency(undefined, "hi")).toBe("INR");
  });

  it("never throws and lands on dollars when it knows nothing", () => {
    expect(guessCurrency(undefined, "")).toBe("USD");
    expect(guessCurrency("Not/AZone", "not a locale!!")).toBe("USD");
    expect(guessCurrency(undefined, undefined)).toBe("USD");
  });

  it("only ever picks a currency the app supports", () => {
    const supported = new Set(CURRENCIES.map((c) => c.code));
    for (const zone of Intl.supportedValuesOf("timeZone")) {
      expect(supported.has(guessCurrency(zone, "en-US"))).toBe(true);
    }
  });
});
