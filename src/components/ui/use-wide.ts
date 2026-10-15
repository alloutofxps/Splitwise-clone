"use client";

import * as React from "react";

const QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * Whether the screen is wide enough for two columns (DESIGN-PLAN 3.11). For
 * layouts that change what is on screen, not just where; pure placement is
 * done with breakpoints in CSS.
 */
export function useWide(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
