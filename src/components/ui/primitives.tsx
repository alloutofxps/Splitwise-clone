"use client";

import * as React from "react";
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { TEXT_SCALE } from "@/lib/type-scale";

/**
 * Class merging, taught about this app's type scale.
 *
 * `tailwind-merge` resolves conflicts by knowing which utilities belong to the
 * same group, and it knows the built-in names. Ours are custom, and every one
 * of them looks exactly like a text *colour* - so `cn("text-display-lg",
 * "text-positive-text")` dropped the font size and kept the colour, silently,
 * on every element that sets both. That is most of the balances in the app: the
 * home headline rendered at the inherited 16px while its class list still
 * carried the `font-semibold leading-none` from the same branch, which is what made
 * it look like a styling bug rather than a merge bug.
 *
 * Declaring the group fixes it at the root instead of at forty call sites. The
 * bracketed pixel values this scale replaced never had the problem, because the
 * brackets told the library what it was looking at; a named scale has to say so
 * explicitly.
 */
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...TEXT_SCALE] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}

/**
 * A short buzz on a meaningful action.
 *
 * Android fires the Vibration API; iOS ignores it entirely and there is no web
 * equivalent of a Taptic tap, so this is a progressive enhancement rather than
 * a promise. Kept to the confirming actions only - vibrating on every tap makes
 * a phone feel cheap.
 */
export function haptic(pattern: number | number[] = 8): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers expose `vibrate` but throw when the page is not visible.
  }
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "positive"
  | "outline";
type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
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

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-body gap-1.5 rounded-[var(--radius-sm)]",
  md: "h-11 px-4 text-subhead gap-2 rounded-[var(--radius-md)]",
  lg: "h-[52px] px-6 text-subhead gap-2 rounded-[var(--radius-lg)]",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      loading = false,
      fullWidth = false,
      icon,
      className,
      children,
      disabled,
      onClick,
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        onClick={(event) => {
          if (!disabled && !loading) haptic();
          onClick?.(event);
        }}
        className={cn(
          "relative inline-flex select-none items-center justify-center font-semibold",
          // Gives under the finger before anything else happens (MOTION-SPEC 4).
          "overflow-hidden press-firm",
          "disabled:pointer-events-none",
          !loading && "disabled:opacity-50",
          VARIANTS[variant],
          SIZES[size],
          fullWidth && "w-full",
          className,
        )}
        {...props}
      >
        {icon}
        {children}
        {/* Working: a thin line runs along the bottom edge, rather than a
            spinner replacing the label you just pressed. */}
        {loading ? (
          <span aria-hidden className="divvy-progress absolute inset-x-0 bottom-0 h-[2px]" />
        ) : null}
      </button>
    );
  },
);

