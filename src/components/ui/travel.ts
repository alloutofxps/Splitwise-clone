"use client";

import * as React from "react";
import { DURATION, EASE_STANDARD } from "./motion";

/**
 * The row you tapped carries its icon, name and amount into the new screen's
 * header, and back again when you return (MOTION-SPEC 1 and 4).
 *
 * The pieces are marked with `data-travel="icon" | "name" | "amount"` on both
 * ends. When a row opens a screen (`leaveFrom`), where its pieces sit is
 * noted; when the screen appears (`useArrival`), its matching pieces fly in
 * from there. What flies is a copy of each arriving piece, laid over the page
 * (`position: fixed`), so nothing clips it and the page's own slide doesn't
 * bend its path; the real piece is hidden underneath and shown the moment the
 * copy lands. The copies move by the browser's own animation engine, so they
 * keep going while React is still busy drawing the new screen.
 *
 * Nothing travels under Reduce Motion, when the screen took too long to
 * arrive (it showed its outline instead), or when either end is off screen.
 */

type Snapshot = { rect: DOMRect; fontSize: number };

let pending: { key: string; at: number; pieces: Map<string, Snapshot> } | null = null;

/** A hand-off older than this belongs to a screen that came up some other way. */
const FRESH_MS = 1000;
const EASE = `cubic-bezier(${EASE_STANDARD.join(", ")})`;

/** The type size of the text a piece shows, from the element that holds it. */
function typeSize(element: Element): number {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim() && node.parentElement) return parseFloat(getComputedStyle(node.parentElement).fontSize);
  }
  return parseFloat(getComputedStyle(element).fontSize);
}

function snapshot(root: Element): Map<string, Snapshot> {
  const pieces = new Map<string, Snapshot>();
  root.querySelectorAll<HTMLElement>("[data-travel]").forEach((element) => {
    const name = element.dataset.travel;
    if (name) pieces.set(name, { rect: element.getBoundingClientRect(), fontSize: typeSize(element) });
  });
  return pieces;
}

/** Note where `root`'s pieces are as it leaves for `key` (a path, or "back:" plus a path). */
export function leaveFrom(root: Element | null, key: string) {
  if (!root) return;
  pending = { key, at: performance.now(), pieces: snapshot(root) };
}

const visible = (rect: DOMRect) =>
  rect.width > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;

/** How far the screen around `element` is still shifted by its arrival slide. */
function slideOffset(element: Element): number {
  const screen = element.closest<HTMLElement>("[data-screen]");
  if (!screen) return 0;
  const transform = getComputedStyle(screen).transform;
  return transform && transform !== "none" ? new DOMMatrixReadOnly(transform).m41 : 0;
}

/** A copy of `element`, fixed over the page where `element` will finally sit. */
function ghostOf(element: HTMLElement, at: DOMRect): HTMLElement {
  const style = getComputedStyle(element);
  const ghost = element.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-travel");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${at.left}px`,
    top: `${at.top}px`,
    width: `${at.width}px`,
    height: `${at.height}px`,
    margin: "0",
    // The original is hidden while its copy flies; the copy must not inherit that.
    visibility: "visible",
    zIndex: "45",
    pointerEvents: "none",
    overflow: "visible",
    whiteSpace: "nowrap",
    transformOrigin: "0 0",
    color: style.color,
    font: style.font,
    letterSpacing: style.letterSpacing,
    display: style.display === "inline" ? "inline-block" : style.display,
    alignItems: style.alignItems,
    gap: style.gap,
  });
  return ghost;
}

/**
 * Fly `root`'s pieces in from where a hand-off for `key` left them.
 *
 * Call once `root` shows the real content. Icons travel centre to centre;
 * words and amounts keep their left edge and middle, and grow or shrink by
 * the ratio of their type sizes.
 */
function arrive(root: HTMLElement, key: string, duration: number): (() => void) | void {
  const handoff = pending;
  if (!handoff || handoff.key !== key || performance.now() - handoff.at > FRESH_MS) return;
  pending = null;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const targets = [...root.querySelectorAll<HTMLElement>("[data-travel]")].filter((element) =>
    handoff.pieces.has(element.dataset.travel ?? ""),
  );
  if (targets.length === 0) return;
  // Hidden from the first paint, so a piece is never seen in two places.
  targets.forEach((element) => (element.style.visibility = "hidden"));
  const reveal = () => targets.forEach((element) => (element.style.visibility = ""));

  const ghosts: HTMLElement[] = [];
  // Next frame: by then the new screen has its scroll position, so its
  // pieces are where they'll stay.
  const frame = requestAnimationFrame(() => {
    for (const element of targets) {
      const from = handoff.pieces.get(element.dataset.travel!)!;
      const measured = element.getBoundingClientRect();
      // Where it will sit once the screen's slide has finished.
      const shift = slideOffset(element);
      const to = new DOMRect(measured.left - shift, measured.top, measured.width, measured.height);
      const fontSize = typeSize(element);
      if (!visible(from.rect) || !visible(to) || !fontSize) {
        element.style.visibility = "";
        continue;
      }
      const scale = from.fontSize / fontSize;
      const icon = element.dataset.travel === "icon";
      const dx = icon
        ? from.rect.left + from.rect.width / 2 - (to.left + (to.width * scale) / 2)
        : from.rect.left - to.left;
      const dy = from.rect.top + from.rect.height / 2 - (to.top + (to.height * scale) / 2);

      const ghost = ghostOf(element, to);
      document.body.appendChild(ghost);
      ghosts.push(ghost);
      ghost
        .animate(
          [{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: "translate(0px, 0px) scale(1)" }],
          { duration, easing: EASE },
        )
        .finished.catch(() => {})
        .finally(() => {
          element.style.visibility = "";
          ghost.remove();
        });
    }
  });

  return () => {
    cancelAnimationFrame(frame);
    ghosts.forEach((ghost) => ghost.remove());
    reveal();
  };
}

/**
 * Land the pieces of a row that just opened this screen (or, with "back:",
 * of the screen that just closed onto this row), once `ready` is true.
 */
export function useArrival(ref: React.RefObject<HTMLElement | null>, key: string, ready: boolean, duration: number) {
  React.useLayoutEffect(() => {
    if (!ready || !ref.current) return;
    return arrive(ref.current, key, duration);
    // Only on arrival: later renders of the same screen never travel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}

/** Durations from MOTION-SPEC 3: opening carries the row in 400ms, going back 250ms. */
export const TRAVEL_IN_MS = DURATION.panel * 1000;
export const TRAVEL_BACK_MS = DURATION.change * 1000;
