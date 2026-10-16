"use client";

/**
 * Motion primitives for the golden-hour design (see DESIGN-AUDIT.md).
 *
 * Every one of these is decoration on top of information that is already on
 * screen, so each checks the operating system's Reduce Motion setting and
 * falls back to simply showing the end state.
 */

import * as React from "react";
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from "framer-motion";
import { formatMoney } from "@/lib/money";
import { cn } from "./primitives";

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/**
 * The redesign's timing (DESIGN-PLAN 1.5): 150ms for small changes, 240ms for
 * movement, 320ms for sheets, all on one curve that leaves quickly and lands
 * softly. Motion explains a change, or it doesn't happen.
 */
export const EASE = [0.2, 0, 0, 1] as const;
export const DURATION = { small: 0.15, move: 0.24, sheet: 0.32 } as const;

/**
 * MOTION-SPEC 3, from Material 3's emphasized curves. Arrivals start fast and
 * settle gently; departures start gently and leave fast; money counts quickly
 * at first and eases onto its final figure.
 */
export const EASE_ENTER = [0.05, 0.7, 0.1, 1] as const;
export const EASE_EXIT = [0.3, 0, 0.8, 0.15] as const;
export const EASE_COUNT = [0, 0, 0, 1] as const;
/** A balance counting to its new value. */
export const COUNT_MS = 600;

/**
 * Lists appear with a short fade, all at once. Rows used to rise in one after
 * another, which is a load animation, and nothing on load moves any more.
 */
export const listItem = {
  hidden: { opacity: 0 },
  shown: () => ({ opacity: 1, transition: { duration: DURATION.small, ease: EASE } }),
};

// ---------------------------------------------------------------------------
// Counting money
// ---------------------------------------------------------------------------

/**
 * A money amount that counts to its value instead of jumping there.
 *
 * A balance that snaps from €120 to €187 changes without explanation; one that
 * runs up to it says "this went up" before anybody reads the digits. Counted in
 * minor units, so the figure that lands is exact, and rendered with tabular
 * figures so the digits do not jostle while they move.
 */
export function AnimatedAmount({
  value,
  currency,
  className,
  signed = false,
}: {
  value: bigint | string;
  currency: string;
  className?: string;
  signed?: boolean;
}) {
  const target = Number(typeof value === "bigint" ? value : BigInt(value || "0"));
  const reduce = useReducedMotion();
  const motionValue = useMotionValue(target);
  const [shown, setShown] = React.useState(target);

  useMotionValueEvent(motionValue, "change", (latest) => setShown(Math.round(latest)));

  React.useEffect(() => {
    if (reduce) {
      motionValue.set(target);
      return;
    }
    const controls = animate(motionValue, target, { duration: 0.5, ease: EASE });
    return () => controls.stop();
  }, [target, reduce, motionValue]);

  // Under Reduce Motion there is nothing to count: show the value as it is.
  const magnitude = BigInt(reduce ? target : shown);
  const display = signed ? magnitude : magnitude < 0n ? -magnitude : magnitude;

  return (
    <span className={cn("display-number whitespace-nowrap", className)} aria-label={formatMoney(BigInt(signed ? target : Math.abs(target)), currency, { signed })}>
      <span aria-hidden="true">{formatMoney(display, currency, { signed })}</span>
    </span>
  );
}
