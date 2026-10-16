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
  const [stuck, setStuck] = React.useState(false);

  React.useEffect(() => {
    const element = marker.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    // The marker sits just above the bar; once it has scrolled out of view,
    // the bar is stuck and covering content.
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { threshold: 0 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={marker} aria-hidden className={cn("h-px -mb-px", spacing)} />
      <div className={cn("sticky top-0 z-20 transition-shadow duration-150", stuck && "shadow-raised", className)}>{children}</div>
    </>
  );
}
