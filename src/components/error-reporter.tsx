"use client";

import * as React from "react";

/**
 * Sends crashes on this phone to the server (api/client-errors), so the owner
 * hears about them instead of only the person who saw "Something went wrong".
 *
 * Kept small and quiet: at most five reports a page load, each message once,
 * nothing from browser extensions or other sites' scripts, and nothing at all
 * in development. A report that can't be sent is dropped.
 */

const MAX_REPORTS = 5;
const NETWORK_FAILURE = /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|The network connection was lost\.?)$/;
const sent = new Set<string>();

export function reportError(kind: "error" | "rejection" | "screen", error: unknown): void {
  if (process.env.NODE_ENV !== "production" || typeof window === "undefined") return;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
  // "Script error." is what a cross-origin script's error looks like, and
  // ResizeObserver's loop warning is harmless; neither says anything useful.
  if (!message || message === "Script error." || message.startsWith("ResizeObserver loop")) return;
  // A dropped connection on a weak signal is not a crash: the offline outbox
  // keeps the change and sends it later. Chrome, Safari and Firefox word it
  // differently.
  if (NETWORK_FAILURE.test(message) || (error instanceof Error && error.name === "AbortError")) return;
  if (sent.size >= MAX_REPORTS || sent.has(message)) return;
  sent.add(message);

  void fetch("/api/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind,
      message,
      stack: error instanceof Error ? error.stack?.slice(0, 2000) : undefined,
      path: window.location.pathname.slice(0, 200),
      build: process.env.NEXT_PUBLIC_BUILD_ID,
    }),
    keepalive: true,
  }).catch(() => {});
}

export function ErrorReporter() {
  React.useEffect(() => {
    const onError = (event: ErrorEvent) => {
      // Only this site's own scripts: extensions inject code that fails in
      // ways Divvy can't fix.
      if (event.filename && !event.filename.startsWith(window.location.origin)) return;
      reportError("error", event.error ?? event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => reportError("rejection", event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
