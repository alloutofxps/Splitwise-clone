"use client";

import * as React from "react";
import { Camera, FileText, ImagePlus, ScanText, Trash2 } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { Button, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import {
  MAX_ATTACHMENTS,
  formatSize,
  processFiles,
  type PendingAttachment,
} from "@/lib/client/attachments";

import { readImageText } from "@/lib/client/ocr";
import { readReceiptText, type ReceiptReading } from "@/lib/receipt-text";

export type { PendingAttachment };

/**
 * Receipt attachments.
 *
 * The picker; the file pipeline it feeds lives in `@/lib/client/attachments`
 * so that a receipt arriving from the OS share sheet is processed identically
 * to one taken here.
 */
export function ReceiptPicker({
  open,
  onClose,
  attachments,
  onChange,
  currency,
  onRead,
}: {
  open: boolean;
  onClose: () => void;
  attachments: PendingAttachment[];
  onChange: (attachments: PendingAttachment[]) => void;
  /** The expense's currency, for reading prices off a photo. */
  currency?: string;
  /** Called with what a photo says: its total, the shop, the item lines. */
  onRead?: (reading: ReceiptReading) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [reading, setReading] = React.useState<{ id: string; progress: number; step: string } | null>(null);

  const read = async (attachment: PendingAttachment) => {
    if (!onRead || !currency || reading) return;
    haptic();
    setReading({ id: attachment.id, progress: 0, step: "Getting the reader ready" });
    try {
      const text = await readImageText(attachment.dataUrl, (progress, step) =>
        setReading({ id: attachment.id, progress, step }),
      );
      const result = readReceiptText(text, currency);
      if (result.total === null && result.items.length === 0) {
        toast({
          tone: "info",
          title: "Couldn't find any prices",
          description: "Try a sharper, closer photo, with the receipt flat and well lit.",
        });
      } else {
        onRead(result);
        onClose();
      }
    } catch {
      toast({
        tone: "error",
        title: "Couldn't read that photo",
        description: "You can still type the amount in yourself.",
      });
    } finally {
      setReading(null);
    }
  };
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const libraryRef = React.useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);

    try {
      const { accepted, failures } = await processFiles(
        Array.from(files),
        MAX_ATTACHMENTS - attachments.length,
      );

      for (const failure of failures) {
        toast({
          tone: "error",
          title: `Couldn't add ${failure.name}`,
          description: failure.reason,
        });
      }

      if (accepted.length > 0) {
        haptic();
        onChange([...attachments, ...accepted]);
      }
    } finally {
      setBusy(false);
      // Reset the inputs so picking the same file twice still fires a change.
      if (cameraRef.current) cameraRef.current.value = "";
      if (libraryRef.current) libraryRef.current.value = "";
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Receipts">
      <div className="px-5 pb-6">
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          // Opens the camera directly on a phone rather than the file browser.
          capture="environment"
          className="hidden"
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <input
          ref={libraryRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(event) => void handleFiles(event.target.files)}
        />

        <div className="flex gap-2.5">
          <Button
            variant="secondary"
            fullWidth
            loading={busy}
            onClick={() => cameraRef.current?.click()}
            icon={<Camera className="size-[18px]" />}
          >
            Take a photo
          </Button>
          <Button
            variant="secondary"
            fullWidth
            loading={busy}
            onClick={() => libraryRef.current?.click()}
            icon={<ImagePlus className="size-[18px]" />}
          >
            Choose file
          </Button>
        </div>

        {attachments.length > 0 ? (
          <ul className="mt-4 grid grid-cols-3 gap-2.5">
            {attachments.map((attachment) => (
              <li key={attachment.id} className="group relative">
                <div className="relative aspect-square overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface-2">
                  {attachment.mimeType === "application/pdf" ? (
                    <span className="flex size-full flex-col items-center justify-center gap-1 text-subtle">
                      <FileText className="size-7" />
                      <span className="px-1 text-center text-micro font-semibold">PDF</span>
                    </span>
                  ) : (
                    // Plain img: this is a client-side blob that next/image
                    // cannot optimise and does not need to.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.filename}
                      className="size-full object-cover"
                    />
                  )}
                </div>
                <button
                  onClick={() => {
                    haptic();
                    onChange(attachments.filter((entry) => entry.id !== attachment.id));
                  }}
                  aria-label={`Remove ${attachment.filename}`}
                  className="absolute -right-1.5 -top-1.5 flex size-7 items-center justify-center rounded-full bg-negative text-white shadow-card transition active:scale-90"
                >
                  <Trash2 className="size-3.5" />
                </button>
                {onRead && attachment.mimeType !== "application/pdf" ? (
                  reading?.id === attachment.id ? (
                    <div className="mt-1.5" role="status" aria-live="polite">
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-brand transition-[width] duration-300"
                          style={{ width: `${Math.max(6, Math.round(reading.progress * 100))}%` }}
                        />
                      </div>
                      <p className="mt-1 truncate text-center text-micro text-subtle">{reading.step}…</p>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={Boolean(reading)}
                      onClick={() => void read(attachment)}
                      className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-full bg-brand-soft py-1 text-caption font-semibold text-brand-soft-text transition active:scale-95 disabled:opacity-50"
                    >
                      <ScanText className="size-3.5" />
                      Read receipt
                    </button>
                  )
                ) : (
                  <p className="mt-1 truncate text-center text-micro text-subtle">
                    {formatSize(attachment.size)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-[var(--radius-md)] bg-surface-2 px-4 py-6 text-center text-body leading-relaxed text-muted">
            Add a photo of the receipt. Tap Read receipt and Divvy fills in the
            total and the items for you. The photo is read on your phone.
          </p>
        )}

        <Button variant="primary" fullWidth className="mt-5" onClick={onClose}>
          Done
        </Button>
      </div>
    </Sheet>
  );
}
