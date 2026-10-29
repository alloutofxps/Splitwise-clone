"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useDragControls,
  useIsPresent,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "motion/react";
import { X } from "lucide-react";
import { cn, haptic, IconButton, useMounted } from "./primitives";
import { DURATION, EASE_ENTER, EASE_EXIT } from "./motion";
import { coverStage, PANEL_EXIT_MS } from "./stage";
import { useVisibleViewport } from "./visible-viewport";

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

// Sheets arrive in 400ms, fast then settling, and leave in 250ms, gently then
// fast: leaving is always quicker than arriving (MOTION-SPEC 3). No overshoot.
const ENTER = { duration: DURATION.panel, ease: EASE_ENTER };
const EXIT = { duration: PANEL_EXIT_MS / 1000, ease: EASE_EXIT };
const FADE = { duration: DURATION.fade, ease: EASE_EXIT };

/**
 * Open sheets, oldest first. Panels open on top of one another - the split
 * editor over the expense composer - and Escape must close only the top one.
 * Each used to listen on its own, so one key press closed every panel at once
 * and threw away the expense being typed underneath.
 */
const sheetStack: object[] = [];

// Who is listening for the stack to change, so a panel knows when another
// has opened on top of it.
const stackListeners = new Set<() => void>();
const stackChanged = () => {
  shutOffBehindTopSheet();
  stackListeners.forEach((listener) => listener());
};

/** Where each open panel sits in the page, by its place in the stack. */
const sheetRoots = new Map<object, HTMLElement>();
/** What this file made inert, so it only ever undoes its own. */
const madeInert = new Set<HTMLElement>();

/**
 * Only the top panel can be reached. Everything else in the page, the panel
 * underneath included, is `inert` while it is open: Tab used to walk straight
 * out of a panel into the page behind it, and a screen reader could read the
 * page as though nothing covered it. Announcements stay live, so "Copied"
 * from inside a panel is still heard.
 */
function shutOffBehindTopSheet() {
  const top = sheetRoots.get(sheetStack[sheetStack.length - 1]);
  const keep = (element: Element) =>
    element === top || element.matches('[aria-live], [role="status"], [role="alert"], next-route-announcer');
  for (const element of madeInert) {
    if (top && !keep(element)) continue;
    element.inert = false;
    madeInert.delete(element);
  }
  if (!top) return;
  for (const element of document.body.children) {
    if (!(element instanceof HTMLElement) || element.inert || keep(element)) continue;
    element.inert = true;
    madeInert.add(element);
  }
}

/**
 * Focus goes back to the button that opened a panel when it closes, so the
 * next Tab carries on from there. It used to drop to the top of the page.
 * Only if focus is still in the closing panel, or nowhere: if it has moved on
 * (to a panel opened in its place, or a new screen), it stays where it went.
 */
/**
 * What had focus before what has it now. A panel that puts the cursor in its
 * field as it opens has already taken focus by the time it can look, so the
 * button that opened it is the one before.
 */
let focusedBefore: Element | null = null;
let focusedNow: Element | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (event) => {
      focusedBefore = focusedNow;
      focusedNow = event.target as Element;
    },
    true,
  );
}

/** The button a panel was opened from, even if a field in it already has focus. */
function openerOf(root: HTMLElement | undefined): Element | null {
  const now = document.activeElement;
  return root && now && root.contains(now) ? focusedBefore : now;
}

