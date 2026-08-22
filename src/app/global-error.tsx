"use client";

import * as React from "react";

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
          background: "#fafafa",
          color: "#17161a",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <style>{`
          @media (prefers-color-scheme: dark) {
            body { background: #111014 !important; color: #f4f3f6 !important; }
            .divvy-muted { color: #a3a1ab !important; }
            .divvy-secondary { background: #26242c !important; color: #f4f3f6 !important; border-color: #37343f !important; }
          }
        `}</style>
        <main style={{ maxWidth: "24rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.0625rem", fontWeight: 600, margin: 0 }}>
            Divvy could not start
          </h1>
          <p
            className="divvy-muted"
            style={{
              margin: "0.5rem 0 0",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              color: "#6c6a75",
            }}
          >
            Your data is safe on the server. Reloading fixes this almost every
            time.
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
              onClick={() => window.location.reload()}
              style={{
                appearance: "none",
                border: 0,
                borderRadius: "0.75rem",
                padding: "0.6875rem 1rem",
                fontSize: "0.9375rem",
                fontWeight: 600,
                background: "#16a34a",
                color: "#fff",
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
                border: "1px solid #e4e2e8",
                padding: "0.6875rem 1rem",
                fontSize: "0.9375rem",
                fontWeight: 600,
                background: "#f1eff3",
                color: "#17161a",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
          {error.digest ? (
            <p
              className="divvy-muted"
              style={{
                marginTop: "1.5rem",
                fontSize: "0.6875rem",
                color: "#8a8892",
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
