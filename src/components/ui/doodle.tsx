"use client";

import * as React from "react";
import { clsx } from "clsx";

/** How the doodle moves when it appears (MOTION-SPEC 4, illustrated). */
export type DoodlePlay = "arrive" | "start" | "settled" | "wait";

/**
 * The small drawing on an empty screen: three people, two lines between them.
 * The app's one picture, in the same language as the flow map.
 *
 * With `play` it moves once as it appears (the steps are in globals.css):
 * "arrive" for an empty list, "start" for a brand new account, "settled" when
 * nobody owes anything, "wait" while pull to refresh works. `progress` (0 to 1)
 * instead draws it as far as a pull has got. A tap makes the three hop.
 * `small` is the size that fits beside a line of text (pull to refresh).
 *
 * In its own file, without `cn`, so the error and "Nothing here" screens can
 * draw it without carrying the rest of `primitives.tsx`.
 */
export function FlowDoodle({
  className,
  play,
  progress,
  small = false,
}: {
  className?: string;
  play?: DoodlePlay;
  progress?: number;
  small?: boolean;
}) {
  const ref = React.useRef<SVGSVGElement>(null);
  const moving = play !== undefined || progress !== undefined;
  const line =
    moving
      ? {
          pathLength: 1,
          strokeDasharray: "1 1",
          style: progress === undefined ? undefined : { strokeDashoffset: 1 - progress },
        }
      : {};
  const person =
    progress === undefined ? undefined : { transform: `scale(${0.5 + 0.5 * progress})` };

  const hop = () => {
    if (!play || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    ref.current?.querySelectorAll("circle").forEach((circle, index) => {
      circle.animate(
        [{ transform: "translateY(0)" }, { transform: "translateY(-5px)", offset: 0.4 }, { transform: "translateY(0)" }],
        { duration: 420, delay: index * 70, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
    });
  };

  return (
    <svg
      ref={ref}
      viewBox="0 0 96 40"
      className={clsx(small ? "h-4 w-10" : "h-10 w-24", "overflow-visible", moving && "doodle", className)}
      data-play={play}
      onPointerDown={play ? hop : undefined}
      aria-hidden="true"
    >
      <path d="M 18 26 Q 33 6 48 20" fill="none" stroke="var(--person-azure)" strokeWidth="2" strokeLinecap="round" {...line} />
      <path d="M 48 20 Q 63 34 78 14" fill="none" stroke="var(--person-coral)" strokeWidth="2" strokeLinecap="round" {...line} />
      <circle cx="14" cy="27" r="6" fill="var(--person-azure)" style={person} />
      <circle cx="48" cy="20" r="6" fill="var(--person-teal)" style={person} />
      <circle cx="82" cy="13" r="6" fill="var(--person-coral)" style={person} />
    </svg>
  );
}
