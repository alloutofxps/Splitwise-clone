/**
 * Money handling for Divvy.
 *
 * Every amount in the system is an integer count of a currency's *minor unit*
 * — cents for USD, paise for INR, whole yen for JPY, fils for KWD. Floats never
 * touch a stored amount, so 0.1 + 0.2 problems cannot reach a balance.
 *
 * The public type is `bigint` because SQLite/Prisma hand back BigInt for the
 * columns, and because a long-running group can accumulate more minor units
 * than a float64 can represent exactly (2^53 paise is only ~90bn INR, which a
 * shared holiday will not hit, but a JPY-denominated group could).
 */

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  /** Number of decimal places, i.e. log10(minor units per major unit). */
  decimals: number;
}

/**
 * Currencies with anything other than 2 decimal places, per ISO 4217. Every
 * other currency is assumed to have 2, which is correct for all of them.
 */
const IRREGULAR_DECIMALS: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

/** Curated list — the ones people actually split bills in, plus the majors. */
export const CURRENCIES: CurrencyInfo[] = (
  [
    ["USD", "US Dollar", "$"],
    ["EUR", "Euro", "€"],
    ["GBP", "British Pound", "£"],
    ["INR", "Indian Rupee", "₹"],
    ["JPY", "Japanese Yen", "¥"],
    ["AUD", "Australian Dollar", "A$"],
    ["CAD", "Canadian Dollar", "C$"],
    ["CHF", "Swiss Franc", "CHF"],
    ["CNY", "Chinese Yuan", "¥"],
    ["SGD", "Singapore Dollar", "S$"],
    ["HKD", "Hong Kong Dollar", "HK$"],
    ["NZD", "New Zealand Dollar", "NZ$"],
    ["SEK", "Swedish Krona", "kr"],
    ["NOK", "Norwegian Krone", "kr"],
    ["DKK", "Danish Krone", "kr"],
    ["PLN", "Polish Zloty", "zł"],
    ["CZK", "Czech Koruna", "Kč"],
    ["HUF", "Hungarian Forint", "Ft"],
    ["RON", "Romanian Leu", "lei"],
    ["TRY", "Turkish Lira", "₺"],
    ["RUB", "Russian Ruble", "₽"],
    ["UAH", "Ukrainian Hryvnia", "₴"],
    ["AED", "UAE Dirham", "د.إ"],
    ["SAR", "Saudi Riyal", "﷼"],
    ["QAR", "Qatari Riyal", "﷼"],
    ["KWD", "Kuwaiti Dinar", "د.ك"],
    ["BHD", "Bahraini Dinar", ".د.ب"],
    ["OMR", "Omani Rial", "﷼"],
    ["ILS", "Israeli Shekel", "₪"],
    ["EGP", "Egyptian Pound", "E£"],
    ["ZAR", "South African Rand", "R"],
    ["NGN", "Nigerian Naira", "₦"],
    ["KES", "Kenyan Shilling", "KSh"],
    ["GHS", "Ghanaian Cedi", "₵"],
    ["MAD", "Moroccan Dirham", "د.م."],
    ["BRL", "Brazilian Real", "R$"],
    ["MXN", "Mexican Peso", "Mex$"],
    ["ARS", "Argentine Peso", "$"],
    ["CLP", "Chilean Peso", "$"],
    ["COP", "Colombian Peso", "$"],
    ["PEN", "Peruvian Sol", "S/"],
    ["KRW", "South Korean Won", "₩"],
    ["TWD", "Taiwan Dollar", "NT$"],
    ["THB", "Thai Baht", "฿"],
    ["VND", "Vietnamese Dong", "₫"],
    ["IDR", "Indonesian Rupiah", "Rp"],
    ["MYR", "Malaysian Ringgit", "RM"],
    ["PHP", "Philippine Peso", "₱"],
    ["PKR", "Pakistani Rupee", "₨"],
    ["BDT", "Bangladeshi Taka", "৳"],
    ["LKR", "Sri Lankan Rupee", "Rs"],
    ["NPR", "Nepalese Rupee", "रू"],
    ["ISK", "Icelandic Krona", "kr"],
    ["RSD", "Serbian Dinar", "дин"],
    ["BGN", "Bulgarian Lev", "лв"],
    ["HRK", "Croatian Kuna", "kn"],
  ] as const
).map(([code, name, symbol]) => ({
  code,
  name,
  symbol,
  decimals: IRREGULAR_DECIMALS[code] ?? 2,
}));

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

const FALLBACK: CurrencyInfo = {
  code: "USD",
  name: "US Dollar",
  symbol: "$",
  decimals: 2,
};

