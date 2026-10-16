// Side-by-side before/after videos from two motion-record.mjs runs.
//
//   node scripts/motion-compare.mjs <before-dir> <after-dir> <flow> <out.webm> [from-ms] [to-ms] [speed]
//
// Both recordings are lined up on their "save" mark (or their first frame when
// a flow has no mark), and the window from `from` to `to` milliseconds around
// it is played at `speed` (0.25 by default), with a running clock, so the two
// can be compared moment for moment.

import { chromium } from "playwright";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { renderVideo } from "./motion-video.mjs";

const [beforeDir, afterDir, flow, out, fromArg = "-300", toArg = "3000", speedArg = "0.25"] = process.argv.slice(2);
if (!beforeDir || !afterDir || !flow || !out) {
  console.error("usage: motion-compare.mjs <before-dir> <after-dir> <flow> <out.webm> [from-ms] [to-ms] [speed]");
  process.exit(1);
}

function load(root) {
  const dir = `${root}/frames/${flow}`;
  const marksFile = `${dir}/marks.json`;
  const marks = existsSync(marksFile) ? JSON.parse(readFileSync(marksFile, "utf8")) : {};
  const zero = marks.save ?? 0;
  return readdirSync(dir)
    .filter((file) => file.endsWith(".jpg"))
    .sort()
    .map((file) => ({ at: Number(/-(\d+)ms\.jpg$/.exec(file)[1]) - zero, data: readFileSync(`${dir}/${file}`).toString("base64") }));
}

const from = Number(fromArg);
const to = Number(toArg);
// Only the frames the window needs, plus the one on screen as it opens.
const window = (frames) => {
  const first = frames.findLastIndex((frame) => frame.at <= from);
  return frames.slice(Math.max(0, first)).filter((frame) => frame.at <= to);
};

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
await renderVideo(
  browser,
  {
    tracks: [
      { label: "Before", frames: window(load(beforeDir)) },
      { label: "After", frames: window(load(afterDir)) },
    ],
    from,
    to,
    speed: Number(speedArg),
    clock: "after Save",
  },
  out,
);
await browser.close();
console.log(`${flow}: ${out}`);
