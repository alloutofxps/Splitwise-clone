"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CloudOff, RefreshCw, TriangleAlert, X } from "lucide-react";
import { cn } from "./ui/primitives";
import {
  discardAllRejected,
  discardRejected,
  flush,
  pending,
  rejected,
  retryRejected,
  subscribe,
  type QueuedMutation,
  type RejectedMutation,
} from "@/lib/client/outbox";

/**
 * The offline indicator.
 *
 * Three states worth telling the user apart, because they mean different
 * things:
 *
 *   - **offline** - the network is gone. Reassurance, not an error: what you
 *     type is being kept.
 *   - **queued while online** - there is unsent work despite a connection,
 *     which usually means the server is unreachable rather than the phone. That
 *     one gets a manual retry, because the user may know something we do not
 *     (they just reconnected to a working wifi, say).
 *   - **rejected** - the server refused something outright. This is the only
 *     one that is genuinely bad news, and it is the reason this component
 *     cannot just be a spinner: an expense that was typed and will never exist
 *     has to be said out loud, in the server's own words, with the choice of
 *     trying again or letting it go.
 *
 * Nothing is shown when there is a connection, nothing queued and nothing
 * rejected. A permanent "online" badge is noise.
 */
export function OfflineBanner() {
  const [online, setOnline] = React.useState(true);
  const [queue, setQueue] = React.useState<QueuedMutation[]>([]);
  const [failures, setFailures] = React.useState<RejectedMutation[]>([]);
  const [retrying, setRetrying] = React.useState(false);

  React.useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();

    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  React.useEffect(() => {
    const refresh = () => {
      void pending().then(setQueue);
      void rejected().then(setFailures);
    };
    refresh();
    return subscribe(refresh);
  }, []);

  const visible = !online || queue.length > 0 || failures.length > 0;

  const retry = async () => {
    setRetrying(true);
    try {
      await flush();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="no-print overflow-hidden"
        >
          <div className="mx-auto max-w-[560px] px-4 py-2 lg:max-w-[720px] lg:px-8">
            {!online || queue.length > 0 ? (
              <div className="flex items-center gap-2.5" role="status">
                <span className="flex items-center gap-2 rounded-full bg-warning-soft px-3 py-1.5 text-caption font-semibold text-text">
                  <CloudOff className="size-3.5 shrink-0" />
                  {!online
                    ? queue.length > 0
                      ? `Offline · ${queue.length} change${queue.length === 1 ? "" : "s"} will sync`
                      : "Offline · your changes are saved here"
                    : `${queue.length} change${queue.length === 1 ? "" : "s"} waiting to sync`}
                </span>

                {online && queue.length > 0 ? (
                  <button
                    onClick={() => void retry()}
                    disabled={retrying}
                    className="flex items-center gap-1.5 rounded-full px-2 py-1 text-caption font-bold text-brand transition active:scale-95 disabled:opacity-50"
                  >
                    <RefreshCw className={retrying ? "size-3.5 animate-spin" : "size-3.5"} />
                    Retry
                  </button>
                ) : null}
              </div>
            ) : null}

            {failures.length > 0 ? (
              // role=alert rather than status: this one has already happened and
              // the user has lost something, so it is worth interrupting for.
              <div
                role="alert"
                className={cn(
                  "rounded-[var(--radius-md)] border border-line bg-negative-soft px-3 py-2.5",
                  // Only spaced when it sits under the offline pill.
                  (!online || queue.length > 0) && "mt-2",
                )}
              >
                <div className="flex items-center gap-2">
                  <TriangleAlert className="size-3.5 shrink-0 text-negative-text" />
                  <p className="flex-1 text-caption font-bold text-negative-text">
                    {failures.length === 1
                      ? "1 change could not be saved"
                      : `${failures.length} changes could not be saved`}
                  </p>
                  {failures.length > 1 ? (
                    <button
                      onClick={() => void discardAllRejected()}
                      className="shrink-0 rounded-full px-2 py-0.5 text-caption font-semibold text-muted transition active:scale-95"
                    >
                      Dismiss all
                    </button>
                  ) : null}
                </div>

                <ul className="mt-2 space-y-2">
                  {failures.map((failure) => (
                    <li
                      key={failure.id}
                      className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-surface px-2.5 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-semibold text-text">
                          {failure.label}
                        </p>
                        {/* The server's message, verbatim. Every one of them is
                            written to be read by a person. */}
                        <p className="mt-0.5 text-caption leading-snug text-muted">
                          {failure.reason}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => void retryRejected(failure.id)}
                          className="rounded-full px-2 py-1 text-caption font-bold text-brand transition active:scale-95"
                        >
                          Retry
                        </button>
                        <button
                          onClick={() => void discardRejected(failure.id)}
                          aria-label={`Dismiss ${failure.label}`}
                          className="flex size-6 items-center justify-center rounded-full text-subtle transition active:scale-90"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
