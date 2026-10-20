/**
 * The app's motion values (MOTION-SPEC 3): one set of curves and durations
 * that every animation picks from. A balance changing rolls its digits in
 * components/ui/rolling-figure.tsx.
 */

/**
 * MOTION-SPEC 3, from Material 3. Arrivals start fast and settle gently;
 * departures start gently and leave fast; things that stay on screen change
 * on the standard curve; money rolls quickly at first and eases onto its
 * final figure. The same curves live in globals.css as --ease-*.
 */
export const EASE_ENTER = [0.05, 0.7, 0.1, 1] as const;
export const EASE_EXIT = [0.3, 0, 0.8, 0.15] as const;
export const EASE_STANDARD = [0.2, 0, 0, 1] as const;
export const EASE_COUNT = [0, 0, 0, 1] as const;

/**
 * MOTION-SPEC 3's durations, in seconds for framer-motion. Every animation
 * picks one of these rather than typing its own, so the app keeps one rhythm.
 */
export const DURATION = {
  /** Fades, press release, a bar gaining its shadow, the Reduce Motion fallback. */
  fade: 0.15,
  /** Tab switches, toggles, menus, toasts arriving, a screen leaving. */
  quick: 0.2,
  /** Panels closing, heights changing, the group's tabs sliding. */
  change: 0.25,
  /** A screen arriving, a new row landing. */
  arrive: 0.3,
  /** Panels opening. */
  panel: 0.4,
} as const;

/** A balance rolling to its new value. */
export const COUNT_MS = 600;
