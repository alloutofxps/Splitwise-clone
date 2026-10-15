"use client";

import * as React from "react";
import QRCode from "qrcode";
import { cn } from "./primitives";

/**
 * A QR code, ink on paper in both themes (a scanner needs dark on light), drawn
 * as SVG so it stays sharp at any size and needs no network.
 */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const [svg, setSvg] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!value) return;
    let cancelled = false;
    void QRCode.toString(value, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#141412", light: "#ffffff" },
    }).then((markup) => {
      if (!cancelled) setSvg(markup);
    });
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
