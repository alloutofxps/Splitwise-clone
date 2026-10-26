"use client";

import * as React from "react";
import { animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion } from "motion/react";
import { Sheet, WhileOpen } from "./sheet";
import { cn, haptic } from "./primitives";

const REVEAL = 96;

/**
 * A list row you can swipe left to reveal one action behind it (DESIGN-PLAN
 * Part 4), such as Delete. The finger drives it, so it follows the finger; let
 * go past halfway and it stays open, otherwise it slides back.
 *
 * The action is also reachable without the gesture, through the row's
 * long-press menu, so nobody has to discover swiping to use it.
 */
export function SwipeRow({
  children,
  action,
  className,
}: {
  children: (controls: { open: boolean; close: () => void }) => React.ReactNode;
  action: { label: string; ariaLabel: string; tone?: "danger" | "default"; onPress: () => void };
  className?: string;
}) {
  const x = useMotionValue(0);
  const reduce = useReducedMotion();
  const [open, setOpen] = React.useState(false);
  // Lifted one level while it is off its resting place (MOTION-SPEC 2):
  // you're holding this row, and the action sits underneath it.
  const [lifted, setLifted] = React.useState(false);
  useMotionValueEvent(x, "change", (latest) => setLifted(latest < -1));

  // Lets go at the speed the finger was moving, with no bounce, so a flick
  // and a slow drag both finish the way they started.
  const settle = (to: number, velocity = 0) => {
    void animate(x, to, reduce ? { duration: 0 } : { type: "spring", bounce: 0, duration: 0.3, velocity });
    setOpen(to !== 0);
  };

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <button
        type="button"
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        aria-label={action.ariaLabel}
        onClick={() => {
          haptic(12);
          settle(0);
          action.onPress();
        }}
        className={cn(
          "absolute inset-y-0 right-0 flex items-center justify-center text-body font-medium",
          action.tone === "default" ? "bg-text text-inverse" : "bg-danger text-inverse",
        )}
        style={{ width: REVEAL }}
      >
        {action.label}
      </button>
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -REVEAL, right: 0 }}
        dragElastic={0.08}
        dragMomentum={false}
        onDragEnd={(_event, info) =>
          settle(info.offset.x < -REVEAL / 2 || info.velocity.x < -400 ? -REVEAL : 0, info.velocity.x)
        }
        style={{ x, touchAction: "pan-y" }}
        className={cn("relative bg-surface transition-shadow duration-150", lifted && "shadow-raised")}
      >
        {children({ open, close: () => settle(0) })}
      </motion.div>
    </div>
  );
}

/**
 * Long-press (or right-click) on a row. Returns the props to spread on it and
 * whether the menu should be showing.
 */
export function useLongPress(onLongPress: () => void, delay = 480) {
  const timer = React.useRef<number | null>(null);
  const start = React.useRef<{ x: number; y: number } | null>(null);
  const fired = React.useRef(false);

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  return {
    /** True right after a long-press, so the click that follows it is ignored. */
    consumed: () => {
      const was = fired.current;
      fired.current = false;
      return was;
    },
    handlers: {
      onPointerDown: (event: React.PointerEvent) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        fired.current = false;
        start.current = { x: event.clientX, y: event.clientY };
        timer.current = window.setTimeout(() => {
          fired.current = true;
          haptic(15);
          onLongPress();
          cancel();
        }, delay);
      },
      onPointerMove: (event: React.PointerEvent) => {
        if (!start.current) return;
        if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 8) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onContextMenu: (event: React.MouseEvent) => {
        event.preventDefault();
        cancel();
        onLongPress();
      },
    },
  };
}

/** The menu a long-press opens: a short list of actions in a sheet. */
export function ActionSheet({
  open,
  onClose,
  title,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  actions: { label: string; icon?: React.ReactNode; tone?: "danger"; onPress: () => void }[];
}) {
  return (
    <WhileOpen open={open}>
    <Sheet open={open} onClose={onClose} title={title}>
      <ul className="ring-inside mx-5 mb-6 divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line">
        {actions.map((action) => (
          <li key={action.label}>
            <button
              type="button"
              onClick={() => {
                haptic();
                onClose();
                action.onPress();
              }}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-3.5 text-left text-body-lg font-medium transition-colors hover:bg-surface-2",
                action.tone === "danger" ? "text-danger" : "text-text",
              )}
            >
              {action.icon}
              {action.label}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
    </WhileOpen>
  );
}
