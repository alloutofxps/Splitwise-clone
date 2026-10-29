"use client";

import * as React from "react";
import { cn } from "./primitives";

/**
 * A bar that sticks to the top of the screen and lifts once content is
 * scrolling underneath it.
 *
 * Flat while it sits in its place on the page; a level 2 shadow, faded in over
 * 150ms, the moment it starts covering something (MOTION-SPEC 2 and 4). The
 * shadow is what says "the list is passing under this", which a flat bar the
 * same colour as the page can't.
 *
 * It sticks below the notch, not under it: opened from the home screen, a
 * group's tabs used to stick at the very top, behind the clock and the camera
 * (findings item 31). Once stuck, the strip above it is filled in its colour,
 * so what scrolls past doesn't show through behind the clock either.
 */
export function StickyBar({
  className,
  spacing,
  children,
}: {
  className?: string;
  /** Space above the bar while it is in its place, e.g. "mt-6". */
  spacing?: string;
  children: React.ReactNode;
}) {
  const marker = React.useRef<HTMLDivElement>(null);
  const bar = React.useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = React.useState(false);

  React.useEffect(() => {
    const element = marker.current;
    if (!element || !bar.current || typeof IntersectionObserver === "undefined") return;
    // The marker sits just above the bar; once it has scrolled up past where
    // the bar sticks (the notch's height, 0 without one), the bar is stuck
    // and covering content.
    const inset = Number.parseFloat(getComputedStyle(bar.current).top) || 0;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
      threshold: 0,
      rootMargin: `-${inset}px 0px 0px 0px`,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={marker} aria-hidden className={cn("h-px -mb-px", spacing)} />
      <div
        ref={bar}
        className={cn(
          "sticky top-[env(safe-area-inset-top)] z-20 transition-shadow duration-150",
          stuck &&
            "shadow-raised before:absolute before:inset-x-0 before:bottom-full before:h-[env(safe-area-inset-top)] before:bg-inherit",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}
