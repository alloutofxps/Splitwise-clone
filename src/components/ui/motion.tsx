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
 * MOTION-SPEC 3, from Material 3. Arrivals start fast and settle gently;
 * departures start gently and leave fast; things that stay on screen change
 * on the standard curve; money counts quickly at first and eases onto its
 * final figure. The same curves live in globals.css as --ease-*.
 */
export const EASE_ENTER = [0.05, 0.7, 0.1, 1] as const;
export const EASE_EXIT = [0.3, 0, 0.8, 0.15] as const;
export const EASE_STANDARD = [0.2, 0, 0, 1] as const;
export const EASE_COUNT = [0, 0, 0, 1] as const;

/**
 * MOTION-SPEC 3's durations, in seconds for framer-motion. Every animation
 * picks one of these rather than typing its own, so the app keeps one rhythm.
 */
export const DURATION = {
  /** Fades, press release, a bar gaining its shadow, the Reduce Motion fallback. */
  fade: 0.15,
  /** Tab switches, toggles, menus, toasts arriving, a screen leaving. */
  quick: 0.2,
  /** Panels closing, heights changing, the group's tabs sliding. */
  change: 0.25,
  /** A screen arriving, a new row landing. */
  arrive: 0.3,
  /** Panels opening. */
  panel: 0.4,
} as const;

/** A balance counting to its new value. */
export const COUNT_MS = 600;

// ---------------------------------------------------------------------------
// Counting money
// ---------------------------------------------------------------------------

/**
 * A money figure that counts to its new value instead of jumping there.
 *
 * A balance that snaps from €120 to €187 changes without explanation; one that
 * runs up to it says "this went up" before anybody reads the digits. It waits
 * for the stage: a change made inside a panel keeps showing the old figure
 * until the panel has gone and the row that caused it has landed, then counts
 * (MOTION-SPEC, money). Counted in minor units, so the figure that lands is
 * exact. The first value shown never counts: amounts appear as they are.
 *
 * The digits are written straight into the text, about 30 times a second,
 * rather than re-rendering on every frame: on a slow phone the re-render was
 * a large part of what made the count stutter, and digits changing faster than
 * that can't be read anyway. Give `ref` to an element with no children of its
 * own; `rest` is the figure the count last came to rest on, for anything that
 * should only change once it has (such as saying "settled up" at zero).
 */
export function useCountedText(value: bigint, format: (value: bigint) => string) {
  const reduce = useReducedMotion();
  const stage = useStage();
  const ref = React.useRef<HTMLSpanElement>(null);
  const shown = React.useRef(value);
  const [rest, setRest] = React.useState(value);
  const formatRef = React.useRef(format);
  React.useLayoutEffect(() => {
    formatRef.current = format;
    // Keep the text in step with whatever is showing, every render.
    if (ref.current) ref.current.textContent = format(shown.current);
  });

  React.useEffect(() => {
    if (value === shown.current) return;
    const write = (next: bigint) => {
      shown.current = next;
      if (ref.current) ref.current.textContent = formatRef.current(next);
    };
    const land = () => {
      write(value);
      setRest(value);
    };
    // Under Reduce Motion the new figure is simply shown.
    if (reduce) {
      const timer = window.setTimeout(land, 0);
      return () => window.clearTimeout(timer);
    }
    // Behind a panel: hold the old figure until it has gone.
    if (stage.covered) return;
    const from = Number(shown.current);
    const to = Number(value);
    let last = 0;
    let controls: { stop: () => void } | undefined;
    const timer = window.setTimeout(() => {
      controls = animate(from, to, {
        duration: COUNT_MS / 1000,
        ease: EASE_COUNT,
        onUpdate: (latest) => {
          const now = performance.now();
          if (now - last < 32) return;
          last = now;
          write(BigInt(Math.round(latest)));
        },
        onComplete: land,
      });
    }, untilCount(stage));
    return () => {
      window.clearTimeout(timer);
      controls?.stop();
    };
  }, [value, reduce, stage]);

  return { ref, rest };
}

/** A money amount that counts to its value (see `useCountedText`). */
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
  const { ref } = useCountedText(target, (shown) =>
    formatMoney(signed ? shown : shown < 0n ? -shown : shown, currency, { signed }),
  );

  return (
    <span className={cn("display-number whitespace-nowrap", className)} aria-label={formatMoney(signed ? target : target < 0n ? -target : target, currency, { signed })}>
      <span aria-hidden="true" ref={ref} />
    </span>
  );
}
