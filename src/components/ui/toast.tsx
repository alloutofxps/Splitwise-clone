"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, CloudOff, Info, TriangleAlert, Undo2 } from "lucide-react";
import { cn, haptic, useMounted } from "./primitives";
import { DURATION, EASE_ENTER, EASE_EXIT } from "./motion";
import { PANEL_EXIT_MS, stageNow, untilClear, useStage, type StageState } from "./stage";

export type ToastTone = "success" | "error" | "info" | "offline";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  duration?: number;
  /**
   * An undo affordance, offered wherever the action can genuinely be reversed —
   * which for deleting an expense means everywhere, since the row is tombstoned
   * rather than destroyed and every balance is derived from live rows.
   *
   * Deleting a recorded *payment* is still confirm-only: it can be undone, but
   * a payment that squared up several ledgers at once comes back as a batch,
   * and that is not wired yet.
   *
   * Where it is offered the toast lingers longer, because an undo nobody had
   * time to read is decoration. It does not replace the confirm dialog in
   * front of them.
   */
  action?: { label: string; onClick: () => void };
}

interface ToastRecord extends ToastOptions {
  id: number;
  /**
   * Raised while a panel was open. "Added Tapas" is the panel's way of saying
   * it is done, so it waits for the panel to leave instead of rising through
   * it (MOTION-SPEC 4, toasts). Errors never wait: the panel stays open for
   * them, and they are about what is on it.
   */
  afterPanel: boolean;
}

const ToastContext = React.createContext<((options: ToastOptions) => void) | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const nextId = React.useRef(0);
  const timers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = React.useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      // An undo needs longer than an acknowledgement - the user has to read it,
      // decide, and reach for it.
      const afterPanel = options.tone !== "error" && stageNow().covered;
      const duration = (options.duration ?? (options.action ? 7000 : 3600)) + (afterPanel ? PANEL_EXIT_MS : 0);

      setToasts((current) => [...current.slice(-2), { ...options, id, afterPanel }]);
      haptic(options.tone === "error" ? [12, 40, 12] : 8);

      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
    },
    [dismiss],
  );

  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const show = React.useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside ToastProvider");
  return show;
}

const ICONS: Record<ToastTone, React.ReactNode> = {
  success: <CheckCircle2 className="size-[18px]" strokeWidth={1.75} />,
  error: <TriangleAlert className="size-[18px]" strokeWidth={1.75} />,
  info: <Info className="size-[18px]" strokeWidth={1.75} />,
  offline: <CloudOff className="size-[18px]" strokeWidth={1.75} />,
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: number) => void;
}) {
  const mounted = useMounted();
  const stage = useStage();
  // Let held toasts rise once the panel has finished leaving. The timer
  // firing is the signal, not a second look at the clock: timers can fire a
  // fraction of a millisecond early, and a toast held on that re-check had
  // nothing left to wake it, so it never appeared.
  const [clearedStage, setClearedStage] = React.useState<StageState | null>(null);
  React.useEffect(() => {
    if (stage.covered) return;
    const wait = untilClear(stage);
    if (wait === 0) return;
    const timer = window.setTimeout(() => setClearedStage(stage), wait);
    return () => window.clearTimeout(timer);
  }, [stage]);
  const panelGone = !stage.covered && (clearedStage === stage || untilClear(stage) === 0);
  if (!mounted) return null;
  const visible = toasts.filter((toast) => !toast.afterPanel || panelGone);

  return createPortal(
    <div
      // Above the bottom nav on mobile so it never covers the tab bar, and
      // bottom-right on desktop where the eye is already near the content.
      className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:items-end"
      role="status"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {visible.map((toast) => (
          <motion.div
            key={toast.id}
            // No \`layout\`: it had the page measured on every frame while a
            // toast was up, which is exactly when money is counting.
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            // Taps pass through as soon as it starts leaving, not when it is gone.
            exit={{ opacity: 0, pointerEvents: "none", transition: { duration: DURATION.fade, ease: EASE_EXIT } }}
            transition={{ duration: DURATION.quick, ease: EASE_ENTER }}
            // A toast sits above everything, sheets included, so for the few
            // seconds it is up it covers whatever is beneath it. Tapping it
            // dismisses it, rather than the tap simply being swallowed - and the
            // finger that wanted the button underneath gets it on the next tap.
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button")) return;
              onDismiss(toast.id);
            }}
            className={cn(
              // An ink bar: one line, and one action when there is something to undo.
              "pointer-events-auto flex w-full max-w-[420px] cursor-pointer items-center gap-3 rounded-[var(--radius-md)]",
              "bg-text px-4 py-3 text-inverse shadow-raised",
            )}
          >
            <span className="shrink-0 opacity-80">{ICONS[toast.tone ?? "info"]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium leading-snug">{toast.title}</p>
              {toast.description ? (
                <p className="mt-0.5 text-caption leading-snug opacity-70">{toast.description}</p>
              ) : null}
            </div>
            {toast.action ? (
              <button
                onClick={() => {
                  toast.action?.onClick();
                  onDismiss(toast.id);
                }}
                className="-my-1 flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1.5 text-body font-semibold underline-offset-2 transition-opacity hover:underline active:opacity-70"
              >
                <Undo2 className="size-3.5" />
                {toast.action.label}
              </button>
            ) : null}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
