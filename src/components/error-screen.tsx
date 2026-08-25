"use client";

import * as React from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "./ui/primitives";

/**
 * What a route-level error boundary renders.
 *
 * Shared by the boundaries at `app/error.tsx` and `app/(app)/error.tsx` so a
 * failure looks the same wherever it happens. The error's own text is
 * deliberately not shown: in production Next.js replaces the message with a
 * digest, and "Minified React error #418" tells someone splitting a dinner
 * bill nothing they can act on. The digest is printed small, because it is the
 * one thing worth quoting in a bug report.
 */
export function ErrorScreen({
  error,
  reset,
  title = "This screen stopped working",
  description = "Nothing was lost — your expenses live on the server, not in this screen. Try again, and if it keeps happening, reopen the app.",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
}) {
  React.useEffect(() => {
    console.error("[divvy] screen failed to render", error);
  }, [error]);

  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-8 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-[var(--radius-lg)] bg-warning-soft text-text">
        <TriangleAlert size={22} />
      </div>
      <p className="text-[16px] font-semibold text-text">{title}</p>
      <p className="mt-1.5 max-w-[34ch] text-[14px] leading-relaxed text-muted">
        {description}
      </p>
      <div className="mt-5 flex gap-2">
        <Button variant="primary" icon={<RefreshCw size={16} />} onClick={reset}>
          Try again
        </Button>
        {/*
          A full page load, not a router push: the React tree is the thing that
          just broke, and a client-side navigation would reuse it. The URL is
          built absolute because Next patches history and resolves a bare "/"
          against the router's idea of the current route rather than the origin.
        */}
        <Button
          variant="secondary"
          onClick={() => window.location.assign(window.location.origin)}
        >
          Go home
        </Button>
      </div>
      {error.digest ? (
        <p className="display-number mt-6 text-[11px] text-subtle">
          Reference {error.digest}
        </p>
      ) : null}
    </div>
  );
}
