"use client";

import * as React from "react";
import { cn } from "./primitives";

/**
 * The QR code library (about 10 KB), fetched once the page has finished loading
 * rather than with it. A code is only drawn when a panel opens, and the group
 * page has no room for the library in what it downloads to show itself
 * (MOTION-SPEC 7). One fetch, shared by every code in the app; a failed one
 * (offline before it ever arrived) is tried again next time.
 */
let loading: Promise<typeof import("qrcode")> | null = null;
export function loadQrLibrary(): Promise<typeof import("qrcode")> {
  return (loading ??= import("qrcode").catch((error: unknown) => {
    loading = null;
    throw error;
  }));
}

if (typeof window !== "undefined") {
  const fetchIt = () => void loadQrLibrary().catch(() => {});
  if (document.readyState === "complete") fetchIt();
  else window.addEventListener("load", fetchIt, { once: true });
}

/**
 * A QR code, ink on paper in both themes (a scanner needs dark on light), drawn
 * as SVG so it stays sharp at any size and needs no network.
 */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const [svg, setSvg] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!value) return;
    let cancelled = false;
    void loadQrLibrary()
      .then((QRCode) =>
        QRCode.toString(value, {
          type: "svg",
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#141412", light: "#ffffff" },
        }),
      )
      .then((markup) => {
        if (!cancelled) setSvg(markup);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "size-48 overflow-hidden rounded-[var(--radius-lg)] border border-line bg-white p-2 [&_svg]:size-full",
        className,
      )}
      // Generated locally from the invite link; contains no user-supplied markup.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