export function currency(code: string | null | undefined): CurrencyInfo {
  if (!code) return FALLBACK;
  const known = BY_CODE.get(code.toUpperCase());
  if (known) return known;
  // Unknown but well-formed code: still usable, just without a nice symbol.
  return {
    code: code.toUpperCase(),
    name: code.toUpperCase(),
    symbol: code.toUpperCase(),
    decimals: IRREGULAR_DECIMALS[code.toUpperCase()] ?? 2,
  };
}

let isoCodes: Set<string> | null = null;

/**
 * Whether `code` is a real ISO 4217 currency.
 *
 * `currency()` above deliberately tolerates unknown codes so old data still
 * renders, which meant the API's "is this a valid currency" check - comparing
 * the code with `currency(code).code` - could never fail: "ZZZ" went straight
 * into a group or an expense. This is the check that can.
 */
export function isKnownCurrency(code: string): boolean {
  const upper = code.toUpperCase();
  if (BY_CODE.has(upper)) return true;
  if (!isoCodes) {
    try {
      isoCodes = new Set(Intl.supportedValuesOf("currency"));
    } catch {
      isoCodes = new Set();
    }
  }
  return isoCodes.has(upper);
}

export function decimalsFor(code: string): number {
  return currency(code).decimals;
}

/** 10 ** decimals, as a bigint. */
export function minorUnitScale(code: string): bigint {
  return 10n ** BigInt(decimalsFor(code));
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Turns user input into minor units.
 *
 * Deliberately forgiving: accepts "1,234.56", "1.234,56", "12", "₹450",
 * " 3.5 ", "-20". Returns null when the input cannot be read as a number so
 * callers can show a validation message rather than silently storing zero.
 */
export function parseAmount(input: string, code: string): bigint | null {
  if (typeof input !== "string") return null;

  // Strip everything that isn't a digit, separator or sign.
  let s = input.trim().replace(/[^\d.,\-+]/g, "");
  if (!s) return null;

  let negative = false;
  if (s.startsWith("-")) negative = true;
  // `-` last in the class is a literal, so no escape is needed here. It stays
  // escaped on line 149, where it sits between `,` and `+` and would otherwise
  // read as a range.
  s = s.replace(/[+-]/g, "");
  if (!s) return null;

  const decimalSepIndex = findDecimalSeparator(s, decimalsFor(code));

  let whole: string;
  let frac: string;
  if (decimalSepIndex === -1) {
    whole = s.replace(/[.,]/g, "");
    frac = "";
  } else {
    whole = s.slice(0, decimalSepIndex).replace(/[.,]/g, "");
    frac = s.slice(decimalSepIndex + 1).replace(/[.,]/g, "");
  }

  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) return null;
  if (whole === "" && frac === "") return null;

  const decimals = decimalsFor(code);

  // Round half-up on the first dropped digit rather than truncating, so
  // "10.005" in a 2dp currency becomes 10.01 and not 10.00.
  let minor: bigint;
  if (frac.length <= decimals) {
    minor = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals - frac.length)) || "0");
  } else {
    const kept = frac.slice(0, decimals);
    const nextDigit = Number(frac[decimals]);
    minor = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(kept || "0");
    if (nextDigit >= 5) minor += 1n;
  }

  return negative ? -minor : minor;
}

/**
 * Decides which `.` or `,` in a numeric string is the decimal point, returning
 * its index or -1 when every separator is grouping.
 *
 * The genuinely ambiguous case is a *single* separator followed by exactly
 * three digits: "1.234" is twelve hundred to a German reader and one-point-two
 * to an English one. It is resolved by asking which misreading is worse. Taking
 * a decimal point for a grouping mark inflates the amount a thousandfold —
 * a 10.005 lunch becomes a 10,005 lunch — while the opposite mistake only
 * rounds off a sub-cent tail. So a lone dot is always a decimal point, and only
 * a lone comma is assumed to be grouping.
 *
 * This is the lenient path for pasted and imported text. The amount field in
 * the composer constrains input as it is typed, so users never reach it.
 */
