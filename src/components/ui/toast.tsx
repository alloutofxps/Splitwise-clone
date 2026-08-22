"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, CloudOff, Info, TriangleAlert, Undo2 } from "lucide-react";
import { cn, haptic } from "./primitives";

export type ToastTone = "success" | "error" | "info" | "offline";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  duration?: number;
  /**
   * An undo affordance. Present on every destructive action in the app, which
   * is what lets those actions happen immediately without a confirm dialog in
   * front of them.
   */
  action?: { label: string; onClick: () => void };
}

interface ToastRecord extends ToastOptions {
  id: number;
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
      const duration = options.duration ?? (options.action ? 7000 : 3600);

      setToasts((current) => [...current.slice(-2), { ...options, id }]);
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
  success: <CheckCircle2 className="size-[18px] text-positive" />,
  error: <TriangleAlert className="size-[18px] text-negative" />,
  info: <Info className="size-[18px] text-brand" />,
  offline: <CloudOff className="size-[18px] text-muted" />,
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: number) => void;
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      // Above the bottom nav on mobile so it never covers the tab bar, and
      // bottom-right on desktop where the eye is already near the content.
      className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:items-end"
      role="status"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 500, damping: 40 }}
            className={cn(
              "pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-[--radius-lg]",
              "border border-line bg-elevated px-4 py-3 shadow-float",
            )}
          >
            <span className="mt-0.5 shrink-0">{ICONS[toast.tone ?? "info"]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold leading-snug text-text">{toast.title}</p>
              {toast.description ? (
                <p className="mt-0.5 text-[13px] leading-snug text-muted">{toast.description}</p>
              ) : null}
            </div>
            {toast.action ? (
              <button
                onClick={() => {
                  toast.action?.onClick();
                  onDismiss(toast.id);
                }}
                className="-my-1 flex shrink-0 items-center gap-1 rounded-[--radius-sm] px-2 py-1.5 text-[13px] font-bold text-brand transition active:scale-95 hover:bg-brand-soft"
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
