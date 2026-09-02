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
  /**
   * Pinned directly under the title, outside the scrolling body.
   *
   * For the one field a form is fundamentally about. With the keyboard open a
   * sheet has a few hundred usable pixels, and anything in the scrolling body
   * can be scrolled out from under the caret — so the thing being typed into
   * goes here and stays put, and everything secondary scrolls behind it.
   */
  header?: React.ReactNode;
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
  header,
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
          header={header}
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
 * Where the visible part of the screen actually is.
 *
 * A sheet is `position: fixed`, which pins it to the **layout** viewport — and
 * when the keyboard opens, iOS does two things to that, not one. It shrinks the
 * *visual* viewport, and it also scrolls it, so that `visualViewport.offsetTop`
 * becomes non-zero while the layout viewport stays exactly where it was.
 *
 * Compensating only for the height is what a first attempt does, and it is why
 * the group form still could not be read while being typed into: the sheet was
 * correctly shortened and then left behind by a page that had slid out from
 * under it, so the field was above the top of the screen and had to be hunted
 * for by scrolling.
 *
 * So take over both edges rather than one. `top` and `height` set from the
 * visual viewport put the sheet exactly over the part of the screen the user
 * can actually see, whatever iOS does underneath — and `null` while nothing is
 * covering anything, which lets the plain `inset-0` do its job on a desktop
 * that has no visual viewport worth tracking.
 */
function useVisibleViewport(): { top: number; height: number } | null {
  const [rect, setRect] = React.useState<{ top: number; height: number } | null>(null);

  React.useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      // A few stray pixels are not a keyboard, and re-rendering on every scroll
      // frame of sub-pixel noise would make the sheet judder.
      const engaged = covered > 24 || viewport.offsetTop > 1;
      setRect(
        engaged
          ? { top: Math.round(viewport.offsetTop), height: Math.round(viewport.height) }
          : null,
      );
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return rect;
}

function SheetBody({
  onClose,
  children,
  title,
  footer,
  header,
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

  const visible = useVisibleViewport();
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
   * Bring the focused field into view once the keyboard has taken its space —
   * by moving this sheet's own scroll container, and nothing else.
   *
   * `scrollIntoView` is the obvious call and the wrong one here: it walks every
   * scrollable ancestor, and on iOS nudging ancestors of a `position: fixed`
   * element while the keyboard is opening is a good way to shove the sheet
   * somewhere nobody asked for. Setting `scrollTop` on one known element cannot
   * reach past that element.
   *
   * The field a form is fundamentally about belongs in `header`, where it sits
   * outside this container and cannot be scrolled away from at all. This is for
   * the secondary fields further down.
   */
  React.useEffect(() => {
    if (!visible) return;
    const box = scroller.current;
    const active = document.activeElement;
    if (!box || !(active instanceof HTMLElement) || !box.contains(active)) return;

    // After the resize has settled, so the measurement is against the sheet as
    // it now is rather than as it was a frame ago.
    const timer = window.setTimeout(() => {
      const field = active.getBoundingClientRect();
      const view = box.getBoundingClientRect();
      if (field.top >= view.top && field.bottom <= view.bottom) return;
      box.scrollTop += field.top - view.top - (view.height - field.height) / 2;
    }, 60);
    return () => window.clearTimeout(timer);
  }, [visible]);

  return (
    // Explicit `top`/`height` rather than padding: it pins this box to the part
    // of the screen that is visible *and* gives it a definite height, which is
    // what lets the sheet below size itself as a percentage of the space that
    // actually exists rather than of the whole page.
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={visible ? { top: visible.top, height: visible.height, bottom: "auto" } : undefined}
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

        {header ? <div className="shrink-0 px-5 pb-4">{header}</div> : null}

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
