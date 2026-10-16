"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { EASE_ENTER, EASE_EXIT } from "./motion";
import { LAND_MS, PANEL_EXIT_MS, untilClear, useStage } from "./stage";

/** How long the highlight on a row that has just landed takes to fade. */
const WASH_MS = 1200;

/**
 * Which rows of a list are arriving, rather than simply there.
 *
 * A row is arriving when it was not on screen a moment ago and belongs among
 * the rows that were - a new expense, or one brought back with Undo. Rows
 * present when the list first appears, older rows loaded with "Load more",
 * and whatever a new search or filter turns up are not: lists appear all at
 * once (MOTION-SPEC 5), and only a change you caused gets to move.
 */
export function useArrivals(items: { id: string; date: string }[], listKey: string, ready: boolean) {
  const shown = React.useRef<{ key: string; ids: Set<string>; oldest: string } | null>(null);

  React.useEffect(() => {
    if (!ready) return;
    let oldest = items[0]?.date ?? "";
    for (const item of items) if (item.date < oldest) oldest = item.date;
    shown.current = { key: listKey, ids: new Set(items.map((item) => item.id)), oldest };
  });

  return (item: { id: string; date: string }) => {
    const last = shown.current;
    if (!last || last.key !== listKey) return false;
    return !last.ids.has(item.id) && item.date >= last.oldest;
  };
}

/**
 * A list row that lands rather than appears.
 *
 * An arriving row takes its place while a panel still covers the list, so the
 * rows below have already made room out of sight; once the panel has gone it
 * fades in there, lit by a soft wash that fades after it. A row that leaves
 * folds away. Under Reduce Motion it simply fades in and out.
 *
 * It used to open into its place with the rows below moving down. Growing its
 * height re-laid-out the whole page every frame, and gliding the rows instead
 * had every row on the page re-measured; on a phone with the processor slowed
 * down, either one doubled this moment's stutter. A fade costs nothing to draw.
 */
export function Arrival({
  arriving,
  children,
  className,
}: {
  arriving: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const stage = useStage();
  const reduce = useReducedMotion();
  const [phase, setPhase] = React.useState<"held" | "landing" | "landed">(arriving ? "held" : "landed");

  React.useEffect(() => {
    if (phase !== "held" || stage.covered) return;
    const timer = window.setTimeout(() => setPhase("landing"), untilClear(stage));
    return () => window.clearTimeout(timer);
  }, [phase, stage]);

  React.useEffect(() => {
    if (phase !== "landing") return;
    const timer = window.setTimeout(() => setPhase("landed"), LAND_MS + WASH_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const held = phase === "held";

  return (
    <motion.li
      initial={false}
      animate={{ opacity: held ? 0 : 1 }}
      exit={
        reduce
          ? { opacity: 0, transition: { duration: 0.15 } }
          : { height: 0, opacity: 0, transition: { duration: PANEL_EXIT_MS / 1000, ease: EASE_EXIT } }
      }
      transition={
        reduce
          ? { duration: 0.15 }
          : { duration: LAND_MS / 1000, ease: EASE_ENTER }
      }
      className={className}
      style={phase === "landing" ? { position: "relative" } : undefined}
    >
      {phase === "landing" && !reduce ? (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 bg-wash"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ delay: LAND_MS / 1000, duration: WASH_MS / 1000, ease: "easeOut" }}
        />
      ) : null}
      {children}
    </motion.li>
  );
}
