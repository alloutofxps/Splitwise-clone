/**
 * Making sense of the text read off a receipt photo.
 *
 * Text recognition gives back lines of characters with the usual mistakes:
 * a stray symbol, a price split by a space, an O where a 0 should be. This
 * works on that text to find the three things worth filling in for someone:
 * the total, the shop's name, and the item lines for splitting by item.
 *
 * It makes guesses and the screen shows them as guesses. Nothing here is
 * saved without the person seeing it first.
 */
import { decimalsFor, parseAmount } from "./money";

export interface ReceiptReading {
  total: bigint | null;
  merchant: string | null;
  items: { name: string; amount: bigint }[];
}

/** Words that mark a line as the bill's total. */
const TOTAL_WORDS =
  /\b(grand\s*total|total\s*(due|amount|to\s*pay)?|amount\s*(due|payable)|balance\s*(due)?|to\s*pay|net\s*payable|summe|gesamt(betrag)?|montant|totale|importe|total\s*a\s*pagar)\b/i;

/** Lines that carry money but aren't items or the final total. */
const NOT_ITEMS =
  /\b(sub\s*-?\s*total|total|tax|vat|gst|cgst|sgst|igst|service|tip|gratuity|discount|savings|saved|change|cash|card|visa|mastercard|amex|tendered|paid|payment|balance|round(ing)?\s*off|amount|due|net|mwst|tva|iva|subtotal)\b/i;

/** Lines that can't be the shop's name. */
const NOT_MERCHANT =
  /\b(receipt|invoice|tax|vat|gst|tel|phone|www|http|order|table|server|cashier|date|time|bill|no\.|#)\b|\d{3,}/i;

/** OCR mix-ups inside numbers: O for 0, l or I for 1, S for 5. */
function cleanDigits(s: string): string {
  return s.replace(/(?<=\d)[oO](?=\d|[.,]|$)/g, "0").replace(/(?<=\d)[lI](?=\d)/g, "1");
}

/**
 * The amount at the end of a line, if there is one. Prices sit at the right
 * edge of a receipt, so only the last number on a line counts.
 */
function trailingAmount(line: string, currency: string): bigint | null {
  const text = cleanDigits(line).replace(/\s+(?=\d{2}\s*$)/, ".");
  const decimals = decimalsFor(currency);
  const pattern =
    decimals === 0
      ? /(-?\d{1,3}(?:[,.\s]\d{3})+|-?\d+)\s*[A-Za-z€$£¥₹]*\s*$/
      : /(-?\d{1,3}(?:[,.\s]?\d{3})*[.,]\d{2})\s*[A-Za-z€$£¥₹]*\s*$/;
  const match = pattern.exec(text);
  if (!match) return null;
  const value = parseAmount(match[1].replace(/\s/g, ""), currency);
  return value !== null && value > 0n ? value : null;
}

function tidyName(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N}&'’ .\-/]/gu, " ")
    .replace(/^\s*\d+\s*[xX@]\s*/, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 60);
}

export function readReceiptText(text: string, currency: string): ReceiptReading {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Total: the last line that says it is the total (receipts often repeat it
  // with the payment below), else the largest amount on the page.
  let total: bigint | null = null;
  for (const line of lines) {
    if (TOTAL_WORDS.test(line) && !/sub\s*-?\s*total/i.test(line)) {
      const amount = trailingAmount(line, currency);
      if (amount !== null) total = amount;
    }
  }
  const allAmounts = lines.map((l) => trailingAmount(l, currency)).filter((a): a is bigint => a !== null);
  if (total === null && allAmounts.length > 0) {
    total = allAmounts.reduce((a, b) => (b > a ? b : a));
  }

  // Shop name: the first line near the top that reads like words.
  let merchant: string | null = null;
  for (const line of lines.slice(0, 6)) {
    const letters = (line.match(/\p{L}/gu) ?? []).length;
    if (letters >= 3 && letters / line.length > 0.5 && !NOT_MERCHANT.test(line)) {
      const name = tidyName(line);
      if (name.length >= 3) {
        merchant = name
          .toLowerCase()
          .replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
        break;
      }
    }
  }

  // Items: lines with a name and a price, above the total, that aren't tax,
  // tips or payment lines.
  const items: { name: string; amount: bigint }[] = [];
  for (const line of lines) {
    if (NOT_ITEMS.test(line)) continue;
    const amount = trailingAmount(line, currency);
    if (amount === null) continue;
    if (total !== null && amount > total) continue;
    const name = tidyName(line.replace(/[-\d.,\s€$£¥₹]+[A-Za-z]{0,3}\s*$/, ""));
    if ((name.match(/\p{L}/gu) ?? []).length < 2) continue;
    items.push({ name, amount });
    if (items.length >= 40) break;
  }

  return { total, merchant, items };
}
