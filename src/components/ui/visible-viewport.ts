"use client";

import * as React from "react";

/**
 * Whether this element is the reason a keyboard would be on screen.
 *
 * The viewport being short is not on its own evidence of a keyboard, and
 * trusting it alone shipped a bug: opening the expense composer produced a
 * sheet sized as though a keyboard were up when none was, cut off halfway down
 * the screen with the page showing underneath. A reading taken while the
 * viewport happened to be short — mid-transition, or just after a keyboard
 * elsewhere dismissed — latched, and nothing dislodged it.
 *
 * `inputMode="none"` matters: the amount pad is a real, focusable `<input>`
 * that deliberately suppresses the system keyboard in favour of its own
 * on-screen pad. It must not count.
 */
export function summonsKeyboard(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA") return false;
  if (element.getAttribute("inputmode") === "none") return false;
  const type = element.getAttribute("type");
  return type !== "checkbox" && type !== "radio" && type !== "file";
}

/**
 * Where the visible part of the screen actually is.
 *
 * A sheet is `position: fixed`, which pins it to the **layout** viewport — and
 * when the keyboard opens, iOS does two things to that, not one. It shrinks the
 * *visual* viewport, and it also scrolls it, so that `visualViewport.offsetTop`
 * becomes non-zero while the layout viewport stays exactly where it was.
 *
 * Compensating only for the height is what a first attempt does, and it is why
 * the group form still could not be read while being typed into: the sheet was
 * correctly shortened and then left behind by a page that had slid out from
 * under it, so the field was above the top of the screen and had to be hunted
 * for by scrolling.
 *
 * So take over both edges rather than one. `top` and `height` set from the
 * visual viewport put the sheet exactly over the part of the screen the user
 * can actually see, whatever iOS does underneath — and `null` while nothing is
 * covering anything, which lets the plain `inset-0` do its job on a desktop
 * that has no visual viewport worth tracking.
 */
export function useVisibleViewport(): { top: number; height: number } | null {
  const [rect, setRect] = React.useState<{ top: number; height: number } | null>(null);

  React.useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      // A few stray pixels are not a keyboard, and re-rendering on every scroll
      // frame of sub-pixel noise would make the sheet judder.
      const shrunk = covered > 24 || viewport.offsetTop > 1;
      setRect(
        shrunk && summonsKeyboard(document.activeElement)
          ? { top: Math.round(viewport.offsetTop), height: Math.round(viewport.height) }
          : null,
      );
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    // Focus, not just size. A reading taken while the viewport happened to be
    // short would otherwise stay latched with nothing to dislodge it, and these
    // are what say the keyboard has genuinely gone.
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);

  return rect;
}
