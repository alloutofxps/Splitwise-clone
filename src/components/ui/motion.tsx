"use client";

/**
 * Motion primitives for the golden-hour design (see DESIGN-AUDIT.md).
 *
 * Every one of these is decoration on top of information that is already on
 * screen, so each checks the operating system's Reduce Motion setting and
 * falls back to simply showing the end state.
 */

import * as React from "react";
import { animate, useReducedMotion } from "framer-motion";
import { formatMoney } from "@/lib/money";
import { cn } from "./primitives";
import { untilCount, useStage } from "./stage";

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
 * A money value that counts to its new figure instead of jumping there.
 *
 * A balance that snaps from €120 to €187 changes without explanation; one that
 * runs up to it says "this went up" before anybody reads the digits. It waits
 * for the stage: a change made inside a panel keeps showing the old figure
 * until the panel has gone and the row that caused it has landed, then counts
 * (MOTION-SPEC, money). Counted in minor units, so the figure that lands is
 * exact. The first value shown never counts: amounts appear as they are.
 */
export function useCountedValue(value: bigint): bigint {
  const reduce = useReducedMotion();
  const stage = useStage();
  const [shown, setShown] = React.useState(value);
  const shownRef = React.useRef(value);

  React.useEffect(() => {
    if (value === shownRef.current) return;
    // Under Reduce Motion the value is shown as it is (see the return below).
    if (reduce) {
      shownRef.current = value;
      return;
    }
    // Behind a panel: hold the old figure until it has gone.
    if (stage.covered) return;
    const from = Number(shownRef.current);
    const to = Number(value);
    let controls: { stop: () => void } | undefined;
    const timer = window.setTimeout(() => {
      controls = animate(from, to, {
        duration: COUNT_MS / 1000,
        ease: EASE_COUNT,
        onUpdate: (latest) => {
          const next = BigInt(Math.round(latest));
          shownRef.current = next;
          setShown(next);
        },
        onComplete: () => {
          shownRef.current = value;
          setShown(value);
        },
      });
    }, untilCount(stage));
    return () => {
      window.clearTimeout(timer);
      controls?.stop();
    };
  }, [value, reduce, stage]);

  return reduce ? value : shown;
}

/** A money amount that counts to its value (see `useCountedValue`). */
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
  const target = typeof value === "bigint" ? value : BigInt(value || "0");
  const shown = useCountedValue(target);
  const display = signed ? shown : shown < 0n ? -shown : shown;

  return (
    <span className={cn("display-number whitespace-nowrap", className)} aria-label={formatMoney(signed ? target : target < 0n ? -target : target, currency, { signed })}>
      <span aria-hidden="true">{formatMoney(display, currency, { signed })}</span>
    </span>
  );
}
