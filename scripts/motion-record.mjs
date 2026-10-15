// Motion recordings: every main flow, on a phone-sized screen.
//
//   node scripts/motion-record.mjs <base-url> <out-dir> [frames|timing]
//
// frames (default) — for each flow, a video you can watch (out/videos), every
//   painted frame with its time (out/frames/<flow>), and a contact sheet of
//   those frames laid out in order (out/sheets/<flow>.png), for reviewing a
//   transition frame by frame.
// timing — the same flows with the CPU slowed 4x (a mid-range Android phone),
//   measuring every frame the browser draws during each interaction:
//   out/timing.json. A frame over 25ms is a dropped frame at 60fps.
//
// Seeds its own data: four people, two groups, a direct expense.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = process.argv[3] ?? "motion-out";
const MODE = process.argv[4] ?? "frames";
const VIEWPORT = { width: 390, height: 844 };

// ---------------------------------------------------------------------------
// Seed: API clients with their own addresses, so the sign-up limit isn't hit.

let ip = 10 + Math.floor(Math.random() * 200);
function client() {
  let cookie = "";
  const address = `198.18.${Math.floor(Math.random() * 250)}.${ip++ % 250}`;
  return {
    id: "",
    get cookie() {
      return cookie;
    },
    async call(path, body, method) {
      const r = await fetch(BASE + path, {
        method: method ?? (body ? "POST" : "GET"),
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: `divvy_id=${cookie}` } : {}),
          "X-Forwarded-For": address,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const m = /divvy_id=([^;]*)/.exec(r.headers.get("set-cookie") ?? "");
      if (m) cookie = m[1];
      const text = await r.text();
      if (!r.ok) throw new Error(`${path} -> ${r.status} ${text.slice(0, 160)}`);
      return text ? JSON.parse(text) : null;
    },
  };
}
const eq = (total, ids) =>
  ids.map((personId, i) => ({ personId, amount: String(Math.floor(total / ids.length) + (i < total % ids.length ? 1 : 0)) }));

async function seed() {
  const [me, ravi, sam, ana] = [client(), client(), client(), client()];
  for (const [c, name, color] of [[me, "Priya Shah", "violet"], [ravi, "Ravi Kumar", "cobalt"], [sam, "Sam Lee", "sand"], [ana, "Ana Costa", "teal"]]) {
    c.id = (await c.call("/api/identity", { displayName: name, avatarColor: color, defaultCurrency: "EUR" })).me.id;
  }
  const trip = (await me.call("/api/groups", { name: "Lisbon 2026", currency: "EUR", emoji: "🌴" })).group;
  const flat = (await me.call("/api/groups", { name: "Flat 4B", currency: "EUR", emoji: "🏠" })).group;
  for (const c of [ravi, sam, ana]) await c.call(`/api/invite/${trip.inviteCode}/join`, {});
  await sam.call(`/api/invite/${flat.inviteCode}/join`, {});
  const all = [me.id, ravi.id, sam.id, ana.id];
  const add = (who, groupId, description, amount, ids) =>
    who.call("/api/expenses", { groupId, description, amount: String(amount), currency: "EUR", splitMode: "EQUAL", payers: [{ personId: who.id, amount: String(amount) }], splits: eq(amount, ids) });
  await add(me, trip.id, "Dinner at Cervejaria", 9600, all);
  await add(ravi, trip.id, "Taxi to the airport", 4200, [me.id, ravi.id]);
  await add(sam, trip.id, "Pastéis de Belém", 1840, all);
  await add(ana, trip.id, "Museum tickets", 6000, all);
  await add(sam, flat.id, "Big shop", 8340, [me.id, sam.id]);
  const meCode = (await me.call("/api/identity")).me.inviteCode;
  await ravi.call(`/api/invite/${meCode}/join`, {});
  await me.call("/api/expenses", { friendId: ravi.id, description: "Concert tickets", amount: "9000", currency: "EUR", splitMode: "EQUAL", payers: [{ personId: me.id, amount: "9000" }], splits: eq(9000, [me.id, ravi.id]) });
  return { cookie: me.cookie, trip: trip.id, ravi: ravi.id };
}

// ---------------------------------------------------------------------------
// Flows. Each gets a page already signed in, on Home.

