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
 * Lists assemble rather than blink in: each row a beat after the last. Use as
 * `variants` on a `motion.li` with `custom={index}`. framer-motion skips the
 * movement under Reduce Motion on its own.
 */
export const listItem = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  shown: (index: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { delay: Math.min(index * 0.05, 0.35), type: "spring" as const, stiffness: 260, damping: 24 },
  }),
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
    const controls = animate(motionValue, target, {
      type: "spring",
      stiffness: 70,
      damping: 18,
      mass: 1,
      restDelta: 0.5,
    });
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
