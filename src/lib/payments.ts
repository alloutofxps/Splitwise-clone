/**
 * Payment handles and deep links.
 *
 * Divvy records who paid whom; it never moves money. This module is the whole
 * of its involvement in an actual transfer: turning a stored handle into a URL
 * that opens the user's own banking app with the amount already filled in.
 *
 * That is a deliberate architectural boundary. Handling money would mean
 * payment-processor fees, KYC obligations, financial regulation and a reason to
 * charge for the app. Handing off to the rails people already use costs nothing
 * and covers the same need.
 */

import { toDecimalString } from "./money";
import type { PaymentMethodDto } from "./types";

export interface PaymentKind {
  value: string;
  label: string;
  emoji: string;
  placeholder: string;
  /** Shown under the input while adding one. */
  hint?: string;
}

export const PAYMENT_KINDS: PaymentKind[] = [
  {
    value: "upi",
    label: "UPI",
    emoji: "🇮🇳",
    placeholder: "name@okhdfcbank",
    hint: "Opens GPay, PhonePe or Paytm with the amount filled in.",
  },
  {
    value: "paypal",
    label: "PayPal",
    emoji: "🅿️",
    placeholder: "paypal.me/yourname",
    hint: "Your PayPal.me link or username.",
  },
  {
    value: "venmo",
    label: "Venmo",
    emoji: "💙",
    placeholder: "@your-handle",
  },
  {
    value: "cashapp",
    label: "Cash App",
    emoji: "💵",
    placeholder: "$yourcashtag",
  },
  {
    value: "revolut",
    label: "Revolut",
    emoji: "🔵",
    placeholder: "revolut.me/yourname",
  },
  {
    value: "monzo",
    label: "Monzo",
    emoji: "🟠",
    placeholder: "monzo.me/yourname",
  },
  {
    value: "iban",
    label: "IBAN",
    emoji: "🏦",
    placeholder: "GB29 NWBK 6016 1331 9268 19",
    hint: "Copied to the clipboard — no bank supports a universal deep link.",
  },
  {
    value: "bank",
    label: "Bank details",
    emoji: "🏛️",
    placeholder: "Sort code and account number",
  },
  {
    value: "custom",
    label: "Something else",
    emoji: "💬",
    placeholder: "However you want to be paid",
  },
];

/**
 * Builds a deep link for a handle, or null when the kind has no scheme worth
 * linking to and the value should be offered as copyable text instead.
 */
export function paymentLink(
  method: PaymentMethodDto,
  amount: bigint | null,
  currency: string,
  payeeName: string,
): string | null {
  const value = method.value.trim();
  if (!value) return null;

  const decimal = amount && amount > 0n ? toDecimalString(amount, currency) : null;

  switch (method.kind) {
    case "upi": {
      // The UPI scheme is a documented intent URL that every Indian payment app
      // registers. `pa` is the payee address, `am` the amount, `cu` the currency.
      const params = new URLSearchParams({ pa: value, pn: payeeName });
      if (decimal) {
        params.set("am", decimal);
        params.set("cu", currency);
      }
      return `upi://pay?${params.toString()}`;
    }

    case "paypal": {
      const slug = value
        .replace(/^https?:\/\//i, "")
        .replace(/^(www\.)?paypal\.me\//i, "")
        .replace(/^@/, "");
      // PayPal.me takes the amount and currency as path segments.
      return decimal
        ? `https://paypal.me/${encodeURIComponent(slug)}/${decimal}${currency}`
        : `https://paypal.me/${encodeURIComponent(slug)}`;
    }

    case "venmo": {
      const handle = value.replace(/^@/, "");
      const params = new URLSearchParams({ txn: "pay", recipients: handle });
      if (decimal) params.set("amount", decimal);
      params.set("note", "Divvy settle up");
      return `https://venmo.com/?${params.toString()}`;
    }

    case "cashapp": {
      const tag = value.replace(/^\$/, "");
      return decimal
        ? `https://cash.app/$${encodeURIComponent(tag)}/${decimal}`
        : `https://cash.app/$${encodeURIComponent(tag)}`;
    }

    case "revolut": {
      const slug = value.replace(/^https?:\/\//i, "").replace(/^(www\.)?revolut\.me\//i, "");
      return `https://revolut.me/${encodeURIComponent(slug)}`;
    }

    case "monzo": {
      const slug = value.replace(/^https?:\/\//i, "").replace(/^(www\.)?monzo\.me\//i, "");
      return decimal
        ? `https://monzo.me/${encodeURIComponent(slug)}/${decimal}`
        : `https://monzo.me/${encodeURIComponent(slug)}`;
    }

    case "custom":
      // A URL is linkable; anything else is just text to copy.
      return /^https?:\/\//i.test(value) ? value : null;

    // IBANs and raw bank details have no universal scheme. Copy is the honest
    // affordance rather than a link that fails silently on most phones.
    default:
      return null;
  }
}
