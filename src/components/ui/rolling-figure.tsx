"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";
import { abs, currencyFormat, formatMoney, toDecimalString } from "@/lib/money";
import { COUNT_MS, EASE_COUNT } from "./motion";
import { untilCount, useStageWhile } from "./stage";

/**
 * A balance whose digits roll to each new figure (MOTION-SPEC 4, money).
 *
 * The digits that change spin to their new value, like an odometer, once the
 * panel that changed them has gone and the row behind the change has landed;
 * the ones that don't change stay still. The first figure never moves:
 * amounts appear as they are.
 *
 * The rolling is NumberFlow (`@number-flow/react`), 6 KB, more than the
 * download limit has room for. So the figure starts as plain text, exactly as
 * it is written everywhere else, and NumberFlow is fetched once the page has
 * finished loading, then takes over showing the same figure. A change that
 * comes before it has loaded, or in a currency the browser can't format,
 * simply shows the new figure.
 *
 * `onRest` hears the figure the roll has come to rest on, for anything that
 * should change once it has (the colour, the arrow, "settled up").
 */

/** One fetch of NumberFlow, shared by every figure and by `React.lazy`. */
let loading: Promise<typeof import("@number-flow/react")> | null = null;
const load = () => (loading ??= import("@number-flow/react"));
const NumberFlow = React.lazy(load);

/** True once NumberFlow has arrived, which is only asked for after the page has loaded. */
function useNumberFlowReady(): boolean {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    const fetchIt = () => void load().then(() => live && setReady(true));
    if (document.readyState === "complete") fetchIt();
    else window.addEventListener("load", fetchIt, { once: true });
    return () => {
      live = false;
      window.removeEventListener("load", fetchIt);
    };
  }, []);
  return ready;
}

/** Intl options that write the figure exactly as `formatMoney` does, or null if Intl can't. */
function formatFor(code: string) {
  const options = currencyFormat(code);
  try {
    new Intl.NumberFormat("en-US", options);
    return options;
  } catch {
    return null;
  }
}

const TIMING = { duration: COUNT_MS, easing: `cubic-bezier(${EASE_COUNT.join(", ")})` };
const FADE = { duration: 150, easing: "ease-out" };

export function RollingFigure({
  value,
  currency,
  onRest,
}: {
  /** Minor units, shown without a sign: the arrow and the words carry it. */
  value: bigint;
  currency: string;
  onRest?: (value: bigint) => void;
}) {
  const reduce = useReducedMotion();
  const flowReady = useNumberFlowReady();
  const format = React.useMemo(() => formatFor(currency), [currency]);
  const [shown, setShown] = React.useState(value);
  // Panels only matter while there's a new figure waiting to be shown.
  const stage = useStageWhile(value !== shown);
  const restRef = React.useRef(onRest);
  React.useLayoutEffect(() => {
    restRef.current = onRest;
  });

  // Hold the old figure until the panel has gone, then move to the new one.
  React.useEffect(() => {
    if (value === shown) return;
    // Under Reduce Motion the new figure is simply shown.
    const wait = reduce ? 0 : !stage || stage.covered ? null : untilCount(stage);
    if (wait === null) return;
    const timer = window.setTimeout(() => setShown(value), wait);
    return () => window.clearTimeout(timer);
  }, [value, shown, reduce, stage]);

  // The figure is at rest once the roll has finished, or straight away when
  // nothing rolls (no NumberFlow yet, Reduce Motion, an unusual currency).
  const rolls = flowReady && Boolean(format) && !reduce;
  React.useEffect(() => {
    if (rolls) {
      // A fallback in case the finish event never comes (a hidden tab).
      const timer = window.setTimeout(() => restRef.current?.(shown), COUNT_MS + 200);
      return () => window.clearTimeout(timer);
    }
    restRef.current?.(shown);
  }, [shown, rolls]);

  const size = abs(shown);
  const text = formatMoney(size, currency);
  if (!flowReady || !format) return <span data-figure-text={text}>{text}</span>;
  return (
    // NumberFlow draws its digits inside its own shadow root, out of the
    // page's text. So the figure is also here as real text, read once by
    // speech software and found by search, with the rolling digits hidden
    // from both; and `data-figure-text` lets copies of it (the row travel)
    // write it as text, since a copy can't carry a shadow root.
    <span data-figure-text={text}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
      <React.Suspense fallback={text}>
      <NumberFlow
        // A number, as formatMoney itself uses: exact for any real balance,
        // and what NumberFlow compares to decide which way the digits spin.
        value={Number(toDecimalString(size, currency))}
        locales="en-US"
        format={format}
        transformTiming={TIMING}
        spinTiming={TIMING}
        opacityTiming={FADE}
        willChange
        onAnimationsFinish={() => restRef.current?.(shown)}
      />
      </React.Suspense>
      </span>
    </span>
  );
}
