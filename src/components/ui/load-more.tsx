"use client";

import * as React from "react";
import { Button } from "./primitives";

/**
 * The bottom of a paged list.
 *
 * Auto-loads when it scrolls into view, which is what a phone list should do,
 * but renders a real button underneath rather than a bare spinner. Three
 * reasons the button is not decorative: `IntersectionObserver` never fires for
 * a user navigating by keyboard or screen reader, an auto-load that fails
 * leaves an infinite list with no way to retry, and a sentinel inside a
 * container that is not the one actually scrolling silently never triggers.
 *
 * The root margin loads a screen early, so the next page is usually already
 * there by the time the reader arrives at it.
 */
export function LoadMore({
  hasMore,
  loading,
  onLoad,
  label = "Load more",
}: {
  hasMore: boolean;
  loading: boolean;
  onLoad: () => void;
  label?: string;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);

  // Held in a ref so the observer does not need re-creating every time the
  // pending state flips, which would tear down and rebuild it mid-scroll.
  const load = React.useRef(onLoad);
  load.current = onLoad;
  const ready = React.useRef(false);
  ready.current = hasMore && !loading;

  React.useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && ready.current) {
          load.current();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!hasMore) return null;

  return (
    <div ref={ref} className="flex justify-center py-5">
      <Button variant="ghost" size="sm" loading={loading} onClick={onLoad}>
        {loading ? "Loading" : label}
      </Button>
    </div>
  );
}
