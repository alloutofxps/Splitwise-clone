"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { leaveFrom } from "./travel";

/** How long a tap holds the current screen while the next one loads. */
const HOLD_MS = 300;

/**
 * Opens a screen once it is ready to be seen (MOTION-SPEC 1).
 *
 * Moving the moment a row is tapped meant arriving at a screen whose data
 * wasn't in yet: blank paper, then an outline, then the content. Instead the
 * screen you are on stays (with its row pressed) while the next one loads, for
 * up to 300ms. Most screens are ready well within that and slide in complete;
 * one that isn't slides in with its outline, and fills in from there.
 *
 * Use as a link's click handler; it leaves alone anything that isn't a plain
 * click, so opening in a new tab still works.
 */
export function useOpenScreen() {
  const router = useRouter();
  return React.useCallback(
    (event: React.MouseEvent, href: string, ready: Promise<unknown>) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      // Where the row's icon, name and amount are, for the screen to carry
      // them into its header (travel.ts). Rows without them note nothing.
      leaveFrom(event.currentTarget, href);
      let moved = false;
      const go = () => {
        if (moved) return;
        moved = true;
        router.push(href);
      };
      ready.then(go, go);
      window.setTimeout(go, HOLD_MS);
    },
    [router],
  );
}