function giveFocusBack(opener: Element | null, closing: HTMLElement | undefined) {
  const now = document.activeElement;
  const stranded = !now || now === document.body || (closing?.contains(now) ?? false);
  if (stranded && opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
}

function subscribeStack(listener: () => void) {
  stackListeners.add(listener);
  return () => stackListeners.delete(listener);
}

/**
 * Whether another panel is open on top of this one. A panel that opened from
 * a panel (the split editor over the expense) makes the first one step back,
 * so it reads as belonging to it rather than as a second, unrelated page.
 */
function useCoveredBySheet(token: object, open: boolean): boolean {
  return React.useSyncExternalStore(
    subscribeStack,
    () => open && sheetStack.includes(token) && sheetStack[sheetStack.length - 1] !== token,
    () => false,
  );
}

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
  /** What a screen reader announces when the title is not plain text. */
  ariaLabel?: string;
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
  ariaLabel,
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

  // Place in the stack depends only on when this sheet opened, so a parent
  // re-rendering (say, as someone types) can never jump above its child.
  const [token] = React.useState(() => ({}));
  const close = React.useRef({ onClose, dismissible });
  React.useEffect(() => {
    close.current = { onClose, dismissible };
  });
  React.useEffect(() => {
    if (!open) return;
    const me = token;
    const opener = openerOf(sheetRoots.get(me));
    sheetStack.push(me);
    stackChanged();
    const uncover = coverStage();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !close.current.dismissible) return;
      if (sheetStack[sheetStack.length - 1] !== me) return;
      close.current.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      uncover();
      const index = sheetStack.lastIndexOf(me);
      if (index !== -1) sheetStack.splice(index, 1);
      stackChanged();
      giveFocusBack(opener, sheetRoots.get(me));
    };
  }, [open, token]);

  const covered = useCoveredBySheet(token, open);

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
          ariaLabel={ariaLabel}
          covered={covered}
          token={token}
        >
          {children}
        </SheetBody>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * Keeps a panel out of the page while it is shut.
 *
 * A closed Sheet draws nothing, but it is still there: its hooks run and its
 * contents are worked out every time the screen behind it redraws. With a
 * menu behind every row of a long ledger, that was a hundred hidden panels
 * redrawing each time a payment was saved, on the same beat as the panel
 * sliding away. Wrapped in this, a panel exists from the moment it opens until
 * its closing slide has finished, and not at all otherwise.
 */
