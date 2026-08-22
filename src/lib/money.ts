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
  flag: string;
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
    ["USD", "US Dollar", "$", "🇺🇸"],
    ["EUR", "Euro", "€", "🇪🇺"],
    ["GBP", "British Pound", "£", "🇬🇧"],
    ["INR", "Indian Rupee", "₹", "🇮🇳"],
    ["JPY", "Japanese Yen", "¥", "🇯🇵"],
    ["AUD", "Australian Dollar", "A$", "🇦🇺"],
    ["CAD", "Canadian Dollar", "C$", "🇨🇦"],
    ["CHF", "Swiss Franc", "CHF", "🇨🇭"],
    ["CNY", "Chinese Yuan", "¥", "🇨🇳"],
    ["SGD", "Singapore Dollar", "S$", "🇸🇬"],
    ["HKD", "Hong Kong Dollar", "HK$", "🇭🇰"],
    ["NZD", "New Zealand Dollar", "NZ$", "🇳🇿"],
    ["SEK", "Swedish Krona", "kr", "🇸🇪"],
    ["NOK", "Norwegian Krone", "kr", "🇳🇴"],
    ["DKK", "Danish Krone", "kr", "🇩🇰"],
    ["PLN", "Polish Zloty", "zł", "🇵🇱"],
    ["CZK", "Czech Koruna", "Kč", "🇨🇿"],
    ["HUF", "Hungarian Forint", "Ft", "🇭🇺"],
    ["RON", "Romanian Leu", "lei", "🇷🇴"],
    ["TRY", "Turkish Lira", "₺", "🇹🇷"],
    ["RUB", "Russian Ruble", "₽", "🇷🇺"],
    ["UAH", "Ukrainian Hryvnia", "₴", "🇺🇦"],
    ["AED", "UAE Dirham", "د.إ", "🇦🇪"],
    ["SAR", "Saudi Riyal", "﷼", "🇸🇦"],
    ["QAR", "Qatari Riyal", "﷼", "🇶🇦"],
    ["KWD", "Kuwaiti Dinar", "د.ك", "🇰🇼"],
    ["BHD", "Bahraini Dinar", ".د.ب", "🇧🇭"],
    ["OMR", "Omani Rial", "﷼", "🇴🇲"],
    ["ILS", "Israeli Shekel", "₪", "🇮🇱"],
    ["EGP", "Egyptian Pound", "E£", "🇪🇬"],
    ["ZAR", "South African Rand", "R", "🇿🇦"],
    ["NGN", "Nigerian Naira", "₦", "🇳🇬"],
    ["KES", "Kenyan Shilling", "KSh", "🇰🇪"],
    ["GHS", "Ghanaian Cedi", "₵", "🇬🇭"],
    ["MAD", "Moroccan Dirham", "د.م.", "🇲🇦"],
    ["BRL", "Brazilian Real", "R$", "🇧🇷"],
    ["MXN", "Mexican Peso", "Mex$", "🇲🇽"],
    ["ARS", "Argentine Peso", "$", "🇦🇷"],
    ["CLP", "Chilean Peso", "$", "🇨🇱"],
    ["COP", "Colombian Peso", "$", "🇨🇴"],
    ["PEN", "Peruvian Sol", "S/", "🇵🇪"],
    ["KRW", "South Korean Won", "₩", "🇰🇷"],
    ["TWD", "Taiwan Dollar", "NT$", "🇹🇼"],
    ["THB", "Thai Baht", "฿", "🇹🇭"],
    ["VND", "Vietnamese Dong", "₫", "🇻🇳"],
    ["IDR", "Indonesian Rupiah", "Rp", "🇮🇩"],
    ["MYR", "Malaysian Ringgit", "RM", "🇲🇾"],
    ["PHP", "Philippine Peso", "₱", "🇵🇭"],
    ["PKR", "Pakistani Rupee", "₨", "🇵🇰"],
    ["BDT", "Bangladeshi Taka", "৳", "🇧🇩"],
    ["LKR", "Sri Lankan Rupee", "Rs", "🇱🇰"],
    ["NPR", "Nepalese Rupee", "रू", "🇳🇵"],
    ["ISK", "Icelandic Krona", "kr", "🇮🇸"],
    ["RSD", "Serbian Dinar", "дин", "🇷🇸"],
    ["BGN", "Bulgarian Lev", "лв", "🇧🇬"],
    ["HRK", "Croatian Kuna", "kn", "🇭🇷"],
  ] as const
).map(([code, name, symbol, flag]) => ({
  code,
  name,
  symbol,
  flag,
  decimals: IRREGULAR_DECIMALS[code] ?? 2,
}));

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

const FALLBACK: CurrencyInfo = {
  code: "USD",
  name: "US Dollar",
  symbol: "$",
  decimals: 2,
  flag: "🏳️",
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
    flag: "🏳️",
  };
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
  s = s.replace(/[+\-]/g, "");
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

export interface FormatOptions {
  /** Drop the currency symbol entirely. */
  bare?: boolean;
  /** Always render a leading + or −. */
  signed?: boolean;
  /** Render 1234567 as "1.2M". Useful in tight chart labels. */
  compact?: boolean;
  /** Hide ".00" when the amount is a whole major unit. */
  trimZeros?: boolean;
  locale?: string;
}

/**
 * Formats minor units for display. Uses Intl so grouping separators and symbol
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
  const asNumber = Number(toDecimalString(value < 0n ? -value : value, info.code));

  const trim = options.trimZeros && value % minorUnitScale(info.code) === 0n;
  const fractionDigits = trim ? 0 : info.decimals;

  let body: string;
  try {
    body = new Intl.NumberFormat(locale, {
      style: options.bare ? "decimal" : "currency",
      currency: info.code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
      notation: options.compact ? "compact" : "standard",
    }).format(asNumber);
  } catch {
    const digits = new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
      notation: options.compact ? "compact" : "standard",
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
// Conversion
// ---------------------------------------------------------------------------

/**
 * Converts between currencies with different minor-unit scales.
 *
 * `rate` is a decimal string (quote per unit of base) so it round-trips through
 * the database without float drift. The multiplication is done in integer space
 * at 12 digits of extra precision and rounded half-up at the end.
 */
export function convert(
  minor: bigint,
  fromCode: string,
  toCode: string,
  rate: string | number,
): bigint {
  if (fromCode.toUpperCase() === toCode.toUpperCase()) return minor;

  const PRECISION = 12n;
  const scaled = decimalStringToScaled(String(rate), PRECISION);
  if (scaled === null) return minor;

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

/**
 * Amounts closer together than half a minor unit are the same amount. Used to
 * decide whether a balance counts as "settled" — after simplification a
 * residue of a cent or two is noise, not debt.
 */
export function isSettled(amount: bigint, tolerance = 0n): boolean {
  return abs(amount) <= tolerance;
}
