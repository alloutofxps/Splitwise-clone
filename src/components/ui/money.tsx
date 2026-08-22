"use client";

import * as React from "react";
import { cn } from "./primitives";
import { currencySymbol, decimalsFor, formatMoney, parseAmount, toDecimalString } from "@/lib/money";

/**
 * A monetary amount.
 *
 * Colour is never the only carrier of meaning: a positive amount is green *and*
 * prefixed, a negative one red *and* prefixed, and the surrounding copy always
 * says "you are owed" or "you owe" in words. Roughly one in twelve men cannot
 * reliably separate the two hues.
 */
export function Amount({
  value,
  currency,
  tone = "auto",
  size = "md",
  signed = false,
  className,
  compact,
}: {
  /** Minor units, as a bigint or the decimal string the API sends. */
  value: bigint | string;
  currency: string;
  /**
   * `auto` colours by sign; `plain` inherits; `positive`/`negative` force it,
   * for places where the sign is carried by the label instead.
   */
  tone?: "auto" | "plain" | "positive" | "negative";
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "hero";
  signed?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const amount = typeof value === "bigint" ? value : BigInt(value || "0");

  const resolvedTone =
    tone === "auto" ? (amount > 0n ? "positive" : amount < 0n ? "negative" : "plain") : tone;

  return (
    <span
      className={cn(
        "display-number whitespace-nowrap font-semibold",
        size === "xs" && "text-[12px]",
        size === "sm" && "text-[13px]",
        size === "md" && "text-[15px]",
        size === "lg" && "text-[20px] font-bold",
        size === "xl" && "text-[28px] font-bold",
        size === "hero" && "text-[38px] font-bold leading-none",
        resolvedTone === "positive" && "text-positive-text",
        resolvedTone === "negative" && "text-negative-text",
        resolvedTone === "plain" && "text-text",
        className,
      )}
    >
      {formatMoney(signed ? amount : amount < 0n ? -amount : amount, currency, {
        signed,
        compact,
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Amount input
// ---------------------------------------------------------------------------

/**
 * The amount field.
 *
 * Type=text with an explicit numeric inputMode rather than type=number, for
 * three reasons that all show up on real phones: `number` lets users paste
 * `1e9`, its spinner arrows are useless on touch, and Safari's `number` keypad
 * on iOS still shows letters. `decimal` gives the right keypad everywhere.
 *
 * Input is masked as it is typed so the currency's precision is enforced at the
 * source - the parser's ambiguous cases (see `parseAmount`) become unreachable
 * because you cannot type a second separator or a third decimal place.
 */
export function AmountInput({
  value,
  onChange,
  currency,
  autoFocus,
  placeholder = "0",
  size = "lg",
  className,
  onEnter,
}: {
  /** Minor units. */
  value: bigint | null;
  onChange: (value: bigint | null) => void;
  currency: string;
  autoFocus?: boolean;
  placeholder?: string;
  size?: "md" | "lg" | "hero";
  className?: string;
  onEnter?: () => void;
}) {
  const decimals = decimalsFor(currency);
  const symbol = currencySymbol(currency);

  // The raw text is local state so a half-typed "12." survives a re-render.
  // It is reconciled with `value` only when they disagree numerically, which
  // lets a parent set the amount programmatically without fighting the cursor.
  const [text, setText] = React.useState(() =>
    value === null ? "" : toDecimalString(value, currency),
  );

  React.useEffect(() => {
    const parsed = parseAmount(text, currency);
    if (value === null && text !== "") setText("");
    else if (value !== null && parsed !== value) {
      setText(toDecimalString(value, currency));
    }
    // Reconcile only on external value or currency change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, currency]);

  const handleChange = (next: string) => {
    const masked = mask(next, decimals);
    setText(masked);
    onChange(masked === "" ? null : parseAmount(masked, currency));
  };

  return (
    <div
      className={cn(
        // The focus ring lives on the wrapper: a 2px outline drawn around a
        // borderless 46px input reads as a stray pill rather than as focus.
        "flex items-baseline gap-1.5 rounded-[--radius-md] transition",
        "focus-within:ring-4 focus-within:ring-[--brand-ring]",
        size === "hero" && "justify-center px-2 py-1",
        className,
      )}
    >
      <span
        className={cn(
          "display-number shrink-0 font-bold text-subtle",
          size === "md" && "text-[17px]",
          size === "lg" && "text-[24px]",
          size === "hero" && "text-[30px]",
        )}
      >
        {symbol}
      </span>
      <input
        type="text"
        inputMode="decimal"
        // Off across the board: browsers love to offer a postcode here.
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onEnter?.();
        }}
        onFocus={(event) => event.currentTarget.select()}
        // At hero size the field is centred with the currency symbol beside it,
        // so it has to be as wide as its content and no wider - a full-width
        // input centres its text and strands the symbol at the far left.
        style={
          size === "hero"
            ? { width: `${Math.max(1, (text || placeholder).length)}ch` }
            : undefined
        }
        className={cn(
          "display-number min-w-0 bg-transparent font-bold text-text",
          size !== "hero" && "w-full",
          // Suppressed here because the wrapper above carries the focus ring.
          "outline-none focus-visible:outline-none",
          "placeholder:text-subtle/60",
          size === "md" && "text-[20px]",
          size === "lg" && "text-[32px]",
          size === "hero" && "text-[46px] leading-none",
          size === "hero" && "text-center",
        )}
        aria-label="Amount"
      />
    </div>
  );
}

/**
 * Constrains typed text to a well-formed amount.
 *
 * Allows one separator, caps the fraction at the currency's precision, and
 * strips everything else. A zero-decimal currency rejects the separator
 * outright, so there is no way to type "1200.5" worth of yen.
 */
function mask(input: string, decimals: number): string {
  let cleaned = input.replace(/[^\d.,]/g, "").replace(/,/g, ".");

  const first = cleaned.indexOf(".");
  if (first !== -1) {
    if (decimals === 0) {
      cleaned = cleaned.slice(0, first);
    } else {
      // Keep the first separator, drop any others.
      cleaned =
        cleaned.slice(0, first + 1) + cleaned.slice(first + 1).replace(/\./g, "");
      const [whole, frac = ""] = cleaned.split(".");
      cleaned = `${whole}.${frac.slice(0, decimals)}`;
    }
  }

  // Trim runaway leading zeros, but leave "0." and a bare "0" alone.
  cleaned = cleaned.replace(/^0+(?=\d)/, "");
  // A sane ceiling: 15 integer digits is more than any real expense.
  const [whole = ""] = cleaned.split(".");
  if (whole.length > 15) return cleaned.slice(0, 15 + (cleaned.length - whole.length));

  return cleaned;
}

// ---------------------------------------------------------------------------

/**
 * The headline "you are owed / you owe" line.
 *
 * Reads as a sentence, because the number alone is ambiguous: is 40 what you
 * owe or what you are owed? Every balance in the app is stated in words first.
 */
export function BalanceHeadline({
  net,
  currency,
  size = "hero",
  settledLabel = "You're all settled up",
}: {
  net: bigint;
  currency: string;
  size?: "lg" | "xl" | "hero";
  settledLabel?: string;
}) {
  if (net === 0n) {
    return (
      <div>
        <p className="text-[15px] font-semibold text-muted">{settledLabel}</p>
      </div>
    );
  }

  const owed = net > 0n;
  return (
    <div>
      <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-subtle">
        {owed ? "You are owed" : "You owe"}
      </p>
      <Amount
        value={net}
        currency={currency}
        size={size}
        tone={owed ? "positive" : "negative"}
        className="mt-1 block"
      />
    </div>
  );
}
