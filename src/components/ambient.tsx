"use client";

import * as React from "react";

export type Mood = "owed" | "owe" | "square";

/**
 * Where the viewer stands overall, as a mood: owed, owing, or square.
 *
 * Several currencies cannot be summed honestly, so mixed signs read as square
 * - the background is a feeling, not a figure; the figures are on screen.
 */
export function moodFromTotals(totals: Record<string, string> | undefined): Mood {
  const values = Object.values(totals ?? {}).map((value) => BigInt(value));
  if (values.length === 0) return "square";
  if (values.every((value) => value > 0n)) return "owed";
  if (values.every((value) => value < 0n)) return "owe";
  return "square";
}

/** Sets the app-wide mood, which recolours the ambient light (globals.css). */
export function useMood(mood: Mood | null): void {
  React.useEffect(() => {
    if (!mood) return;
    document.documentElement.setAttribute("data-mood", mood);
  }, [mood]);
}

/**
 * The light behind the app.
 *
 * Three soft blobs in the mood colours, drifting on long offset loops so the
 * page never looks static and never looks busy. Fixed and behind everything;
 * frozen under Reduce Motion by the global rule in globals.css.
 */
export function Ambient() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="aurora-blob"
        style={{ width: "70vmax", height: "70vmax", top: "-38vmax", left: "-22vmax", background: "var(--mood)" }}
      />
      <div
        className="aurora-blob"
        style={{
          width: "55vmax",
          height: "55vmax",
          top: "-30vmax",
          right: "-28vmax",
          background: "var(--mood-2)",
          animationDelay: "-9s",
          animationDuration: "32s",
        }}
      />
      <div
        className="aurora-blob"
        style={{
          width: "50vmax",
          height: "50vmax",
          bottom: "-36vmax",
          left: "10vmax",
          background: "var(--accent-2)",
          opacity: "calc(var(--glow-strength) * 0.45)",
          animationDelay: "-17s",
          animationDuration: "38s",
        }}
      />
    </div>
  );
}
