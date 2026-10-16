// Frame-exact videos of recorded flows.
//
// Recording a canvas live with MediaRecorder captures whatever the machine
// managed to draw in real time: when the computer stalled for a second, the
// video stalled with it and then jumped, and the movement the video existed to
// show was skipped. Here every output frame is drawn for an exact moment and
// encoded with an exact timestamp (WebCodecs), then wrapped into a WebM in
// Node. A busy machine makes it slower to produce, never wrong.
//
//   import { renderVideo } from "./motion-video.mjs";
//   await renderVideo(browser, { tracks: [{ label, frames }], from, to, speed, clock }, "out.webm");
//
// `frames` are { at: ms, data: base64 jpeg }, `from`/`to` are content times in
// ms, `speed` is 1 for real time or 0.25 for quarter speed.

import { writeFileSync } from "node:fs";

const FPS = 60;

export async function renderVideo(browser, { tracks, from, to, speed = 1, clock = null }, out) {
  const page = await browser.newPage();
  // The video encoder only exists on a secure page, so serve a blank one at an
  // https address answered by the browser itself; nothing leaves the machine.
  await page.route("https://motion.invalid/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>render</title>" }));
  await page.goto("https://motion.invalid/");
  const result = await page.evaluate(
    async ({ tracks, from, to, speed, clock, fps }) => {
      const decoded = await Promise.all(
        tracks.map(async (track) => ({
          label: track.label,
          frames: await Promise.all(
            track.frames.map(async (frame) => ({
              at: frame.at,
              // Bitmaps are decoded once, up front, so drawing never waits on it.
              bitmap: await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${frame.data}`)).blob()),
            })),
          ),
        })),
      );
      const w = decoded[0].frames[0].bitmap.width;
      const h = decoded[0].frames[0].bitmap.height;
      const gap = tracks.length > 1 || clock ? 24 : 0;
      const head = tracks.length > 1 || clock ? 56 : 0;
      const width = Math.ceil((w * tracks.length + gap * (tracks.length + 1)) / 2) * 2;
      const height = Math.ceil((h + head + gap) / 2) * 2;
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");

      // The frame on screen at a moment: the last one delivered at or before it.
      const at = (frames, t) => {
        let shown = frames[0];
        for (const frame of frames) {
          if (frame.at <= t) shown = frame;
          else break;
        }
        return shown.bitmap;
      };
      const draw = (t) => {
        ctx.fillStyle = "#eae8e4";
        ctx.fillRect(0, 0, width, height);
        if (head) {
          ctx.fillStyle = "#141412";
          ctx.font = "600 22px system-ui, sans-serif";
          decoded.forEach((track, i) => track.label && ctx.fillText(track.label, gap + i * (w + gap), 36));
          if (clock) {
            ctx.font = "500 18px ui-monospace, monospace";
            const label = `${t >= 0 ? "+" : "−"}${(Math.abs(t) / 1000).toFixed(2)}s ${clock} · ${speed}× speed`;
            ctx.fillStyle = "#57534e";
            ctx.fillText(label, width - gap - ctx.measureText(label).width, 36);
          }
        }
        decoded.forEach((track, i) => ctx.drawImage(at(track.frames, t), gap + i * (w + gap), head, w, h));
      };

      const chunks = [];
      let codec = "vp09.00.10.08";
      const encoder = new VideoEncoder({
        output: (chunk) => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          let binary = "";
          for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
          chunks.push({ data: btoa(binary), ms: chunk.timestamp / 1000, key: chunk.type === "key" });
        },
        error: (error) => {
          throw error;
        },
      });
      const config = { codec, width, height, bitrate: 6_000_000, framerate: fps };
      if (!(await VideoEncoder.isConfigSupported(config)).supported) {
        codec = "vp8";
        config.codec = codec;
      }
      encoder.configure(config);

      // Content time advances `speed` × real time per output frame. The last
      // frame is held for a moment so the end state can be read.
      const step = (1000 / fps) * speed;
      const count = Math.ceil((to - from) / step) + Math.round(fps * 0.8);
      for (let i = 0; i < count; i += 1) {
        draw(Math.min(to, from + i * step));
        const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1_000_000) / fps), duration: Math.round(1_000_000 / fps) });
        encoder.encode(frame, { keyFrame: i % fps === 0 });
        frame.close();
        if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
      }
      await encoder.flush();
      return { chunks, width, height, codec, durationMs: (count * 1000) / fps };
    },
    { tracks, from, to, speed, clock, fps: FPS },
  );
  await page.close();
  writeFileSync(out, muxWebm(result));
}

// ---------------------------------------------------------------------------
// A minimal WebM writer: one video track, a cluster per keyframe, and the
// cues and duration a player needs to scrub.

function vint(size) {
  // Eight bytes, always: simple, and valid for every size here.
  const out = Buffer.alloc(8);
  out[0] = 0x01;
  let rest = size;
  for (let i = 7; i >= 1; i -= 1) {
    out[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return out;
}
const el = (id, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from(id, "hex"), vint(body.length), body]);
};
const uint = (value, bytes = 0) => {
  let n = bytes;
  if (!n) for (n = 1; value >= 2 ** (8 * n); n += 1);
  const out = Buffer.alloc(n);
  let rest = value;
  for (let i = n - 1; i >= 0; i -= 1) {
    out[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return out;
};
const float = (value) => {
  const out = Buffer.alloc(8);
  out.writeDoubleBE(value);
  return out;
};
const text = (value) => Buffer.from(value, "utf8");

function muxWebm({ chunks, width, height, codec, durationMs }) {
  const header = el(
    "1a45dfa3",
    el("4286", uint(1)),
    el("42f7", uint(1)),
    el("42f2", uint(4)),
    el("42f3", uint(8)),
    el("4282", text("webm")),
    el("4287", uint(4)),
    el("4285", uint(2)),
  );
  const info = el("1549a966", el("2ad7b1", uint(1_000_000)), el("4489", float(durationMs)), el("4d80", text("divvy")), el("5741", text("divvy")));
  const tracks = el(
    "1654ae6b",
    el(
      "ae",
      el("d7", uint(1)),
      el("73c5", uint(1)),
      el("83", uint(1)),
      el("86", text(codec.startsWith("vp09") ? "V_VP9" : "V_VP8")),
      el("e0", el("b0", uint(width)), el("ba", uint(height))),
    ),
  );

  // A new cluster at every keyframe keeps block times small and gives a cue.
  const clusters = [];
  let current = null;
  for (const chunk of chunks) {
    const ms = Math.round(chunk.ms);
    if (chunk.key || !current) {
      current = { ms, blocks: [] };
      clusters.push(current);
    }
    const block = Buffer.concat([Buffer.from([0x81]), Buffer.alloc(2), Buffer.from([chunk.key ? 0x80 : 0x00]), Buffer.from(chunk.data, "base64")]);
    block.writeInt16BE(ms - current.ms, 1);
    current.blocks.push(el("a3", block));
  }
  const clusterBuffers = clusters.map((cluster) => el("1f43b675", el("e7", uint(cluster.ms)), ...cluster.blocks));

  // Positions are measured from the start of the Segment's contents. The seek
  // head comes first and has a fixed size, so it can be sized before it's filled.
  const seekEntry = (id, position) => el("4dbb", el("53ab", Buffer.from(id, "hex")), el("53ac", uint(position, 8)));
  const seekHeadSize = el("114d9b74", seekEntry("1549a966", 0), seekEntry("1654ae6b", 0), seekEntry("1c53bb6b", 0)).length;
  const infoAt = seekHeadSize;
  const tracksAt = infoAt + info.length;
  let position = tracksAt + tracks.length;
  const cuePoints = clusters.map((cluster, i) => {
    const point = el("bb", el("b3", uint(cluster.ms)), el("b7", el("f7", uint(1)), el("f1", uint(position, 8))));
    position += clusterBuffers[i].length;
    return point;
  });
  const cuesAt = position;
  const cues = el("1c53bb6b", ...cuePoints);
  const seekHead = el("114d9b74", seekEntry("1549a966", infoAt), seekEntry("1654ae6b", tracksAt), seekEntry("1c53bb6b", cuesAt));

  return Buffer.concat([header, el("18538067", seekHead, info, tracks, ...clusterBuffers, cues)]);
}
