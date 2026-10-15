// Copies the receipt-reading engine (tesseract.js) into public/ocr so the app
// serves it itself: no third-party CDN, and receipt photos never leave the
// phone. Runs before `dev` and `build`. The files are build output, so
// public/ocr is git-ignored.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const out = join(process.cwd(), "public", "ocr");
mkdirSync(out, { recursive: true });

const tesseract = dirname(require.resolve("tesseract.js/package.json"));
const core = dirname(require.resolve("tesseract.js-core/package.json"));
const eng = dirname(require.resolve("@tesseract.js-data/eng/package.json"));

const files = [
  [join(tesseract, "dist", "worker.min.js"), "worker.min.js"],
  // The engine picks the build matching the phone's processor features.
  [join(core, "tesseract-core-lstm.wasm.js"), "tesseract-core-lstm.wasm.js"],
  [join(core, "tesseract-core-simd-lstm.wasm.js"), "tesseract-core-simd-lstm.wasm.js"],
  [join(core, "tesseract-core-relaxedsimd-lstm.wasm.js"), "tesseract-core-relaxedsimd-lstm.wasm.js"],
  // English, the compact "best_int" model: about 3 MB, still accurate on print.
  [join(eng, "4.0.0_best_int", "eng.traineddata.gz"), "eng.traineddata.gz"],
];

for (const [from, name] of files) {
  if (!existsSync(from)) throw new Error(`Receipt reader file missing: ${from}`);
  copyFileSync(from, join(out, name));
}
console.log(`copied ${files.length} receipt-reader files to public/ocr`);
