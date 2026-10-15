"use client";

import * as React from "react";
import { ScanLine } from "lucide-react";
import { Sheet } from "./sheet";
import { haptic } from "./primitives";
import { codeFromScan } from "@/lib/invite-code";

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike;

function detector(): BarcodeDetectorConstructor | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector ?? null;
}

/**
 * "Scan a code" (DESIGN-PLAN 3.10): the camera, read by the phone's own
 * barcode reader. Only offered where the browser has one; elsewhere (iPhone)
 * the Camera app already opens invite links, and the button says so.
 */
export function ScanCodeButton({ onCode }: { onCode: (code: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const video = React.useRef<HTMLVideoElement>(null);
  const supported = React.useSyncExternalStore(
    () => () => {},
    () => detector() !== null && "getUserMedia" in (navigator.mediaDevices ?? {}),
    () => false,
  );

  React.useEffect(() => {
    if (!open) return;
    const Detector = detector();
    if (!Detector) return;
    let stream: MediaStream | null = null;
    let timer: number | null = null;
    let stopped = false;
    const reader = new Detector({ formats: ["qr_code"] });

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const found = await reader.detect(video.current);
            if (found[0]?.rawValue) {
              haptic([10, 40, 10]);
              onCode(codeFromScan(found[0].rawValue));
              setOpen(false);
              return;
            }
          } catch {
            // A frame that couldn't be read; try the next one.
          }
          timer = window.setTimeout(() => void tick(), 300);
        };
        void tick();
      } catch {
        setProblem("Divvy couldn’t use the camera. Allow it in your browser, or type the code.");
      }
    })();

    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open, onCode]);

  if (!supported) {
    return (
      <p className="mt-3 flex items-start justify-center gap-1.5 text-center text-caption text-subtle">
        <ScanLine className="mt-0.5 size-3.5 shrink-0" />
        Got a QR code? Point your phone&rsquo;s camera at it to open the invite.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          haptic();
          setProblem(null);
          setOpen(true);
        }}
        className="mx-auto mt-3 flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-body font-medium text-text transition-colors hover:bg-surface-2"
      >
        <ScanLine className="size-4" strokeWidth={1.75} />
        Scan a code
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Scan a code">
        <div className="px-5 pb-6">
          {problem ? (
            <p className="py-8 text-center text-body text-muted">{problem}</p>
          ) : (
            <div className="relative overflow-hidden rounded-[var(--radius-lg)] bg-black">
              <video ref={video} muted playsInline className="aspect-square w-full object-cover" />
              <span aria-hidden className="absolute inset-10 rounded-[var(--radius-lg)] border-2 border-white/80" />
            </div>
          )}
          <p className="mt-3 text-center text-caption text-muted">Point the camera at the invite&rsquo;s QR code.</p>
        </div>
      </Sheet>
    </>
  );
}
