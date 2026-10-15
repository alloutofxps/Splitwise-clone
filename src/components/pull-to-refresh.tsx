"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, Loader2 } from "lucide-react";
import { haptic } from "./ui/primitives";

const PULL = 72;

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
 */
export function PullToRefresh({ enabled }: { enabled: boolean }) {
  const client = useQueryClient();
  const [distance, setDistance] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);

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
          setDistance(0);
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

  if (distance === 0 && !refreshing) return null;
  const ready = distance >= PULL;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-50 flex justify-center"
      style={{ transform: `translateY(${refreshing ? 8 : Math.min(distance, PULL) / 3}px)` }}
    >
      <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-caption font-medium text-text">
        {refreshing ? (
          <>
            <Loader2 className="size-3.5 animate-spin" /> Refreshing
          </>
        ) : (
          <>
            <ArrowDown className={ready ? "size-3.5 rotate-180 transition-transform" : "size-3.5 transition-transform"} />
            {ready ? "Release to refresh" : "Pull to refresh"}
          </>
        )}
      </span>
    </div>
  );
}
