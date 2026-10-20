"use client";

import * as React from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
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
  arrow,
  figure,
}: {
  /** Minor units, as a bigint or the decimal string the API sends. */
  value: bigint | string;
  /**
   * Shown in place of the written figure, such as a `RollingFigure`;
   * `value` then only sets the colour and arrow.
   */
  figure?: React.ReactNode;
  /**
   * An arrow before the figure: ↙ for money coming to you, ↗ for money going
   * out. With the colour and the words beside it, the third signal.
   */
  arrow?: boolean;
  currency: string;
  /**
   * `auto` colours by sign; `plain` inherits; `positive`/`negative` force it,
   * for places where the sign is carried by the label instead.
   */
  tone?: "auto" | "plain" | "positive" | "negative";
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "hero";
  signed?: boolean;
  className?: string;
}) {
  const amount = typeof value === "bigint" ? value : BigInt(value || "0");

  const resolvedTone =
    tone === "auto" ? (amount > 0n ? "positive" : amount < 0n ? "negative" : "plain") : tone;

  return (
    <span
      className={cn(
        "display-number whitespace-nowrap font-semibold",
        // The display face for anything big enough to be looked at rather
        // than read past; small inline figures stay in the text face.
        size !== "xs" && size !== "sm" && "font-display tracking-[-0.02em]",
        size === "xs" && "text-caption",
        size === "sm" && "text-body",
        size === "md" && "text-subhead",
        size === "lg" && "text-title-lg font-semibold",
        size === "xl" && "text-display-sm font-semibold",
        size === "hero" && "text-display-lg font-semibold leading-none",
        resolvedTone === "positive" && "text-positive-text",
        resolvedTone === "negative" && "text-negative-text",
        resolvedTone === "plain" && "text-text",
        className,
      )}
    >
      {arrow && amount !== 0n ? (
        // An icon rather than the arrow character, which some fonts draw so
        // that it reads like a tick at small sizes.
        amount > 0n ? (
          <ArrowDownLeft aria-hidden className="mr-[0.1em] inline size-[0.7em] -translate-y-[0.05em]" strokeWidth={2} />
        ) : (
          <ArrowUpRight aria-hidden className="mr-[0.1em] inline size-[0.7em] -translate-y-[0.05em]" strokeWidth={2} />
        )
      ) : null}
      {figure ?? formatMoney(signed ? amount : amount < 0n ? -amount : amount, currency, { signed })}
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
  const [text, setText] = useAmountText(value, currency);

  /*
   * Typing into a field that already holds an amount replaces it, as if the
   * whole number were selected, but without selecting it. A selected amount
   * opens the sheet with the figure painted in a blue block, which reads as a
   * glitch rather than an invitation. Typing in the middle of the number, or
   * moving the caret, is a person editing it, and edits as normal.
   */
  const fresh = React.useRef(false);
  const pointer = React.useRef(false);

  const handleChange = (raw: string) => {
    let next = raw;
    if (fresh.current && text !== "") {
      if (raw.length === text.length + 1 && raw.startsWith(text)) next = raw.slice(-1);
      else if (raw === text.slice(0, -1)) next = "";
    }
    fresh.current = false;
    const masked = maskAmount(next, decimals);
    setText(masked);
    onChange(masked === "" ? null : parseAmount(masked, currency));
  };

  return (
    <div
      className={cn(
        // The focus ring lives on the wrapper: a 2px outline drawn around a
        // borderless 46px input reads as a stray pill rather than as focus.
        "flex items-baseline gap-1.5 rounded-[var(--radius-md)] transition",
        "focus-within:ring-[1.5px] focus-within:ring-text",
        size === "hero" && "justify-center px-2 py-1",
        className,
      )}
    >
      <span
        className={cn(
          "display-number shrink-0 font-semibold text-subtle",
          size === "md" && "text-title",
          size === "lg" && "text-heading",
          size === "hero" && "text-title-lg",
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
          // Arrow keys and Home/End mean the person is moving through the number.
          if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
            fresh.current = false;
          }
        }}
        onPointerDown={() => {
          pointer.current = true;
        }}
        onFocus={(event) => {
          // A tap leaves the caret where the finger landed; anything else
          // (opening the sheet, tabbing in) puts it at the end.
          fresh.current = true;
          const tapped = pointer.current;
          pointer.current = false;
          if (!tapped) {
            const end = event.currentTarget.value.length;
            event.currentTarget.setSelectionRange(end, end);
          }
        }}
        onBlur={() => {
          fresh.current = false;
        }}
        // At hero size the field is centred with the currency symbol beside it,
        // so it has to be as wide as its content and no wider - a full-width
        // input centres its text and strands the symbol at the far left.
        style={
          size === "hero"
            ? { width: `${Math.max(1, (text || placeholder).length)}ch` }
            : undefined
        }
        className={cn(
          "display-number min-w-0 bg-transparent font-semibold text-text",
          size !== "hero" && "w-full",
          // Suppressed here because the wrapper above carries the focus ring.
          "outline-none focus-visible:outline-none",
          "placeholder:text-subtle/60",
          size === "md" && "text-title-lg",
          size === "lg" && "text-display",
          size === "hero" && "text-display leading-none tracking-[-0.03em]",
          size === "hero" && "text-center",
        )}
        aria-label="Amount"
      />
    </div>
  );
}

