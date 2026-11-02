"use client";

import * as React from "react";
import { cn } from "./primitives";
import { useVisibleViewport } from "./visible-viewport";

const Fitted = React.createContext(false);

/**
 * A full-height page whose main button sits at the bottom (the welcome
 * screens, an invite), kept usable with the keyboard up.
 *
 * The button is pinned to the bottom of a page as tall as the screen, and
 * opening the keyboard on an iPhone doesn't make the page any shorter: typing
 * your name, the field stayed in view and Continue or Join sat under the
 * keyboard (findings item 30). Sheets solved this already by fitting
 * themselves over the part of the screen that can still be seen
 * (`useVisibleViewport`); while the keyboard is up, this does the same for a
 * page. It scrolls inside that part, keeps the focused field in view above
 * the button, and `KeyboardPageFooter` holds the button at its bottom edge,
 * just above the keyboard. With the keyboard down it's an ordinary page.
 */
export function KeyboardPage({ className, children }: { className?: string; children: React.ReactNode }) {
  const visible = useVisibleViewport();
  const fitted = visible !== null;
  const page = React.useRef<HTMLDivElement>(null);

  // Once fitted, scroll the field being typed into back into view: the page
  // moved under it.
  React.useLayoutEffect(() => {
    if (!fitted) return;
    const field = document.activeElement;
    if (field instanceof HTMLElement && page.current?.contains(field)) field.scrollIntoView({ block: "nearest" });
  }, [fitted]);

  return (
    <Fitted.Provider value={fitted}>
      <div
        ref={page}
        className={cn(className, fitted && "fixed inset-x-0 z-10 overflow-y-auto overscroll-contain bg-bg")}
        // Room under the field for the button, when the browser scrolls it
        // into view.
        style={visible ? { top: visible.top, height: visible.height, minHeight: 0, scrollPaddingBottom: "6rem" } : undefined}
      >
        {children}
      </div>
    </Fitted.Provider>
  );
}

/**
 * The page's main button: held at the bottom edge while the keyboard is up.
 *
 * `pinned` holds it there with the keyboard down too, for a page that can run
 * longer than the screen while the button is the reason for the page (an
 * invite with a "which one are you?" list: Join was below the first screen,
 * findings item 41). It then carries the page's bottom margin itself, clear
 * of the home bar, and what scrolls under it fades out at its top edge.
 */
export function KeyboardPageFooter({
  className,
  pinned = false,
  children,
}: {
  className?: string;
  pinned?: boolean;
  children: React.ReactNode;
}) {
  const fitted = React.useContext(Fitted);
  return (
    <div
      className={cn(
        className,
        pinned &&
          "sticky bottom-0 z-10 bg-bg pb-[max(1.5rem,env(safe-area-inset-bottom))] before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-6 before:bg-linear-to-t before:from-bg before:to-transparent",
        fitted && "sticky bottom-0 bg-bg pb-3",
      )}
    >
      {children}
    </div>
  );
}