function findDecimalSeparator(s: string, decimals: number): number {
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  // Two different separators: the one further right is the decimal point,
  // which reads "1.234,56" and "1,234.56" correctly without knowing the locale.
  if (lastComma !== -1 && lastDot !== -1) return Math.max(lastComma, lastDot);

  const index = lastComma !== -1 ? lastComma : lastDot;
  if (index === -1) return -1;

  const char = s[index];
  // A number has at most one decimal point, so a repeated separator is grouping.
  if (s.indexOf(char) !== index) return -1;

  const trailingDigits = s.length - index - 1;
  if (trailingDigits !== 3) return index;

  // Three trailing digits. A three-decimal currency makes it exact.
  if (decimals === 3) return index;
  return char === "." ? index : -1;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Minor units → a plain decimal string, e.g. 123456n USD → "1234.56". */
export function toDecimalString(minor: bigint, code: string): string {
  const decimals = decimalsFor(code);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = abs % scale;
  const body =
    decimals === 0 ? whole.toString() : `${whole}.${frac.toString().padStart(decimals, "0")}`;
  return negative ? `-${body}` : body;
}

/**
 * The Intl options every amount is written with: the currency's narrow
 * symbol and its full minor units. Shared by formatMoney and the rolling
 * figure (components/ui/rolling-figure.tsx), so the two can never differ.
 */
export function currencyFormat(code: string): {
  style: "currency";
  currency: string;
  currencyDisplay: "narrowSymbol";
  minimumFractionDigits: number;
  maximumFractionDigits: number;
} {
  const info = currency(code);
  return {
    style: "currency",
    currency: info.code,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: info.decimals,
    maximumFractionDigits: info.decimals,
  };
}

export interface FormatOptions {
  /** Drop the currency symbol entirely. */
  bare?: boolean;
  /** Always render a leading + or −. */
  signed?: boolean;
  locale?: string;
}

/**
 * Formats minor units for display, the one way every amount in the app is
 * written: symbol first, full cents, never shortened to "1.2K". Mixed formats
 * on one screen made the same sum look like different sums. Uses Intl so grouping separators and symbol
 * placement follow the viewer's locale, with a manual fallback for exotic
 * currency codes that Intl rejects.
 */
export function formatMoney(
  minor: bigint | number,
  code: string,
  options: FormatOptions = {},
): string {
  const info = currency(code);
  const value = typeof minor === "bigint" ? minor : BigInt(Math.round(minor));
  const locale = options.locale ?? "en-US";
  const asNumber = Number(toDecimalString(abs(value), info.code));

  const fractionDigits = info.decimals;

  let body: string;
  try {
    body = new Intl.NumberFormat(locale, options.bare ? { ...currencyFormat(info.code), style: "decimal" } : currencyFormat(info.code)).format(asNumber);
  } catch {
    const digits = new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(asNumber);
    body = options.bare ? digits : `${info.symbol}${digits}`;
  }

  if (options.signed) return `${value < 0n ? "−" : "+"}${body}`;
  return value < 0n ? `−${body}` : body;
}

/** Just the symbol, for input adornments. */
export function currencySymbol(code: string, locale = "en-US"): string {
  const info = currency(code);
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: info.code,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? info.symbol;
  } catch {
    return info.symbol;
  }
}

// ---------------------------------------------------------------------------
// Typed amounts, grouped as they are typed
// ---------------------------------------------------------------------------

/**
 * A typed amount with its whole part grouped, "9999999.99" to "9,999,999.99",
 * the way every other amount is written. Only for showing in the field; the
 * field's own text keeps no commas.
 */
export function groupTypedAmount(text: string): string {
  const dot = text.indexOf(".");
  const whole = dot === -1 ? text : text.slice(0, dot);
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (dot === -1 ? "" : text.slice(dot));
}

/**
 * What was typed, from a grouped field's new contents (`raw`) and what it
 * showed before (`shown`), with where the caret belongs.
 *
 * The commas the field drew are taken out. A comma the person types is a
 * decimal point, as many people write one ("12,50"). Deleting a drawn comma
 * deletes the digit before it, or the comma would simply be drawn again.
 *
 * `caret` is the caret in `raw`; `significant` comes back as how many digits
 * and points lie before it, which `caretInGrouped` turns into a position in
 * whatever the field shows next.
 */
export function readTypedAmount(raw: string, shown: string, caret: number): { text: string; significant: number } {
  const count = (part: string) => (part.match(/[\d.]/g) ?? []).length;
  let first = 0;
  while (first < Math.min(raw.length, shown.length) && raw[first] === shown[first]) first++;

  // One character typed, and it is a comma: a decimal point.
  if (raw.length === shown.length + 1 && raw[first] === "," && raw.slice(first + 1) === shown.slice(first)) {
    const text = `${raw.slice(0, first).replace(/,/g, "")}.${raw.slice(first + 1).replace(/,/g, "")}`;
    return { text, significant: count(raw.slice(0, caret)) + (first < caret ? 1 : 0) };
  }

  // One drawn comma deleted: take the digit before it instead.
  if (raw.length === shown.length - 1 && shown[first] === "," && raw === shown.slice(0, first) + shown.slice(first + 1) && first > 0) {
    const without = raw.slice(0, first - 1) + raw.slice(first);
    return { text: without.replace(/,/g, ""), significant: Math.max(0, count(raw.slice(0, caret)) - 1) };
  }

  // One digit or point typed or deleted: every comma left was drawn.
  // Anything else, such as a paste: commas are grouping, unless there is just
  // one, no point, and not three digits after it ("12,50", not "1,234").
  const commas = (raw.match(/,/g) ?? []).length;
  const oneKey = Math.abs(raw.length - shown.length) === 1;
  if (!oneKey && commas === 1 && !raw.includes(".") && !/,\d{3}$/.test(raw)) {
    const at = raw.indexOf(",");
    return { text: raw.replace(",", "."), significant: count(raw.slice(0, caret)) + (at < caret ? 1 : 0) };
  }
  return { text: raw.replace(/,/g, ""), significant: count(raw.slice(0, caret)) };
}

