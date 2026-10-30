"use client";

import * as React from "react";
import { reportError } from "@/components/error-reporter";

/**
 * The last boundary.
 *
 * This one replaces the root layout, which means the app's stylesheet, fonts
 * and providers are all gone by the time it renders - so it can rely on
 * nothing but inline styles and a <style> block. Every rule here is written
 * with that in mind; importing the design system would be a second chance to
 * throw at the exact moment there is nothing left to catch it.
 *
 * Reaching this screen means the failure was in the root layout or a provider.
 * `reset()` re-renders that tree, but if a provider is the thing throwing it
 * will simply throw again, so a hard reload is offered alongside it.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[divvy] the app failed to start", error);
    reportError("screen", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          // The palette written out (bg, text): the stylesheet is gone here.
          background: "#fafaf8",
          color: "#141412",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <style>{`
          @media (prefers-color-scheme: dark) {
            body { background: #0b0b0a !important; color: #f3f2ee !important; }
            .divvy-muted { color: #bcb6b2 !important; }
            .divvy-faint { color: #a09b93 !important; }
            .divvy-primary { background: #f3f2ee !important; color: #0b0b0a !important; }
            .divvy-secondary { background: #141413 !important; color: #f3f2ee !important; border-color: #3b3a36 !important; }
          }
        `}</style>
        <main style={{ maxWidth: "24rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.0625rem", fontWeight: 600, margin: 0 }}>
            Divvy couldn&rsquo;t open
          </h1>
          <p
            className="divvy-muted"
            style={{
              margin: "0.5rem 0 0",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              color: "#57534e",
            }}
          >
            Your data is safe. Reloading the page usually fixes this.
          </p>
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              justifyContent: "center",
              marginTop: "1.25rem",
            }}
          >
            <button
              type="button"
              className="divvy-primary"
              onClick={() => window.location.reload()}
              style={{
                appearance: "none",
                border: 0,
                borderRadius: "0.75rem",
                padding: "0.6875rem 1rem",
                fontSize: "0.9375rem",
                fontWeight: 600,
                background: "#141412",
                color: "#fafaf8",
                cursor: "pointer",
              }}
            >
              Reload
            </button>
            <button
              type="button"
              className="divvy-secondary"
              onClick={reset}
              style={{
                appearance: "none",
                borderRadius: "0.75rem",
                border: "1px solid #d4d1cb",
                padding: "0.6875rem 1rem",
                fontSize: "0.9375rem",
                fontWeight: 600,
                background: "#ffffff",
                color: "#141412",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
          {error.digest ? (
            <p
              className="divvy-faint"
              style={{
                marginTop: "1.5rem",
                fontSize: "0.6875rem",
                color: "#6c6760",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              Reference {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
