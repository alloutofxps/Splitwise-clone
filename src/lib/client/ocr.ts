/**
 * Reading the text on a receipt photo, on the phone itself.
 *
 * The engine (tesseract.js) and its English data are served by Divvy from
 * /ocr and only downloaded the first time someone taps "Read receipt"; the
 * browser keeps them after that. The photo is never sent anywhere.
 */

export type OcrProgress = (fraction: number, step: string) => void;

export async function readImageText(image: string, onProgress?: OcrProgress): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr",
    langPath: "/ocr",
    gzip: true,
    // A blob: worker would need a looser security policy; the file is ours.
    workerBlobURL: false,
    logger: (message: { status: string; progress: number }) => {
      if (!onProgress) return;
      const step = message.status.includes("recogniz")
        ? "Reading the receipt"
        : message.status.includes("load") || message.status.includes("initializ")
          ? "Getting the reader ready"
          : "Working";
      onProgress(message.progress, step);
    },
  });
  try {
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