export function WhileOpen({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [shown, setShown] = React.useState(open);
  if (open && !shown) setShown(true);
  React.useEffect(() => {
    if (open || !shown) return;
    // A little longer than the closing slide, so it is never cut short.
    const timer = window.setTimeout(() => setShown(false), PANEL_EXIT_MS + 100);
    return () => window.clearTimeout(timer);
  }, [open, shown]);
  return shown ? children : null;
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
  ariaLabel,
  covered,
  token,
}: Omit<SheetProps, "open"> & { covered: boolean; token: object }) {
  const y = useMotionValue(0);

  // This panel's place in the page, so the rest can be shut off behind it.
  const root = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    sheetRoots.set(token, element);
    shutOffBehindTopSheet();
    return () => {
      if (sheetRoots.get(token) === element) sheetRoots.delete(token);
      shutOffBehindTopSheet();
    };
  }, [token]);

  // Focus moves into the panel as it opens, unless a field in it has already
  // taken it, so the keyboard and screen readers start inside. The panel
  // itself takes it rather than its first control, which would light a ring
  // on Close, or raise a phone's keyboard for a field nobody chose.
  const dialog = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const element = dialog.current;
      if (element && !element.contains(document.activeElement)) element.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const reduce = useReducedMotion();
  // The backdrop fades as the sheet is dragged down, so the gesture feels
  // connected to the page behind it rather than to the sheet alone.
  const backdropOpacity = useTransform(y, [0, 400], [1, 0]);

  const handleDragEnd = (_event: unknown, info: PanInfo) => {
    const thrown = info.velocity.y > 520;
    const dragged = info.offset.y > 140;
    if (dismissible && (thrown || dragged)) {
      // Letting go has already started the spring back to the top. Stop it,
      // so the panel leaves from where the finger let go of it rather than
      // first rising back towards it.
      y.stop();
      haptic(6);
      onClose();
    }
  };

  const visible = useVisibleViewport();
  const scroller = React.useRef<HTMLDivElement>(null);

  /*
   * False from the moment the sheet is told to close until its exit animation
   * finishes and it unmounts.
   *
   * During that time the full-screen wrapper below was still there, fully
   * clickable, just fading - so a tap on the page in the half-second after
   * closing a sheet landed on an invisible layer and did nothing. Closing a
   * sheet and tapping the next thing is exactly what people do, which made it
   * the most common "I pressed it and nothing happened". A sheet on its way
   * out now lets every tap through.
   */
  const present = useIsPresent();

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
      ref={root}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{
        ...(visible ? { top: visible.top, height: visible.height, bottom: "auto" } : {}),
        pointerEvents: present ? undefined : "none",
      }}
      aria-hidden={present ? undefined : true}
    >
      {/*
        The dim behind the panel, in two layers: the outer fades in and out
        with the panel, the inner follows a drag. As one element the two
        fought over its opacity and the drag won, freezing the fade a few
        percent in, so the page behind barely darkened at all and the tab bar
        seemed to pop back when a panel closed.
      */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: EXIT }}
        transition={ENTER}
        onClick={() => dismissible && onClose()}
        className="absolute inset-0"
      >
        <motion.div style={{ opacity: backdropOpacity }} className="absolute inset-0 bg-overlay" />
      </motion.div>

      {/*
        The slide in and out, on a wrapper of its own. The panel inside is
        also moved by a finger (its `y`), and a value moved by hand has to be
        animated by script, frame by frame, on the same thread that is busy
        saving. A plain `transform` here is handed to the browser, which runs
        it on its own (POLISH-AUDIT 3). With Reduce Motion it fades instead
        (MOTION-SPEC 6): Motion's own setting doesn't cover a plain transform.
      */}
      <motion.div
        initial={reduce ? { opacity: 0, transform: "translateY(0%)" } : { transform: "translateY(100%)" }}
        animate={reduce ? { opacity: 1, transform: "translateY(0%)" } : { transform: "translateY(0%)" }}
        exit={
          reduce
            ? { opacity: 0, transition: FADE }
            : { transform: "translateY(100%)", transition: EXIT }
        }
        transition={reduce ? FADE : ENTER}
        className={cn(
          "relative flex w-full flex-col sm:max-w-[440px]",
          // Percentages, not `dvh`: they resolve against the container above,
          // which has already had the keyboard subtracted from it.
          tall ? "h-[92%] sm:h-[min(86dvh,760px)]" : "max-h-[90%]",
        )}
      >
      <motion.div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={typeof title === "string" ? title : (ariaLabel ?? "Dialog")}
        initial={{ y: 0, scale: 1 }}
        // With a panel open on top, this one steps back a little: smaller,
        // and dimmed by the other's backdrop (MOTION-SPEC 1).
        animate={{ scale: covered && !reduce ? 0.95 : 1 }}
        transition={ENTER}
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
          // No ring on the panel itself when it takes focus: it isn't a control.
          "relative flex min-h-0 w-full flex-col overflow-hidden bg-elevated shadow-sheet outline-none",
          "rounded-t-[var(--radius-2xl)] sm:rounded-[var(--radius-xl)]",
          // Sized by the wrapper: all of it when tall, otherwise as much as
          // the content needs, up to the wrapper's limit.
          tall && "flex-1",
          className,
        )}
      >
        {/*
          Grab handle. Decorative on desktop, load-bearing on a phone — and now
          literally the handle: it and the title bar are what start a drag.
          `touch-action: none` stops the browser claiming the gesture as a
          scroll before Motion sees it.
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
            <h2 className="text-title font-semibold tracking-[-0.01em] text-text">{title}</h2>
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
    <WhileOpen open={open}>
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="px-5 pb-5">
        {description ? (
          <p className="text-subhead leading-relaxed text-muted">{description}</p>
        ) : null}
        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="h-11 flex-1 rounded-[var(--radius-md)] border border-line bg-surface-2 text-subhead font-semibold text-text transition active:opacity-70"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "h-11 flex-1 rounded-[var(--radius-md)] text-subhead font-semibold text-inverse transition active:opacity-70 disabled:opacity-60",
              tone === "danger" ? "bg-danger" : "bg-brand",
            )}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
    </WhileOpen>
  );
}
