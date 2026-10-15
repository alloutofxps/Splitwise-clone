import { CURRENCIES } from "./money";

/**
 * A sensible currency default for someone signing up.
 *
 * The phone's time zone comes first, because it says where the person is. The
 * language setting comes second, because plenty of people run their phone in
 * US English wherever they live: someone in Lisbon with "en-US" should start on
 * euros, not dollars. Only ever a currency the app supports, never a throw, and
 * always changeable on the same screen.
 */
export function guessCurrency(): string {
  return guessCurrencyFor(safeTimeZone(), typeof navigator === "undefined" ? undefined : navigator.language);
}

/** The same guess from given inputs, so it can be checked without a device. */
export function guessCurrencyFor(timeZone: string | undefined, language: string | undefined): string {
  const supported = new Set(CURRENCIES.map((c) => c.code));
  const pick = (code: string | undefined) => (code && supported.has(code) ? code : null);

  const fromZone = timeZone ? pick(regionCurrency(ZONE_REGION[timeZone])) : null;
  if (fromZone) return fromZone;

  // `new Intl.Locale("")` throws, and `maximize` is missing on older browsers.
  // This runs on the first screen anyone sees, so a guess is never worth a crash.
  let region: string | undefined;
  try {
    if (language) region = new Intl.Locale(language).maximize().region;
  } catch {
    region = undefined;
  }
  return pick(regionCurrency(region)) ?? "USD";
}

function safeTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

const EURO = new Set([
  "AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT",
  "LU", "LV", "MT", "NL", "PT", "SI", "SK", "AD", "MC", "SM", "VA", "ME", "XK",
]);

const REGION_CURRENCY: Record<string, string> = {
  US: "USD", GB: "GBP", IN: "INR", JP: "JPY", AU: "AUD", CA: "CAD",
  CH: "CHF", LI: "CHF", CN: "CNY", SG: "SGD", HK: "HKD", NZ: "NZD", SE: "SEK",
  NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON",
  TR: "TRY", RU: "RUB", UA: "UAH", AE: "AED", SA: "SAR", QA: "QAR", KW: "KWD",
  BH: "BHD", OM: "OMR", IL: "ILS", EG: "EGP", ZA: "ZAR", NG: "NGN",
  KE: "KES", GH: "GHS", MA: "MAD", BR: "BRL", MX: "MXN", AR: "ARS", CL: "CLP",
  CO: "COP", PE: "PEN", KR: "KRW", TW: "TWD", TH: "THB", VN: "VND", ID: "IDR",
  MY: "MYR", PH: "PHP", PK: "PKR", BD: "BDT", LK: "LKR", NP: "NPR", IS: "ISK",
  RS: "RSD", BG: "BGN", PR: "USD", EC: "USD", SV: "USD", PA: "USD",
};

function regionCurrency(region: string | undefined): string | undefined {
  if (!region) return undefined;
  return EURO.has(region) ? "EUR" : REGION_CURRENCY[region];
}

