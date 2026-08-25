"use client";

import * as React from "react";
import { Check, Delete } from "lucide-react";
import { cn, haptic } from "./primitives";
import { maskAmount } from "./money";
import { currencySymbol, decimalsFor, parseAmount, toDecimalString } from "@/lib/money";

/**
 * The amount field, with its own keypad.
 *
 * Three things the OS keyboard gets wrong for entering a bill total, all of
 * which cost time at the moment somebody is standing at a table wanting to put
 * their phone away:
 *
 *   - it floats over the page, so it hides whatever was at the bottom - here,
 *     the split preview that tells you the number is right - and the page
 *     cannot be scrolled out from under it;
 *   - its keys are sized for prose rather than for eleven targets, so digits
 *     are small and mistyped;
 *   - iOS animates it in and out on every focus change, and the layout shift
 *     lands under a thumb that has already started moving.
 *
 * This one is part of the page instead of on top of it: 56px keys, no
 * animation, and everything below it stays reachable by scrolling. It opens
 * when there is no amount yet - which is why the composer was opened - and
 * collapses to a single line once there is one, so the rest of the form is not
 * permanently pushed off the bottom. Tapping the amount brings it back.
 *
 * Dismissal is an explicit key rather than a blur handler on purpose: blur
 * fires before the click that caused it, so a pad that closed on blur would
 * eat the first key press aimed at it.
 *
 * The display stays a real `<input>`. A hardware or bluetooth keyboard has to
 * keep working, screen readers need something focusable and labelled, and
 * `inputMode="none"` suppresses the software keyboard without giving up either.
 */
export function AmountPad({
  value,
  onChange,
  currency,
  onSubmit,
  className,
}: {
  /** Minor units. */
  value: bigint | null;
  onChange: (value: bigint | null) => void;
  currency: string;
  /** Fired by a hardware Enter, when there is something to submit. */
  onSubmit?: () => void;
  className?: string;
}) {
  const decimals = decimalsFor(currency);
  const symbol = currencySymbol(currency);

  const [text, setText] = React.useState(() =>
    value === null ? "" : toDecimalString(value, currency),
  );
  // Editing an existing expense opens with the amount already right, so the pad
  // starts out of the way; a new one opens with it ready.
  const [open, setOpen] = React.useState(() => value === null);

  // Reconcile only when the parent's value genuinely disagrees, so setting the
  // amount programmatically (picking a suggested payment, say) lands, while
  // typing is never fought mid-keystroke.
  React.useEffect(() => {
    const parsed = parseAmount(text, currency);
    if (value === null && text !== "") setText("");
    else if (value !== null && parsed !== value) setText(toDecimalString(value, currency));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, currency]);

  const commit = (next: string) => {
    const masked = maskAmount(next, decimals);
    setText(masked);
    onChange(masked === "" ? null : parseAmount(masked, currency));
  };

  const press = (key: string) => {
    haptic();
    if (key === "back") return commit(text.slice(0, -1));
    if (key === ".") {
      // A leading separator means "0.", which is what someone typing ".5"
      // intends and what the mask would otherwise strip to nothing.
      if (decimals === 0 || text.includes(".")) return;
      return commit(text === "" ? "0." : `${text}.`);
    }
    commit(text + key);
  };

  return (
    <div className={cn("select-none", className)}>
      <div className="flex items-baseline justify-center gap-1.5 px-2 py-1">
        <span className="display-number shrink-0 text-[30px] font-bold text-subtle">
          {symbol}
        </span>
        <input
          type="text"
          // Keeps the field focusable, announced and usable with a physical
          // keyboard while suppressing the on-screen one.
          inputMode="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={text}
          placeholder="0"
          onChange={(event) => commit(event.target.value)}
          onFocus={(event) => {
            setOpen(true);
            event.currentTarget.select();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit?.();
          }}
          style={{ width: `${Math.max(1, (text || "0").length)}ch` }}
          className="display-number min-w-0 bg-transparent text-center text-[46px] font-bold leading-none text-text outline-none placeholder:text-subtle/60"
          aria-label="Amount"
        />
      </div>

      {open ? (
        <div className="mt-4 grid grid-cols-3 gap-1.5" role="group" aria-label="Amount keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((key) => (
            <Key key={key} onPress={() => press(key)}>
              {key}
            </Key>
          ))}

          <Key
            onPress={() => press(".")}
            // Zero-decimal currencies have no fraction to type. The key stays
            // in place rather than reflowing the grid, because moving the 0
            // under a thumb that already knows where it is costs more than a
            // dead key does.
            disabled={decimals === 0 || text.includes(".")}
            label="Decimal point"
          >
            .
          </Key>
          <Key onPress={() => press("0")}>0</Key>
          <Key onPress={() => press("back")} disabled={text === ""} label="Delete">
            <Delete className="size-5" />
          </Key>

          <button
            type="button"
            onClick={() => {
              haptic();
              setOpen(false);
            }}
            className="col-span-3 mt-1 flex h-11 items-center justify-center gap-1.5 rounded-[var(--radius-md)] text-[14px] font-bold text-brand transition active:scale-[0.98]"
          >
            <Check className="size-4" />
            Done
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Key({
  children,
  onPress,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      // Explicitly not a submit button: this sits inside the composer, and a
      // stray Enter would otherwise fire whichever key rendered first.
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "display-number flex h-14 items-center justify-center rounded-[var(--radius-md)] bg-surface text-[22px] font-semibold text-text",
        "border border-line transition active:scale-95 active:bg-surface-3",
        "disabled:opacity-30 disabled:active:scale-100",
      )}
    >
      {children}
    </button>
  );
}
