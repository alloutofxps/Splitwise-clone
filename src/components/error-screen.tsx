"use client";

import * as React from "react";
import { clsx } from "clsx";
import { RefreshCw } from "lucide-react";
import { BUTTON_BASE, BUTTON_SIZES, BUTTON_VARIANTS } from "./ui/button-style";
import { FlowDoodle } from "./ui/doodle";
import { haptic } from "./ui/haptic";
import { reportError } from "./error-reporter";

/**
 * What a route-level error boundary renders.
 *
 * Shared by the boundaries at `app/error.tsx` and `app/(app)/error.tsx` so a
 * failure looks the same wherever it happens. The error's own text is
 * deliberately not shown: in production Next.js replaces the message with a
 * digest, and "Minified React error #418" tells someone splitting a dinner
 * bill nothing they can act on. The digest is printed small, because it is the
 * one thing worth quoting in a bug report.
 *
 * Built from small pieces rather than `primitives.tsx`: the boundaries are
 * loaded with every page, and each would otherwise carry a copy of it.
 */
export function ErrorScreen({
  error,
  reset,
  title = "Something went wrong",
  description = "Your expenses are safe. Try again, and if it keeps happening, close and reopen the app.",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
}) {
  React.useEffect(() => {
    console.error("[divvy] screen failed to render", error);
    reportError("screen", error);
  }, [error]);

  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-8 text-center">
      <FlowDoodle className="mb-5" />
      <p className="text-title font-semibold text-text">{title}</p>
      <p className="mt-1.5 max-w-[34ch] text-body-lg leading-relaxed text-muted">
        {description}
      </p>
      <div className="mt-5 flex gap-2">
        <ScreenButton variant="primary" onClick={reset}>
          <RefreshCw size={16} />
          Try again
        </ScreenButton>
        {/*
          A full page load, not a router push: the React tree is the thing that
          just broke, and a client-side navigation would reuse it. The URL is
          built absolute because Next patches history and resolves a bare "/"
          against the router's idea of the current route rather than the origin.
        */}
        <ScreenButton
          variant="secondary"
          onClick={() => window.location.assign(window.location.origin)}
        >
          Go home
        </ScreenButton>
      </div>
      {error.digest ? (
        <p className="display-number mt-6 text-tiny text-subtle">
          Reference {error.digest}
        </p>
      ) : null}
    </div>
  );
}

/** The app's medium button, as `Button` draws it, without its busy state. */
function ScreenButton({
  variant,
  onClick,
  children,
}: {
  variant: "primary" | "secondary";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={() => {
        haptic();
        onClick();
      }}
      className={clsx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES.md)}
    >
      {children}
    </button>
  );
}
