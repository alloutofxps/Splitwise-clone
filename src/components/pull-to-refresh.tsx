"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { FlowDoodle } from "./ui/doodle";
import { DURATION, EASE_STANDARD } from "./ui/motion";
import { haptic } from "./ui/primitives";

const PULL = 72;
/** How far the page moves down at the pull's threshold: room for the label. */
const ROOM = 52;
/** How long "Up to date" stays once a refresh has finished. */
const DONE_MS = 700;
const BACK_MS = DURATION.change * 1000;

function standalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Pull down from the top to refresh (DESIGN-PLAN 3.12).
 *
 * Only in the installed app: a browser tab already does this itself, and two
 * competing pull gestures is worse than one. Fetches everything again rather
 * than one screen's data, because the screens share it.
 *
 * The page follows the finger down, and the label appears in the room that
 * leaves above it, so it never covers the screen's name or buttons. The page
 * stays down while it loads and slides back once it's done (with Reduce
 * Motion, it snaps back). The three people of the doodle draw in as far as
 * you have pulled, take turns to hop while it loads, and rest once it's done
 * (MOTION-SPEC 4). The words say the same thing, so the drawing is never the
 * only signal.
 */
export function PullToRefresh({ enabled }: { enabled: boolean }) {
  const client = useQueryClient();
  const reduce = useReducedMotion();
  const [distance, setDistance] = React.useState(0);
  const [held, setHeld] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [leaving, setLeaving] = React.useState(false);

  React.useEffect(() => {
    if (!enabled || !standalone()) return;
    let start: number | null = null;
    let pulled = 0;
    let timer = 0;
    const leave = () => {
      setLeaving(true);
      timer = window.setTimeout(() => {
        setLeaving(false);
        setDone(false);
      }, BACK_MS);
    };

    const onStart = (event: TouchEvent) => {
      // Only from the very top, and not from inside a sheet.
      if (window.scrollY > 0 || document.querySelector('[role="dialog"]')) return;
      start = event.touches[0].clientY;
    };
    const onMove = (event: TouchEvent) => {
      if (start === null) return;
      pulled = Math.max(0, event.touches[0].clientY - start);
      setHeld(true);
      setDistance(Math.min(pulled, PULL * 1.5));
    };
    const onEnd = () => {
      if (start === null) return;
      start = null;
      setHeld(false);
      if (pulled >= PULL) {
        haptic(10);
        setRefreshing(true);
        void client.invalidateQueries().finally(() => {
          setRefreshing(false);
          setDone(true);
          setDistance(0);
          timer = window.setTimeout(leave, DONE_MS);
        });
      } else if (pulled > 0) {
        setDistance(0);
        leave();
      }
      pulled = 0;
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [enabled, client]);

  const settled = refreshing || done;
  const offset = refreshing || (done && !leaving) ? ROOM : (Math.min(distance, PULL * 1.5) * ROOM) / PULL;
  // Under the finger the page follows it exactly; let go, and it eases to
  // where it rests. `translate` rather than `transform`, which the page's own
  // screen changes animate.
  const ease = held || reduce ? null : `${BACK_MS}ms cubic-bezier(${EASE_STANDARD.join(", ")})`;
  React.useLayoutEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    main.style.transition = ease ? `translate ${ease}` : "";
    main.style.translate = offset ? `0 ${offset}px` : "";
  }, [offset, ease]);
  React.useEffect(
    () => () => {
      document.querySelector("main")?.style.removeProperty("translate");
    },
    [],
  );

  if (!held && !settled && !leaving) return null;
  const ready = distance >= PULL;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-50 flex justify-center"
      style={{
        // Rides down with the page, from just above where it rests.
        transform: `translateY(${Math.min(offset, ROOM) - ROOM}px)`,
        opacity: Math.min(offset / ROOM, 1),
        transition: ease ? `transform ${ease}, opacity ${ease}` : held ? "none" : `opacity ${DURATION.fade * 1000}ms`,
      }}
    >
      <span className="flex items-center gap-2 rounded-full border border-line bg-raised px-3 py-1.5 text-caption font-medium text-text shadow-raised">
        <FlowDoodle
          small
          play={refreshing ? "wait" : undefined}
          progress={settled ? 1 : Math.min(distance / PULL, 1)}
        />
        {refreshing ? "Refreshing" : done ? "Up to date" : ready ? "Release to refresh" : "Pull to refresh"}
      </span>
    </div>
  );
}
