"use client";

import * as React from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { RefreshCw } from "lucide-react";
import { ApiError } from "@/lib/client/api";
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

/**
 * A screen whose data didn't arrive: the same drawing and layout as a crash,
 * inside the app frame so the tab bar is still there, and one honest line
 * about what happened.
 *
 * The words follow the cause. Offline says so. A 403 or 404 means the thing
 * was deleted or you're no longer in it, where trying again can't help, so it
 * offers the way back instead. Anything else is Divvy's fault, said plainly.
 *
 * Takes the query itself. A query opened while offline never fails: it waits
 * ("paused") with no error and no data, and starts by itself once the
 * connection is back. And while it is fetching again its state stays "error"
 * until an answer comes, so the button shows it is working.
 */
export function LoadFailed({ query }: { query: FailedQuery }) {
  const { error } = query;
  const status = error instanceof ApiError ? error.status : query.fetchStatus === "paused" ? 0 : undefined;
  const gone = status === 403 || status === 404;
  const words = gone
    ? {
        title: "Nothing here",
        description: "This was deleted, or you're no longer part of it. Your other groups and expenses are fine.",
      }
    : status === 0
      ? {
          title: "You're offline",
          description: "Divvy will load this when you're back online. Anything you add is kept until then.",
        }
      : {
          title: "Couldn't load this",
          description: "Divvy didn't answer properly. Your expenses are safe. Try again in a moment.",
        };

  return (
    <div role="alert" className="flex min-h-[60dvh] flex-col items-center justify-center px-8 text-center">
      <FlowDoodle className="mb-5" />
      {/* The screen's heading: it stands in for the screen that didn't load. */}
      <h1 className="text-title font-semibold text-text">{words.title}</h1>
      <p className="mt-1.5 max-w-[34ch] text-body-lg leading-relaxed text-muted">{words.description}</p>
      <div className="mt-5 flex gap-2">
        {gone ? (
          <Link
            href="/"
            onClick={() => haptic()}
            className={clsx(BUTTON_BASE, BUTTON_VARIANTS.primary, BUTTON_SIZES.md)}
          >
            Back to Divvy
          </Link>
        ) : (
          <ScreenButton variant="primary" onClick={() => void query.refetch()} busy={query.fetchStatus === "fetching"}>
            <RefreshCw size={16} />
            Try again
          </ScreenButton>
        )}
      </div>
    </div>
  );
}

/** What `LoadFailed` reads from a TanStack query, plain or infinite. */
export interface FailedQuery {
  error: unknown;
  fetchStatus: "fetching" | "paused" | "idle";
  refetch: () => unknown;
}

/** The app's medium button, as `Button` draws it. */
function ScreenButton({
  variant,
  onClick,
  busy = false,
  children,
}: {
  variant: "primary" | "secondary";
  onClick: () => void;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={() => {
        haptic();
        onClick();
      }}
      disabled={busy}
      aria-busy={busy || undefined}
      className={clsx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES.md)}
    >
      {children}
      {/* Working: the thin line `Button` draws, not a spinner over the label. */}
      {busy ? <span aria-hidden className="divvy-progress absolute inset-x-0 bottom-0 h-[2px]" /> : null}
    </button>
  );
}
