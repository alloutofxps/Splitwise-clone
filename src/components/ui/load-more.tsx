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

  // Held in refs so the observer does not need re-creating every time the
  // pending state flips, which would tear down and rebuild it mid-scroll.
  //
  // Written in an effect rather than during render: a render can be thrown away
  // and re-run under concurrent React, and a ref mutated by the discarded one
  // keeps the value it was given. Committed renders are the only ones that may
  // touch a ref.
  const load = React.useRef(onLoad);
  const ready = React.useRef(false);

  React.useEffect(() => {
    load.current = onLoad;
    ready.current = hasMore && !loading;
  });

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
