"use client";

import * as React from "react";
import { Camera, FileText, ImagePlus, Trash2 } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { Button, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";

export interface PendingAttachment {
  id: string;
  filename: string;
  mimeType: string;
  dataUrl: string;
  size: number;
}

/** Server cap is 4 MB; aim well under it so a burst of photos still fits. */
const TARGET_BYTES = 400 * 1024;
const MAX_DIMENSION = 1600;

/**
 * Receipt attachments.
 *
 * Photos are downscaled and re-encoded in the browser before upload. A modern
 * phone camera produces 4-6 MB per shot, which is both slow to upload on the
 * restaurant wifi where it is taken and pointless - a receipt only needs to be
 * legible, not archival. Compressing here turns a 12-second upload into an
 * instant one and keeps a self-hosted database small enough to back up.
 *
 * PDFs pass through untouched, since re-encoding one is not possible in the
 * browser and they are usually small anyway.
 */
export function ReceiptPicker({
  open,
  onClose,
  attachments,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  attachments: PendingAttachment[];
  onChange: (attachments: PendingAttachment[]) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const libraryRef = React.useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);

    try {
      const next: PendingAttachment[] = [];

      for (const file of Array.from(files).slice(0, 6 - attachments.length)) {
        try {
          const processed = await processFile(file);
          next.push(processed);
        } catch (error) {
          toast({
            tone: "error",
            title: `Could not add ${file.name}`,
            description: error instanceof Error ? error.message : undefined,
          });
        }
      }

      if (next.length > 0) {
        haptic();
        onChange([...attachments, ...next]);
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
                <div className="relative aspect-square overflow-hidden rounded-[--radius-md] border border-line bg-surface-2">
                  {attachment.mimeType === "application/pdf" ? (
                    <span className="flex size-full flex-col items-center justify-center gap-1 text-subtle">
                      <FileText className="size-7" />
                      <span className="px-1 text-center text-[10px] font-semibold">PDF</span>
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
                <p className="mt-1 truncate text-center text-[10px] text-subtle">
                  {formatSize(attachment.size)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-[--radius-md] bg-surface-2 px-4 py-6 text-center text-[13px] leading-relaxed text-muted">
            Photos are shrunk on your phone before they upload, so this works on
            a bad connection.
          </p>
        )}

        <Button variant="primary" fullWidth className="mt-5" onClick={onClose}>
          Done
        </Button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

async function processFile(file: File): Promise<PendingAttachment> {
  const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (file.type === "application/pdf") {
    if (file.size > 4 * 1024 * 1024) throw new Error("PDFs have to be under 4 MB.");
    const dataUrl = await readAsDataUrl(file);
    return { id, filename: file.name, mimeType: file.type, dataUrl, size: file.size };
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Only images and PDFs can be attached.");
  }

  const { dataUrl, size, mimeType } = await compressImage(file);
  return { id, filename: file.name || "receipt.jpg", mimeType, dataUrl, size };
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

/**
 * Downscales and re-encodes an image, stepping quality down until it fits.
 *
 * WebP where supported, JPEG otherwise - a receipt at WebP q0.7 is typically
 * half the size of the equivalent JPEG with no visible difference on text.
 */
async function compressImage(
  file: File,
): Promise<{ dataUrl: string; size: number; mimeType: string }> {
  const bitmap = await loadBitmap(file);

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not process that image.");

  // White underneath, so a transparent PNG receipt does not become black text
  // on a black background.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  if ("close" in bitmap) bitmap.close();

  const mimeType = supportsWebp() ? "image/webp" : "image/jpeg";

  for (const quality of [0.72, 0.6, 0.48, 0.36]) {
    const dataUrl = canvas.toDataURL(mimeType, quality);
    const size = estimateBytes(dataUrl);
    if (size <= TARGET_BYTES) return { dataUrl, size, mimeType };
  }

  // Still too big at the lowest quality - shrink the pixels instead.
  const small = document.createElement("canvas");
  small.width = Math.round(width * 0.6);
  small.height = Math.round(height * 0.6);
  const smallContext = small.getContext("2d");
  if (!smallContext) throw new Error("Your browser could not process that image.");
  smallContext.fillStyle = "#ffffff";
  smallContext.fillRect(0, 0, small.width, small.height);
  smallContext.drawImage(canvas, 0, 0, small.width, small.height);

  const dataUrl = small.toDataURL(mimeType, 0.5);
  return { dataUrl, size: estimateBytes(dataUrl), mimeType };
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap handles EXIF rotation, so a photo taken sideways is not
  // stored sideways. Safari needs the fallback.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through to the <img> path.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("That image could not be opened."));
      image.src = url;
    });
  } finally {
    // Revoked after decode; the bitmap no longer needs the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

let webpSupport: boolean | null = null;

function supportsWebp(): boolean {
  if (webpSupport !== null) return webpSupport;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  webpSupport = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  return webpSupport;
}

/** base64 carries 3 bytes per 4 characters, minus any padding. */
function estimateBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
