"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { DURATION, EASE_STANDARD } from "./motion";
import { Check, Delete } from "lucide-react";
import { cn, haptic } from "./primitives";
import { maskAmount, useAmountText, useGroupedField } from "./money";
import { currencySymbol, decimalsFor, groupTypedAmount, parseAmount } from "@/lib/money";

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
  open: openProp,
  onOpenChange,
  leading,
}: {
  /** Minor units. */
  value: bigint | null;
  onChange: (value: bigint | null) => void;
  currency: string;
  /** Fired by a hardware Enter, when there is something to submit. */
  onSubmit?: () => void;
  className?: string;
  /**
   * Whether the keypad is showing, when the screen around it decides: typing
   * a description hides it, tapping the amount brings it back.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Shown to the left of the figure, such as the currency chip. */
  leading?: React.ReactNode;
}) {
  const decimals = decimalsFor(currency);
  const symbol = currencySymbol(currency);

  const [text, setText] = useAmountText(value, currency);
  // Editing an existing expense opens with the amount already right, so the pad
  // starts out of the way; a new one opens with it ready.
  const [ownOpen, setOwnOpen] = React.useState(() => value === null);
  const open = openProp ?? ownOpen;
  const reduce = useReducedMotion();
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };

  const commit = (next: string) => {
    const masked = maskAmount(next, decimals);
    setText(masked);
    onChange(masked === "" ? null : parseAmount(masked, currency));
  };
  const shown = groupTypedAmount(text);
  const [inputRef, onGroupedChange] = useGroupedField(shown, commit);

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
      <div className="flex items-center justify-center gap-2 px-2 py-1">
        {leading}
        <span className="flex items-baseline gap-1">
        <span className="display-number shrink-0 text-title-lg font-semibold text-subtle">
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
          ref={inputRef}
          value={shown}
          placeholder="0"
          onChange={onGroupedChange}
          onFocus={(event) => {
            setOpen(true);
            event.currentTarget.select();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit?.();
          }}
          style={{ width: `${Math.max(1, (shown || "0").length)}ch` }}
          // At least 44 by 44 to tap (a lone "0" is narrower, the digits
          // 40 tall), without moving anything around it.
          className="display-number -my-1 min-w-11 bg-transparent py-1 text-center text-display font-semibold leading-none tracking-[-0.03em] text-text outline-none placeholder:text-subtle"
          aria-label="Amount"
        />
        </span>
      </div>

      {/* Folds away when typing starts elsewhere, and back when the amount is
          tapped, instead of vanishing in one frame and making everything below
          jump (MOTION-SPEC 4). 250ms, on the curve for things that stay. */}
      <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="pad"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={reduce ? { duration: 0 } : { duration: DURATION.change, ease: EASE_STANDARD }}
          className="overflow-hidden"
        >
        {/* A calculator grid: hairlines between the keys rather than twelve
            floating buttons, so the pad is a compact block under the amount. */}
        <div
          className="ring-inside mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-line bg-line"
          role="group"
          aria-label="Amount keypad"
        >
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
            className="col-span-3 flex h-11 items-center justify-center gap-1.5 bg-surface text-body font-semibold text-text transition-colors active:bg-surface-2"
          >
            <Check className="size-4" />
            Done
          </button>
        </div>
        </motion.div>
      ) : null}
      </AnimatePresence>
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
      // Out of the Tab order: the amount field takes typed digits, so on a
      // computer these were twelve extra presses between it and the next
      // field. Taps and screen readers still reach them.
      tabIndex={-1}
      className={cn(
        "display-number flex h-[46px] items-center justify-center bg-surface text-title font-medium text-text",
        "transition-colors duration-150 active:bg-surface-2",
        "disabled:text-subtle/50",
      )}
    >
      {children}
    </button>
  );
}
