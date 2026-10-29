/**
 * How a button looks, as plain class names.
 *
 * `Button` in `primitives.tsx` is built from these, and so is the error
 * screen's pair of buttons. The error and "Nothing here" screens are loaded
 * with every page in case they are needed, and each used to carry its own copy
 * of the whole of `primitives.tsx` to draw two buttons and a doodle.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "positive" | "outline";
export type ButtonSize = "sm" | "md" | "lg";

export const BUTTON_BASE = [
  "relative inline-flex select-none items-center justify-center font-semibold",
  // Gives under the finger before anything else happens (MOTION-SPEC 4).
  "overflow-hidden press-firm",
  "disabled:pointer-events-none",
].join(" ");

export const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // One solid colour, no gradient and no glow: it is the one thing on a
  // screen meant to be pressed, and it doesn't need to shout about it.
  primary:
    "bg-brand text-inverse hover:bg-brand-hover active:bg-brand-hover disabled:opacity-50",
  secondary:
    "border border-line bg-surface text-text hover:bg-surface-2 active:bg-surface-2",
  outline: "border border-line-strong text-text hover:bg-surface-2 active:bg-surface-2",
  ghost: "text-text hover:bg-surface-2 active:bg-surface-2",
  danger: "bg-danger text-inverse hover:opacity-90 active:opacity-90",
  positive: "bg-positive text-inverse hover:opacity-90 active:opacity-90",
};

export const BUTTON_SIZES: Record<ButtonSize, string> = {
  // 36 tall with a 44px tap area around it, which the base's overflow-hidden
  // would clip (the loading line is kept inside the corners instead).
  sm: "h-9 px-3.5 text-body gap-1.5 rounded-[var(--radius-sm)] tap-44 overflow-visible",
  md: "h-11 px-4 text-subhead gap-2 rounded-[var(--radius-md)]",
  lg: "h-[52px] px-6 text-subhead gap-2 rounded-[var(--radius-lg)]",
};
