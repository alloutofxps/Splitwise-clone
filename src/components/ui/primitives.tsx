"use client";

import * as React from "react";
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { TEXT_SCALE } from "@/lib/type-scale";
import { BUTTON_BASE, BUTTON_SIZES, BUTTON_VARIANTS, type ButtonSize, type ButtonVariant } from "./button-style";
import { FlowDoodle, type DoodlePlay } from "./doodle";
import { haptic } from "./haptic";

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

// Passed on, because most of the app already imports it from here.
export { haptic };

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

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
        aria-busy={loading || undefined}
        onClick={(event) => {
          if (!disabled && !loading) haptic();
          onClick?.(event);
        }}
        className={cn(
          BUTTON_BASE,
          !loading && "disabled:opacity-50",
          BUTTON_VARIANTS[variant],
          BUTTON_SIZES[size],
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
 *
 * Two kinds, because they are told apart by speech software: "tabs" switch
 * between parts of a screen (Expenses, Balances, Insights), and say which part
 * they show when given `id` and the part is marked with `tabPanelProps`;
 * "choice" picks one setting (Light, Night, Auto) and needs a `label`. Both
 * are one Tab stop, moved through with the arrow keys, as keyboard users
 * expect of either.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
  kind = "tabs",
  label,
  id,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
  kind?: "tabs" | "choice";
  /** What the choice is about, for speech software. */
  label?: string;
  /** Ties tabs to the part of the screen they switch (see tabPanelProps). */
  id?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);

  // Arrows move along and pick as they go, Home and End jump to the ends.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const to =
      event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : step === undefined ? null : (index + step + options.length) % options.length;
    if (to === null) return;
    event.preventDefault();
    buttons.current[to]?.focus();
    if (to !== index) onChange(options[to].value);
  };

  return (
    <div
      role={kind === "tabs" ? "tablist" : "radiogroup"}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("relative grid border-b border-line", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-px left-0 h-[2px] bg-text transition-transform duration-[250ms] ease-[var(--ease-standard)]"
        style={{
          width: `calc(100% / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((option, position) => (
        <button
          key={option.value}
          ref={(element) => {
            buttons.current[position] = element;
          }}
          type="button"
          {...(kind === "tabs"
            ? {
                role: "tab",
                "aria-selected": option.value === value,
                ...(id ? { id: `${id}-${option.value}`, "aria-controls": `${id}-panel` } : {}),
              }
            : { role: "radio", "aria-checked": option.value === value })}
          tabIndex={position === index ? 0 : -1}
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

/** Marks the part of the screen that a Segmented given this `id` switches. */
export function tabPanelProps(id: string, value: string) {
  return { id: `${id}-panel`, role: "tabpanel", "aria-labelledby": `${id}-${value}` } as const;
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
          "transition-transform duration-200 ease-[var(--ease-standard)]",
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

export function EmptyState({
  title,
  description,
  action,
  className,
  play = "arrive",
}: {
  /** No longer drawn: every empty state shows the same small flow drawing. */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /** How the drawing moves as it appears. */
  play?: DoodlePlay;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-8 py-14 text-center",
        className,
      )}
    >
      <FlowDoodle className="mb-5" play={play} />
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
