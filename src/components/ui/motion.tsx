"use client";

/**
 * Motion primitives for the golden-hour design (see DESIGN-AUDIT.md).
 *
 * Every one of these is decoration on top of information that is already on
 * screen, so each checks the operating system's Reduce Motion setting and
 * falls back to simply showing the end state.
 */

import * as React from "react";
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from "framer-motion";
import { formatMoney } from "@/lib/money";
import { cn } from "./primitives";

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/**
 * Lists assemble rather than blink in: each row a beat after the last. Use as
 * `variants` on a `motion.li` with `custom={index}`. framer-motion skips the
 * movement under Reduce Motion on its own.
 */
export const listItem = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  shown: (index: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { delay: Math.min(index * 0.05, 0.35), type: "spring" as const, stiffness: 260, damping: 24 },
  }),
};

// ---------------------------------------------------------------------------
// Counting money
// ---------------------------------------------------------------------------

/**
 * A money amount that counts to its value instead of jumping there.
 *
 * A balance that snaps from €120 to €187 changes without explanation; one that
 * runs up to it says "this went up" before anybody reads the digits. Counted in
 * minor units, so the figure that lands is exact, and rendered with tabular
 * figures so the digits do not jostle while they move.
 */
export function AnimatedAmount({
  value,
  currency,
  className,
  /** Count up from zero the first time it appears - for the headline figure. */
  fromZero = false,
  signed = false,
}: {
  value: bigint | string;
  currency: string;
  className?: string;
  fromZero?: boolean;
  signed?: boolean;
}) {
  const target = Number(typeof value === "bigint" ? value : BigInt(value || "0"));
  const reduce = useReducedMotion();
  const motionValue = useMotionValue(fromZero && !reduce ? 0 : target);
  const [shown, setShown] = React.useState(fromZero && !reduce ? 0 : target);

  useMotionValueEvent(motionValue, "change", (latest) => setShown(Math.round(latest)));

  React.useEffect(() => {
    if (reduce) {
      motionValue.set(target);
      return;
    }
    const controls = animate(motionValue, target, {
      type: "spring",
      stiffness: 70,
      damping: 18,
      mass: 1,
      restDelta: 0.5,
    });
    return () => controls.stop();
  }, [target, reduce, motionValue]);

  // Under Reduce Motion there is nothing to count: show the value as it is.
  const magnitude = BigInt(reduce ? target : shown);
  const display = signed ? magnitude : magnitude < 0n ? -magnitude : magnitude;

  return (
    <span className={cn("display-number whitespace-nowrap", className)} aria-label={formatMoney(BigInt(signed ? target : Math.abs(target)), currency, { signed })}>
      <span aria-hidden="true">{formatMoney(display, currency, { signed })}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Celebration
// ---------------------------------------------------------------------------

const CONFETTI_COLOURS = ["#7c5cff", "#ff4fa3", "#ffb057", "#2fd6a6", "#5cc8ff", "#ffe066"];

/**
 * A burst of confetti from a point on screen, for the moments worth marking:
 * settling up to zero, finishing sign-up.
 *
 * Drawn on a throwaway canvas that removes itself, so there is no library and
 * nothing left mounted. Does nothing under Reduce Motion.
 */
export function celebrate(origin?: { x: number; y: number }): void {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.createElement("canvas");
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * ratio;
  canvas.height = window.innerHeight * ratio;
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    pointerEvents: "none",
    zIndex: "100",
  });
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.remove();
    return;
  }
  context.scale(ratio, ratio);

  const startX = origin?.x ?? window.innerWidth / 2;
  const startY = origin?.y ?? window.innerHeight * 0.38;
  const pieces = Array.from({ length: 110 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 6 + Math.random() * 9;
    return {
      x: startX,
      y: startY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 7,
      size: 5 + Math.random() * 6,
      spin: (Math.random() - 0.5) * 0.4,
      angle: Math.random() * Math.PI,
      colour: CONFETTI_COLOURS[Math.floor(Math.random() * CONFETTI_COLOURS.length)],
      round: Math.random() < 0.3,
    };
  });

  const started = performance.now();
  const frame = (now: number) => {
    const elapsed = now - started;
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const fade = Math.max(0, 1 - elapsed / 1900);
    for (const piece of pieces) {
      piece.vy += 0.32;
      piece.vx *= 0.985;
      piece.vy *= 0.985;
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.angle += piece.spin;
      context.save();
      context.globalAlpha = fade;
      context.translate(piece.x, piece.y);
      context.rotate(piece.angle);
      context.fillStyle = piece.colour;
      if (piece.round) {
        context.beginPath();
        context.arc(0, 0, piece.size / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      }
      context.restore();
    }
    if (elapsed < 1900) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Theme wipe
// ---------------------------------------------------------------------------

/**
 * Runs `change` inside a View Transition that wipes the new theme in as a
 * circle growing from the point that was tapped. Browsers without View
 * Transitions, and Reduce Motion, simply switch.
 */
export function withThemeWipe(change: () => void, from?: { x: number; y: number }): void {
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => { ready: Promise<void> };
  };
  if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    change();
    return;
  }
  const x = from?.x ?? window.innerWidth / 2;
  const y = from?.y ?? 0;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const transition = doc.startViewTransition(change);
  void transition.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 520, easing: "cubic-bezier(0.32, 0.72, 0, 1)", pseudoElement: "::view-transition-new(root)" },
    );
  });
}
