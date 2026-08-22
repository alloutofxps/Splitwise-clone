"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { X } from "lucide-react";
import { cn, haptic, IconButton } from "./primitives";

/**
 * Bottom sheet / centred dialog.
 *
 * On a phone this is a sheet you can throw away with your thumb; on a desktop
 * it is a centred dialog. Same component, because the content is identical and
 * maintaining two would guarantee they drift.
 *
 * The drag physics are the part worth doing properly. Dismissal is decided on
 * *velocity or distance*, not distance alone, so a quick flick closes the sheet
 * even though the finger barely moved - which is how every native sheet behaves
 * and what makes a web one feel wrong when it is missing.
 */

const SPRING = { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.9 };

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Optional so a sheet can render as an empty shell while its data loads. */
  children?: React.ReactNode;
  title?: React.ReactNode;
  /** Rendered against the bottom edge, above the home indicator. */
  footer?: React.ReactNode;
  /** Stops the sheet closing on backdrop tap - used for destructive confirms. */
  dismissible?: boolean;
  /** Fills the screen height, for the expense composer. */
  tall?: boolean;
  className?: string;
}

export function Sheet({
  open,
  onClose,
  children,
  title,
  footer,
  dismissible = true,
  tall = false,
  className,
}: SheetProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Body scroll lock. Recording the previous value rather than assuming
  // "visible" keeps nested sheets from unlocking the page early.
  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismissible, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <SheetBody
          onClose={onClose}
          title={title}
          footer={footer}
          dismissible={dismissible}
          tall={tall}
          className={className}
        >
          {children}
        </SheetBody>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function SheetBody({
  onClose,
  children,
  title,
  footer,
  dismissible,
  tall,
  className,
}: Omit<SheetProps, "open">) {
  const y = useMotionValue(0);
  // The backdrop fades as the sheet is dragged down, so the gesture feels
  // connected to the page behind it rather than to the sheet alone.
  const backdropOpacity = useTransform(y, [0, 400], [1, 0]);

  const handleDragEnd = (_event: unknown, info: PanInfo) => {
    const thrown = info.velocity.y > 520;
    const dragged = info.offset.y > 140;
    if (dismissible && (thrown || dragged)) {
      haptic(6);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        style={{ opacity: backdropOpacity }}
        onClick={() => dismissible && onClose()}
        className="absolute inset-0 bg-overlay"
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : "Dialog"}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={SPRING}
        drag="y"
        // Negative top constraint with elasticity gives the rubber-band feel
        // when dragging *up*, which signals "this does not go any further".
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.04, bottom: 0.7 }}
        onDragEnd={handleDragEnd}
        style={{ y }}
        className={cn(
          "relative flex w-full flex-col overflow-hidden bg-elevated shadow-sheet",
          "rounded-t-[--radius-2xl] sm:rounded-[--radius-xl]",
          "sm:max-w-[440px]",
          tall ? "h-[92dvh] sm:h-[min(86dvh,760px)]" : "max-h-[90dvh]",
          className,
        )}
      >
        {/* Grab handle. Decorative on desktop, load-bearing on a phone. */}
        <div className="flex shrink-0 justify-center pt-2.5 sm:hidden">
          <div className="h-1 w-9 rounded-full bg-line-strong" />
        </div>

        {title ? (
          <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-3 pt-3">
            <h2 className="text-[17px] font-bold tracking-[-0.01em] text-text">{title}</h2>
            {dismissible ? (
              <IconButton label="Close" size="sm" onClick={onClose} className="-mr-2">
                <X className="size-5" />
              </IconButton>
            ) : null}
          </div>
        ) : null}

        <div className="scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>

        {footer ? (
          <div className="shrink-0 border-t border-line bg-elevated px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            {footer}
          </div>
        ) : (
          <div className="h-safe-bottom shrink-0" />
        )}
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

export function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "danger",
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="px-5 pb-5">
        {description ? (
          <p className="text-[15px] leading-relaxed text-muted">{description}</p>
        ) : null}
        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="h-11 flex-1 rounded-[--radius-md] border border-line bg-surface-2 text-[15px] font-semibold text-text transition active:scale-[0.975]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "h-11 flex-1 rounded-[--radius-md] text-[15px] font-semibold text-white transition active:scale-[0.975] disabled:opacity-60",
              tone === "danger" ? "bg-negative" : "bg-brand",
            )}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