/**
 * A text buffer that tracks a `bigint` amount without fighting the typist.
 *
 * Every amount field in the app needs the same two things at once: the raw
 * string has to be local state, so a half-typed "12." survives a re-render and
 * the caret stays put; and it still has to follow the value when a *parent*
 * moves it — picking a suggested settlement, switching currency, loading an
 * expense to edit. Four fields had grown their own copy of the reconciliation,
 * and they had already drifted: two compared against a `null` empty value and
 * two against `0n`, and only one of the four enforced the digit ceiling.
 *
 * The reconcile runs during render rather than in an effect, which is React's
 * documented way to adjust state when a prop changes. An effect gets there one
 * commit late — the field paints the old number, then corrects itself — and
 * costs a second render every time a parent nudges the value.
 *
 * `null` is the empty amount. A field whose empty value is `0n` passes
 * `value === 0n ? null : value` and gets identical behaviour.
 */
export function useAmountText(
  value: bigint | null,
  currency: string,
): [string, (next: string) => void] {
  const render = (amount: bigint | null) =>
    amount === null ? "" : toDecimalString(amount, currency);

  const [text, setText] = React.useState(() => render(value));
  const [seen, setSeen] = React.useState<{ value: bigint | null; currency: string }>({
    value,
    currency,
  });

  if (seen.value !== value || seen.currency !== currency) {
    setSeen({ value, currency });
    // Compared numerically, not textually: "12.50" and "12.5" are the same
    // amount, and rewriting the first into the second mid-keystroke is exactly
    // the caret-stealing this indirection exists to avoid.
    const parsed = text === "" ? null : parseAmount(text, currency);
    if (parsed !== value) setText(render(value));
  }

  return [text, setText];
}

/**
 * The small amount field used inside a list row.
 *
 * Distinct from `AmountInput` only in size and chrome — this one sits beside a
 * person's name in the payer and split editors, where the label is the row
 * rather than the field. It shares the masking and the reconciliation, which
 * is the point: the two list editors previously carried a copy each, neither
 * of which capped the digit count, so a share could be typed past the range
 * the API accepts while the main amount field stopped at fifteen digits.
 */
export function CompactAmountInput({
  value,
  currency,
  onChange,
  label,
  className,
}: {
  /** Minor units. `0n` shows an empty field. */
  value: bigint;
  currency: string;
  onChange: (value: bigint) => void;
  /** Names the field for screen readers, e.g. "Amount for Priya". */
  label: string;
  className?: string;
}) {
  const decimals = decimalsFor(currency);
  const [text, setText] = useAmountText(value === 0n ? null : value, currency);

  return (
    <div className="flex shrink-0 items-baseline gap-0.5 rounded-[var(--radius-xs)] bg-surface-2 px-2 py-1.5 focus-within:ring-[1.5px] focus-within:ring-text">
      <span className="text-caption font-semibold text-subtle">{currencySymbol(currency)}</span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={text}
        placeholder="0"
        aria-label={label}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const masked = maskAmount(event.target.value, decimals);
          setText(masked);
          onChange(masked === "" ? 0n : (parseAmount(masked, currency) ?? 0n));
        }}
        className={cn(
          "tabular w-[84px] bg-transparent text-right text-input font-semibold text-text outline-none placeholder:text-subtle/60",
          className,
        )}
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
 *
 * Exported so the in-app numpad enforces exactly these rules. Two
 * implementations of "what counts as a typed amount" would eventually disagree,
 * and the place they would disagree is a currency nobody on the team uses.
 */
export function maskAmount(input: string, decimals: number): string {
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