// ---------------------------------------------------------------------------
// Icon button
// ---------------------------------------------------------------------------

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "sm" | "md";
  tone?: "default" | "brand" | "danger";
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ label, size = "md", tone = "default", className, onClick, children, ...props }, ref) {
    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        onClick={(event) => {
          haptic();
          onClick?.(event);
        }}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full transition",
          "active:opacity-70 disabled:opacity-40 disabled:pointer-events-none",
          // 44px is the smallest reliable touch target on a phone; the visual
          // circle can be smaller than the tappable area.
          size === "md" ? "size-11" : "size-9",
          tone === "default" && "text-muted hover:bg-surface-2 hover:text-text",
          tone === "brand" && "text-brand hover:bg-brand-soft",
          tone === "danger" && "text-negative hover:bg-negative-soft",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-[var(--card-border)] bg-surface shadow-card",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** A card that is also a button - a group row, an expense row. */
export const PressableCard = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function PressableCard({ className, children, onClick, ...props }, ref) {
  return (
    <button
      ref={ref}
      onClick={(event) => {
        haptic();
        onClick?.(event);
      }}
      className={cn(
        "block w-full text-left press",
        "active:bg-surface-2",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Shown under the label in the split-mode picker. */
  hint?: string;
}

/**
 * iOS-style segmented control with a sliding indicator.
 *
 * The indicator is a single absolutely-positioned element rather than a
 * background on the active segment, so it animates *between* options - which is
 * what makes the control feel like one object instead of several buttons.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  return (
    <div
      role="tablist"
      className={cn("relative grid border-b border-line", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-px left-0 h-[2px] bg-text transition-transform duration-[240ms] ease-[cubic-bezier(0.2,0,0,1)]"
        style={{
          width: `calc(100% / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={option.value === value}
          onClick={() => {
            haptic();
            onChange(option.value);
          }}
          className={cn(
            "relative font-medium transition-colors duration-150",
            size === "md" ? "h-11 text-body" : "h-9 text-caption",
            option.value === value ? "text-text" : "text-subtle hover:text-muted",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        haptic();
        onChange(!checked);
      }}
      className={cn(
        "relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200",
        "disabled:opacity-50",
        checked ? "bg-brand" : "bg-surface-3",
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-[3px] size-6 rounded-full",
          checked ? "bg-inverse" : "bg-white dark:bg-muted",
          "transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
          checked ? "translate-x-[23px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Skeletons and empty states
// ---------------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-[var(--radius-sm)]", className)} />;
}

/**
 * The small drawing on an empty screen: three people, two lines between them.
 * The app's one picture, in the same language as the flow map.
 */
export function FlowDoodle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 40" className={cn("h-10 w-24", className)} aria-hidden="true">
      <path d="M 18 26 Q 33 6 48 20" fill="none" stroke="var(--person-azure)" strokeWidth="2" strokeLinecap="round" />
      <path d="M 48 20 Q 63 34 78 14" fill="none" stroke="var(--person-coral)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="14" cy="27" r="6" fill="var(--person-azure)" />
      <circle cx="48" cy="20" r="6" fill="var(--person-teal)" />
      <circle cx="82" cy="13" r="6" fill="var(--person-coral)" />
    </svg>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  /** No longer drawn: every empty state shows the same small flow drawing. */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-8 py-14 text-center",
        className,
      )}
    >
      <FlowDoodle className="mb-5" />
      <p className="text-title font-semibold tracking-[-0.01em] text-text">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-[34ch] text-body leading-relaxed text-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "brand" | "positive" | "negative" | "warning";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-tiny font-semibold",
        tone === "neutral" && "bg-neutral-soft text-muted",
        tone === "brand" && "bg-brand-soft text-brand-soft-text",
        tone === "positive" && "bg-positive-soft text-positive-text",
        tone === "negative" && "bg-negative-soft text-negative-text",
        tone === "warning" && "bg-warning-soft text-text",
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

export function SectionHeader({
  title,
  action,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    // A headline, not a form label: the display face, sentence case, with the
    // weight to anchor the list beneath it.
    <div className={cn("flex items-end justify-between px-1 pb-3", className)}>
      <h2 className="font-display text-title-lg font-semibold tracking-[-0.02em] text-text">
        {title}
      </h2>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * False while rendering on the server and through hydration, true after.
 *
 * The gate every portal needs: `createPortal` reaches for `document.body`,
 * which does not exist during a server render, and painting a sheet on the
 * first client pass would make the markup disagree with the server's and blow
 * up hydration.
 *
 * `useSyncExternalStore` rather than the usual `useState(false)` +
 * `useEffect(() => setMounted(true))`. Same three lines, one fewer render: the
 * effect version paints `false`, commits, sets state, and paints again, so
 * every sheet in the app costs an extra render pass on open. This one reads
 * `false` from the server snapshot and `true` from the client one, and React
 * picks the right answer on the first pass. Nothing is ever subscribed to,
 * hence the no-op `subscribe`.
 */
const neverChanges = () => () => {};
const onTheClient = () => true;
const onTheServer = () => false;

export function useMounted(): boolean {
  return React.useSyncExternalStore(neverChanges, onTheClient, onTheServer);
}
