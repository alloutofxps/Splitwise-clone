"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FlowDoodle, haptic } from "./ui/primitives";

const PULL = 72;
/** How long "Up to date" stays once a refresh has finished. */
const DONE_MS = 700;

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
 * The three people of the doodle draw in as far as you have pulled, take turns
 * to hop while it loads, and rest once it's done (MOTION-SPEC 4). The words
 * say the same thing, so the drawing is never the only signal.
 */
export function PullToRefresh({ enabled }: { enabled: boolean }) {
  const client = useQueryClient();
  const [distance, setDistance] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    if (!enabled || !standalone()) return;
    let start: number | null = null;
    let pulled = 0;

    const onStart = (event: TouchEvent) => {
      // Only from the very top, and not from inside a sheet.
      if (window.scrollY > 0 || document.querySelector('[role="dialog"]')) return;
      start = event.touches[0].clientY;
    };
    const onMove = (event: TouchEvent) => {
      if (start === null) return;
      pulled = Math.max(0, event.touches[0].clientY - start);
      setDistance(Math.min(pulled, PULL * 1.5));
    };
    const onEnd = () => {
      if (start === null) return;
      start = null;
      if (pulled >= PULL) {
        haptic(10);
        setRefreshing(true);
        void client.invalidateQueries().finally(() => {
          setRefreshing(false);
          setDone(true);
          setDistance(0);
          window.setTimeout(() => setDone(false), DONE_MS);
        });
      } else {
        setDistance(0);
      }
      pulled = 0;
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [enabled, client]);

  if (distance === 0 && !refreshing && !done) return null;
  const ready = distance >= PULL;
  const settled = refreshing || done;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-50 flex justify-center"
      style={{ transform: `translateY(${settled ? 8 : Math.min(distance, PULL) / 3}px)` }}
    >
      <span className="flex items-center gap-2 rounded-full border border-line bg-raised px-3 py-1.5 text-caption font-medium text-text shadow-raised">
        <FlowDoodle
          className="h-4 w-10"
          play={refreshing ? "wait" : undefined}
          progress={settled ? 1 : Math.min(distance / PULL, 1)}
        />
        {refreshing ? "Refreshing" : done ? "Up to date" : ready ? "Release to refresh" : "Pull to refresh"}
      </span>
    </div>
  );
}