/** The caret position in `shown` that has `significant` digits and points before it. */
export function caretInGrouped(shown: string, significant: number): number {
  let seen = 0;
  for (let index = 0; index < shown.length; index++) {
    if (seen === significant) return index;
    if (/[\d.]/.test(shown[index])) seen++;
  }
  return shown.length;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/**
 * Converts between currencies with different minor-unit scales.
 *
 * `rate` is a decimal string (quote per unit of base) so it round-trips through
 * the database without float drift. The multiplication is done in integer space
 * with every decimal place the rate has (at least 12) and rounded half-up at
 * the end.
 */
export function convert(
  minor: bigint,
  fromCode: string,
  toCode: string,
  rate: string | number,
): bigint {
  if (fromCode.toUpperCase() === toCode.toUpperCase()) return minor;

  const places = /\.(\d+)$/.exec(String(rate).trim())?.[1].length ?? 0;
  const PRECISION = BigInt(Math.max(12, places));
  const parsed = decimalStringToScaled(String(rate), PRECISION);

  /*
   * A rate this cannot read falls back to 1:1 *through the scaling*, not to
   * returning the input untouched.
   *
   * Returning `minor` looks like the safe answer and is the wrong one whenever
   * the two currencies count minor units differently: 5000 US cents handed
   * back unchanged is ¥5000, a hundred times the ¥50 it should be. Treating an
   * unreadable rate as parity at least keeps the magnitude right.
   *
   * Both API schemas reject anything this cannot parse, so reaching here means
   * a rate that predates that validation or one the client made up. Neither is
   * worth throwing over inside a pure arithmetic helper the offline composer
   * also runs.
   */
  const scaled = parsed !== null && parsed > 0n ? parsed : 10n ** PRECISION;

  const fromScale = minorUnitScale(fromCode);
  const toScale = minorUnitScale(toCode);

  const negative = minor < 0n;
  const abs = negative ? -minor : minor;

  // value_major = abs / fromScale;  result_minor = value_major * rate * toScale
  const numerator = abs * scaled * toScale;
  const denominator = fromScale * 10n ** PRECISION;

  // Round half-up.
  const result = (numerator * 2n + denominator) / (denominator * 2n);
  return negative ? -result : result;
}

/** "1.2345" at precision 4 → 12345n. Returns null on malformed input. */
function decimalStringToScaled(value: string, precision: bigint): bigint | null {
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!m) return null;
  const [, sign, whole = "", frac = ""] = m;
  if (whole === "" && frac === "") return null;
  const p = Number(precision);
  const fracPadded = (frac + "0".repeat(p)).slice(0, p);
  const scaled = BigInt(whole || "0") * 10n ** precision + BigInt(fracPadded || "0");
  return sign === "-" ? -scaled : scaled;
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export const abs = (v: bigint): bigint => (v < 0n ? -v : v);

export const sum = (values: Iterable<bigint>): bigint => {
  let total = 0n;
  for (const v of values) total += v;
  return total;
};

// ---------------------------------------------------------------------------
// Rates for paying in another currency
// ---------------------------------------------------------------------------

/** 1 / rate as a decimal string, for converting the debt into the paying currency. */
export function inverseRate(rate: string): string {
  return (1 / Number(rate)).toFixed(12);
}

/** The most decimal places a rate may have (`exchangeRateInput` in lib/api). */
export const MAX_RATE_PLACES = 24;

/**
 * The rate that turns `paid` (in `paidCurrency`) into exactly `owed` (in
 * `owedCurrency`). Used when someone pays the whole debt in another currency,
 * so the server's conversion lands on the debt to the cent instead of leaving
 * a one-cent remainder from rounding.
 *
 * Twelve decimal places is enough for everyday amounts, but not for every
 * amount: rounding the rate moves the converted figure by up to half a unit
 * of the last place times the payment's size, so a payment of a billion
 * minor units or more could land one unit off. The rate gets as many places
 * as the payment needs for that error to stay under half a unit.
 */
export function exactRate(owed: bigint, owedCurrency: string, paid: bigint, paidCurrency: string): string {
  const size = paid * minorUnitScale(owedCurrency);
  const places = Math.min(MAX_RATE_PLACES, Math.max(12, size.toString().length + 1));
  const scale = 10n ** BigInt(places);
  const numerator = owed * minorUnitScale(paidCurrency) * scale;
  const denominator = paid * minorUnitScale(owedCurrency);
  const scaled = (numerator + denominator / 2n) / denominator;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(places, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
