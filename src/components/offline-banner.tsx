"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CloudOff, RefreshCw } from "lucide-react";
import { flush, pending, subscribe, type QueuedMutation } from "@/lib/client/outbox";

/**
 * The offline indicator.
 *
 * Two states worth telling the user apart, because they mean different things:
 *
 *   - **offline** - the network is gone. Reassurance, not an error: what you
 *     type is being kept.
 *   - **queued while online** - there is unsent work despite a connection,
 *     which usually means the server is unreachable rather than the phone. That
 *     one gets a manual retry, because the user may know something we do not
 *     (they just reconnected to a working wifi, say).
 *
 * Nothing is shown when there is a connection and nothing queued. A permanent
 * "online" badge is noise.
 */
export function OfflineBanner() {
  const [online, setOnline] = React.useState(true);
  const [queue, setQueue] = React.useState<QueuedMutation[]>([]);
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
    };
    refresh();
    return subscribe(refresh);
  }, []);

  const visible = !online || queue.length > 0;

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
          <div
            className="mx-auto flex max-w-[560px] items-center gap-2.5 px-4 py-2 lg:max-w-[720px] lg:px-8"
            role="status"
          >
            <span className="flex items-center gap-2 rounded-full bg-warning-soft px-3 py-1.5 text-[12px] font-semibold text-text">
              <CloudOff className="size-3.5 shrink-0" />
              {!online
                ? queue.length > 0
                  ? `Offline · ${queue.length} change${queue.length === 1 ? "" : "s"} will sync`
                  : "Offline · your changes are saved here"
                : `${queue.length} change${queue.length === 1 ? "" : "s"} waiting to sync`}
            </span>

            {online && queue.length > 0 ? (
              <button
                onClick={retry}
                disabled={retrying}
                className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] font-bold text-brand transition active:scale-95 disabled:opacity-50"
              >
                <RefreshCw className={retrying ? "size-3.5 animate-spin" : "size-3.5"} />
                Retry
              </button>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
