"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useDragControls,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { X } from "lucide-react";
import { cn, haptic, IconButton, useMounted } from "./primitives";

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
  const mounted = useMounted();

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

/**
 * How much of the layout viewport something is covering — in practice, the
 * on-screen keyboard.
 *
 * A sheet is `position: fixed`, which anchors it to the *layout* viewport, and
 * iOS does not shrink that when the keyboard opens; it shrinks the *visual*
 * viewport and leaves the layout one alone. So a bottom-anchored sheet keeps
 * its bottom edge underneath the keyboard, taking the footer and whatever
 * field you are typing into with it. Creating a group meant typing into a box
 * you could not see.
 *
 * `dvh` does not help — it accounts for retracting browser chrome, not for the
 * keyboard. `visualViewport` is the only thing that actually reports this, and
 * on a browser too old to have it the value stays 0 and the sheet behaves
 * exactly as it did before.
 */
function useKeyboardInset(): number {
  const [inset, setInset] = React.useState(0);

  React.useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      // `offsetTop` matters as well: iOS scrolls the visual viewport down to
      // reveal a focused field, and that offset is part of what is hidden.
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      // Sub-pixel noise on every scroll frame would re-render the sheet
      // constantly, and a few stray pixels are not a keyboard.
      setInset(covered > 24 ? Math.round(covered) : 0);
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
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

  const keyboardInset = useKeyboardInset();
  const scroller = React.useRef<HTMLDivElement>(null);

  /*
   * Dismissal is driven from the handle and the title bar only.
   *
   * With `drag` listening on the whole sheet, a downward swipe anywhere —
   * including over the form you are trying to read — was a dismissal gesture
   * competing with a scroll. Scrolling up to see the field you were typing in
   * would sometimes throw the sheet off the bottom of the screen instead, and
   * lose what had been typed. The grab handle is what the affordance already
   * promises, so make it the only thing that means it.
   */
  const dragControls = useDragControls();

  /*
   * Bring the focused field back into view once the keyboard has taken its
   * space.
   *
   * Shrinking the sheet is only half the job: the field that was in the middle
   * of the sheet can end up below the fold of a sheet half the height, and the
   * browser's own scroll-into-view already ran against the pre-resize layout.
   * The delay lets the resize settle so the measurement is against the sheet
   * as it now is.
   */
  React.useEffect(() => {
    if (!keyboardInset) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (!scroller.current?.contains(active)) return;

    const timer = window.setTimeout(
      () => active.scrollIntoView({ block: "center", behavior: "smooth" }),
      60,
    );
    return () => window.clearTimeout(timer);
  }, [keyboardInset]);

  return (
    // `bottom` rather than padding: it gives this box a definite height, which
    // is what lets the sheet below size itself as a percentage of the space
    // that is actually visible rather than of the whole screen.
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={keyboardInset ? { bottom: keyboardInset } : undefined}
    >
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
        dragControls={dragControls}
        // The handle starts the gesture; the body never does.
        dragListener={false}
        // Negative top constraint with elasticity gives the rubber-band feel
        // when dragging *up*, which signals "this does not go any further".
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.04, bottom: 0.7 }}
        onDragEnd={handleDragEnd}
        style={{ y }}
        className={cn(
          "relative flex w-full flex-col overflow-hidden bg-elevated shadow-sheet",
          "rounded-t-[var(--radius-2xl)] sm:rounded-[var(--radius-xl)]",
          "sm:max-w-[440px]",
          // Percentages, not `dvh`: they resolve against the container above,
          // which has already had the keyboard subtracted from it.
          tall ? "h-[92%] sm:h-[min(86dvh,760px)]" : "max-h-[90%]",
          className,
        )}
      >
        {/*
          Grab handle. Decorative on desktop, load-bearing on a phone — and now
          literally the handle: it and the title bar are what start a drag.
          `touch-action: none` stops the browser claiming the gesture as a
          scroll before framer-motion sees it.
        */}
        <div
          onPointerDown={(event) => dragControls.start(event)}
          style={{ touchAction: "none" }}
          className="flex shrink-0 cursor-grab justify-center px-5 pb-1 pt-2.5 active:cursor-grabbing"
        >
          <div className="h-1 w-9 rounded-full bg-line-strong sm:hidden" />
        </div>

        {title ? (
          <div
            onPointerDown={(event) => dragControls.start(event)}
            style={{ touchAction: "none" }}
            className="flex shrink-0 items-center justify-between gap-3 px-5 pb-3 pt-1"
          >
            <h2 className="text-title font-bold tracking-[-0.01em] text-text">{title}</h2>
            {dismissible ? (
              <IconButton label="Close" size="sm" onClick={onClose} className="-mr-2">
                <X className="size-5" />
              </IconButton>
            ) : null}
          </div>
        ) : null}

        <div ref={scroller} className="scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
          <p className="text-subhead leading-relaxed text-muted">{description}</p>
        ) : null}
        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="h-11 flex-1 rounded-[var(--radius-md)] border border-line bg-surface-2 text-subhead font-semibold text-text transition active:scale-[0.975]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "h-11 flex-1 rounded-[var(--radius-md)] text-subhead font-semibold text-white transition active:scale-[0.975] disabled:opacity-60",
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