/** Time zones whose country isn't obvious from the name alone. */
const ZONE_REGION: Record<string, string> = {
  "Europe/London": "GB", "Europe/Belfast": "GB", "Europe/Guernsey": "GB", "Europe/Jersey": "GB",
  "Europe/Isle_of_Man": "GB", "Europe/Dublin": "IE", "Europe/Lisbon": "PT", "Atlantic/Madeira": "PT",
  "Atlantic/Azores": "PT", "Europe/Madrid": "ES", "Atlantic/Canary": "ES", "Africa/Ceuta": "ES",
  "Europe/Paris": "FR", "Europe/Berlin": "DE", "Europe/Busingen": "DE", "Europe/Rome": "IT",
  "Europe/Amsterdam": "NL", "Europe/Brussels": "BE", "Europe/Luxembourg": "LU", "Europe/Vienna": "AT",
  "Europe/Zurich": "CH", "Europe/Vaduz": "LI", "Europe/Monaco": "MC", "Europe/Andorra": "AD",
  "Europe/San_Marino": "SM", "Europe/Vatican": "VA", "Europe/Malta": "MT", "Europe/Athens": "GR",
  "Asia/Nicosia": "CY", "Europe/Nicosia": "CY", "Asia/Famagusta": "CY", "Europe/Helsinki": "FI",
  "Europe/Mariehamn": "FI", "Europe/Tallinn": "EE", "Europe/Riga": "LV", "Europe/Vilnius": "LT",
  "Europe/Ljubljana": "SI", "Europe/Zagreb": "HR", "Europe/Bratislava": "SK", "Europe/Podgorica": "ME",
  "Europe/Stockholm": "SE", "Europe/Oslo": "NO", "Europe/Copenhagen": "DK", "Atlantic/Reykjavik": "IS",
  "Europe/Warsaw": "PL", "Europe/Prague": "CZ", "Europe/Budapest": "HU", "Europe/Bucharest": "RO",
  "Europe/Sofia": "BG", "Europe/Belgrade": "RS", "Europe/Istanbul": "TR", "Asia/Istanbul": "TR",
  "Europe/Kiev": "UA", "Europe/Kyiv": "UA", "Europe/Moscow": "RU",
  "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Tokyo": "JP", "Asia/Seoul": "KR",
  "Asia/Shanghai": "CN", "Asia/Chongqing": "CN", "Asia/Urumqi": "CN", "Asia/Hong_Kong": "HK",
  "Asia/Taipei": "TW", "Asia/Singapore": "SG", "Asia/Kuala_Lumpur": "MY", "Asia/Kuching": "MY",
  "Asia/Bangkok": "TH", "Asia/Ho_Chi_Minh": "VN", "Asia/Saigon": "VN", "Asia/Jakarta": "ID",
  "Asia/Makassar": "ID", "Asia/Jayapura": "ID", "Asia/Pontianak": "ID", "Asia/Manila": "PH",
  "Asia/Karachi": "PK", "Asia/Dhaka": "BD", "Asia/Colombo": "LK", "Asia/Kathmandu": "NP",
  "Asia/Katmandu": "NP", "Asia/Dubai": "AE", "Asia/Riyadh": "SA", "Asia/Qatar": "QA",
  "Asia/Kuwait": "KW", "Asia/Bahrain": "BH", "Asia/Muscat": "OM", "Asia/Jerusalem": "IL",
  "Asia/Tel_Aviv": "IL", "Africa/Cairo": "EG", "Africa/Johannesburg": "ZA", "Africa/Lagos": "NG",
  "Africa/Nairobi": "KE", "Africa/Accra": "GH", "Africa/Casablanca": "MA",
  "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "Australia/Brisbane": "AU",
  "Australia/Perth": "AU", "Australia/Adelaide": "AU", "Australia/Hobart": "AU",
  "Australia/Darwin": "AU", "Pacific/Auckland": "NZ", "Pacific/Chatham": "NZ",
  "America/Toronto": "CA", "America/Vancouver": "CA", "America/Edmonton": "CA",
  "America/Winnipeg": "CA", "America/Halifax": "CA", "America/St_Johns": "CA",
  "America/Regina": "CA", "America/Montreal": "CA", "America/Moncton": "CA",
  "America/Whitehorse": "CA", "America/Yellowknife": "CA", "America/Iqaluit": "CA",
  "America/Mexico_City": "MX", "America/Cancun": "MX", "America/Monterrey": "MX",
  "America/Tijuana": "MX", "America/Merida": "MX", "America/Chihuahua": "MX",
  "America/Mazatlan": "MX", "America/Hermosillo": "MX", "America/Sao_Paulo": "BR",
  "America/Fortaleza": "BR", "America/Recife": "BR", "America/Bahia": "BR",
  "America/Manaus": "BR", "America/Belem": "BR", "America/Argentina/Buenos_Aires": "AR",
  "America/Buenos_Aires": "AR", "America/Argentina/Cordoba": "AR", "America/Santiago": "CL",
  "America/Bogota": "CO", "America/Lima": "PE", "America/Puerto_Rico": "PR",
  "America/Guayaquil": "EC", "America/El_Salvador": "SV", "America/Panama": "PA",
  "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US",
  "America/Los_Angeles": "US", "America/Phoenix": "US", "America/Anchorage": "US",
  "America/Detroit": "US", "America/Boise": "US", "America/Indiana/Indianapolis": "US",
  "America/Kentucky/Louisville": "US", "Pacific/Honolulu": "US",
};