const FLOWS = {
  "01-opening": async (page) => {
    await page.goto(BASE, { waitUntil: "commit" });
    await page.waitForTimeout(3000);
  },
  "02-home-to-group": async (page, seedData) => {
    await page.getByRole("link", { name: /Lisbon 2026/ }).first().click();
    await page.waitForURL(`**/groups/${seedData.trip}`);
    await page.waitForTimeout(1600);
    await page.goBack();
    await page.waitForTimeout(1600);
  },
  "03-add-expense": async (page, seedData) => {
    await page.goto(`${BASE}/groups/${seedData.trip}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Add an expense" }).first().click();
    await page.waitForTimeout(900);
    await page.getByPlaceholder("What was it for?").pressSequentially("Tapas", { delay: 60 });
    await page.getByLabel("Amount").first().click();
    for (const key of ["4", "8"]) {
      await page.getByLabel("Amount keypad").getByRole("button", { name: key, exact: true }).click();
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Add expense" }).last().click();
    await page.waitForTimeout(2400);
  },
  "04-settle-up": async (page, seedData) => {
    await page.goto(`${BASE}/groups/${seedData.trip}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Settle up" }).first().click();
    await page.waitForTimeout(900);
    const pick = page.locator('[role="dialog"] button').filter({ hasText: /pays you|^Pay / }).first();
    if (await pick.count()) {
      await pick.click();
      await page.waitForTimeout(800);
    }
    await page.getByRole("button", { name: "Save payment" }).click();
    await page.waitForTimeout(3000);
  },
  "05-friend-page": async (page, seedData) => {
    await page.getByRole("link", { name: "Friends" }).first().click();
    await page.waitForTimeout(1400);
    await page.locator(`a[href="/friends/${seedData.ravi}"]`).first().click();
    await page.waitForTimeout(1600);
    await page.goBack();
    await page.waitForTimeout(1400);
  },
  "06-panels": async (page, seedData) => {
    await page.goto(`${BASE}/groups/${seedData.trip}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /Dinner at Cervejaria/ }).first().click();
    await page.waitForTimeout(1200);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(900);
    await page.getByRole("button", { name: "Add an expense" }).first().click();
    await page.waitForTimeout(900);
    await page.getByRole("button", { name: /^Split/ }).first().click();
    await page.waitForTimeout(1000);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(700);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(900);
  },
};

// ---------------------------------------------------------------------------

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
mkdirSync(OUT, { recursive: true });
const only = process.env.FLOW;
const timing = {};

for (const [name, flow] of Object.entries(FLOWS)) {
  if (only && !name.includes(only)) continue;
  const seedData = await seed();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  await context.addCookies([{ name: "divvy_id", value: seedData.cookie, url: BASE }]);
  const page = await context.newPage();
  // Skip the one-time install prompt so it doesn't cover anything.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("divvy-install-dismissed", String(Date.now()));
    } catch {}
  });
  // Every frame the page draws, kept across full page loads: the page
  // reports its frame times out in small batches so a navigation loses at
  // most the last 200ms of them.
  const frameTimes = [];
  if (MODE === "timing") {
    await page.exposeFunction("__reportFrames", (batch) => {
      frameTimes.push(...batch);
    });
    await page.addInitScript(() => {
      let batch = [];
      const tick = (t) => {
        batch.push(performance.timeOrigin + t);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const flush = () => {
        if (batch.length && window.__reportFrames) {
          window.__reportFrames(batch);
          batch = [];
        }
      };
      setInterval(flush, 200);
      addEventListener("pagehide", flush);
    });
  }
  if (name !== "01-opening") {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
  }

  const cdp = await context.newCDPSession(page);
  if (MODE === "timing") {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    frameTimes.length = 0;
  }

  const frames = [];
  const started = Date.now();
  if (MODE === "frames") {
    cdp.on("Page.screencastFrame", async (frame) => {
      frames.push({ data: frame.data, at: Date.now() - started });
      await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 390, maxHeight: 844, everyNthFrame: 1 });
  }

  try {
    await flow(page, seedData);
  } catch (error) {
    console.error(`${name}: ${error.message.split("\n")[0]}`);
  }

  if (MODE === "frames") {
    await cdp.send("Page.stopScreencast").catch(() => {});
    const dir = `${OUT}/frames/${name}`;
    mkdirSync(dir, { recursive: true });
    frames.forEach((frame, index) =>
      writeFileSync(`${dir}/${String(index).padStart(3, "0")}-${String(frame.at).padStart(5, "0")}ms.jpg`, Buffer.from(frame.data, "base64")),
    );
    console.log(`${name}: ${frames.length} frames`);
    await sheet(name, frames);
    await video(name, frames, 1);
    await video(name, frames, 0.25);
  } else {
    await page.evaluate(() => new Promise((r) => setTimeout(r, 250))).catch(() => {});
    const times = [...frameTimes].sort((a, b) => a - b);
    const gaps = times.slice(1).map((t, i) => t - times[i]).filter((g) => g < 1000);
    const sorted = [...gaps].sort((a, b) => a - b);
    timing[name] = {
      frames: gaps.length,
      medianMs: sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(1) : null,
      p95Ms: sorted.length ? +sorted[Math.floor(sorted.length * 0.95)].toFixed(1) : null,
      worstMs: sorted.length ? +sorted[sorted.length - 1].toFixed(1) : null,
      droppedOver25ms: gaps.filter((g) => g > 25).length,
      droppedShare: gaps.length ? +(gaps.filter((g) => g > 25).length / gaps.length).toFixed(3) : null,
    };
    console.log(name, JSON.stringify(timing[name]));
  }
  await context.close();
}

if (MODE === "timing") writeFileSync(`${OUT}/timing.json`, JSON.stringify(timing, null, 2));
await browser.close();

// A video made from the captured frames, each held for as long as it was on
// screen, encoded by the browser itself (no ffmpeg). `speed` 0.25 gives the
// slow-motion copy used for review.
async function video(name, frames, speed) {
  if (frames.length < 2) return;
  mkdirSync(`${OUT}/videos`, { recursive: true });
  const tab = await browser.newPage();
  const webm = await tab.evaluate(
    async ({ items, speed }) => {
      const first = new Image();
      first.src = `data:image/jpeg;base64,${items[0].data}`;
      await first.decode();
      const canvas = document.createElement("canvas");
      canvas.width = first.naturalWidth;
      canvas.height = first.naturalHeight;
      const ctx = canvas.getContext("2d");
      const recorder = new MediaRecorder(canvas.captureStream(60), { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 4_000_000 });
      const chunks = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const done = new Promise((resolve) => (recorder.onstop = resolve));
      recorder.start();
      for (const [i, item] of items.entries()) {
        const img = new Image();
        img.src = `data:image/jpeg;base64,${item.data}`;
        await img.decode();
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const next = items[i + 1];
        const hold = next ? (next.at - item.at) / speed : 600;
        await new Promise((r) => setTimeout(r, Math.max(16, hold)));
      }
      recorder.stop();
      await done;
      const blob = new Blob(chunks, { type: "video/webm" });
      const buffer = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
      return btoa(binary);
    },
    { items: frames, speed },
  );
  writeFileSync(`${OUT}/videos/${name}${speed === 1 ? "" : "-slow"}.webm`, Buffer.from(webm, "base64"));
  await tab.close();
}

// A contact sheet: frames in order, each labelled with its time, so a
// transition can be read frame by frame. Identical consecutive frames are
// skipped; the label keeps the real time.
async function sheet(name, frames) {
  if (frames.length === 0) return;
  mkdirSync(`${OUT}/sheets`, { recursive: true });
  const kept = frames.filter((frame, index) => index === 0 || frame.data !== frames[index - 1].data);
  const pages = [];
  for (let i = 0; i < kept.length; i += 40) pages.push(kept.slice(i, i + 40));
  const tab = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  for (const [n, group] of pages.entries()) {
    const png = await tab.evaluate(async (items) => {
      const cols = 8, w = 160, h = Math.round(w * (844 / 390)), label = 18;
      const rows = Math.ceil(items.length / cols);
      const canvas = document.createElement("canvas");
      canvas.width = cols * (w + 6);
      canvas.height = rows * (h + label + 6);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ddd";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const [i, item] of items.entries()) {
        const img = new Image();
        img.src = `data:image/jpeg;base64,${item.data}`;
        await img.decode();
        const x = (i % cols) * (w + 6), y = Math.floor(i / cols) * (h + label + 6);
        ctx.fillStyle = "#111";
        ctx.font = "13px sans-serif";
        ctx.fillText(`${item.at} ms`, x + 4, y + 13);
        ctx.drawImage(img, x, y + label, w, h);
      }
      return canvas.toDataURL("image/png").split(",")[1];
    }, group);
    writeFileSync(`${OUT}/sheets/${name}${pages.length > 1 ? `-${n + 1}` : ""}.png`, Buffer.from(png, "base64"));
  }
  await tab.close();
}
