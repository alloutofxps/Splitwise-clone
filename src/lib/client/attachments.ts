"use client";

/**
 * Receipt files, from wherever they arrive.
 *
 * Two entry points feed this: the receipt picker (camera or file browser) and
 * the OS share sheet. They must produce byte-identical results, because an
 * expense does not know or care which door its receipt came through — so the
 * pipeline lives here rather than inside either component.
 *
 * Photos are downscaled and re-encoded in the browser before upload. A modern
 * phone camera produces 4-6 MB per shot, which is both slow to upload on the
 * restaurant wifi where it is taken and pointless — a receipt only needs to be
 * legible, not archival. Compressing here turns a 12-second upload into an
 * instant one and keeps a self-hosted database small enough to back up.
 *
 * PDFs pass through untouched, since re-encoding one is not possible in the
 * browser and they are usually small anyway.
 */

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

/** How many receipts one expense may carry. */
export const MAX_ATTACHMENTS = 6;

export async function processFile(file: File): Promise<PendingAttachment> {
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

/**
 * Processes a batch, keeping what worked and reporting what did not.
 *
 * One unreadable file out of four must not discard the other three — the user
 * picked all of them deliberately, and making them start over because of a
 * corrupt HEIC is a worse outcome than telling them which one failed.
 */
export async function processFiles(
  files: readonly File[],
  limit: number,
): Promise<{ accepted: PendingAttachment[]; failures: { name: string; reason: string }[] }> {
  const accepted: PendingAttachment[] = [];
  const failures: { name: string; reason: string }[] = [];

  for (const file of files.slice(0, Math.max(0, limit))) {
    try {
      accepted.push(await processFile(file));
    } catch (error) {
      failures.push({
        name: file.name || "that file",
        reason: error instanceof Error ? error.message : "It could not be read.",
      });
    }
  }

  return { accepted, failures };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------

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
