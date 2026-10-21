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
// SLOW=1 slows the CPU 4x for frames too, to see what a mid-range phone
// shows: a slide the browser runs itself keeps moving while the app is busy.
//
// Seeds its own data: four people, two groups, a direct expense.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { renderVideo } from "./motion-video.mjs";

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
  "03-add-expense": async (page, seedData, mark) => {
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
    mark("save");
    await page.getByRole("button", { name: "Add expense" }).last().click();
    await page.waitForTimeout(2400);
  },
  "04-settle-up": async (page, seedData, mark) => {
    await page.goto(`${BASE}/groups/${seedData.trip}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Settle up" }).first().click();
    await page.waitForTimeout(900);
    const pick = page.locator('[role="dialog"] button').filter({ hasText: /pays you|^Pay / }).first();
    if (await pick.count()) {
      await pick.click();
      await page.waitForTimeout(800);
    }
    mark("save");
    await page.getByRole("button", { name: "Save payment" }).click();
    await page.waitForTimeout(3000);
  },
  // A brand new account: Home's "start" drawing.
  "08-first-run": async (page) => {
    const fresh = client();
    await fresh.call("/api/identity", { displayName: "Noor Ali", avatarColor: "teal", defaultCurrency: "EUR" });
    await page.context().addCookies([{ name: "divvy_id", value: fresh.cookie, url: BASE }]);
    await page.goto(BASE, { waitUntil: "commit" });
    await page.waitForTimeout(2600);
  },
  // Pull to refresh, as in the installed app: pulled, held, let go.
  "09-pull-refresh": async (page) => {
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (query) =>
        query === "(display-mode: standalone)" ? { ...real(query), matches: true } : real(query);
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const touch = (type, y) =>
      page.evaluate(
        ([type, y]) => {
          const event = new Event(type, { bubbles: true });
          Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientY: y }] });
          window.dispatchEvent(event);
        },
        [type, y],
      );
    await touch("touchstart", 100);
    for (let y = 100; y <= 220; y += 6) {
      await touch("touchmove", y);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(500);
    await touch("touchend", 220);
    await page.waitForTimeout(2200);
  },
  // Paying part of a debt: the line stays, shorter.
  "07-payment": async (page, seedData, mark) => {
    await page.goto(`${BASE}/groups/${seedData.trip}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Settle up" }).first().click();
    await page.waitForTimeout(900);
    const pick = page.locator('[role="dialog"] button').filter({ hasText: /pays you|^Pay / }).first();
    if (await pick.count()) {
      await pick.click();
      await page.waitForTimeout(800);
    }
    const field = page.locator('[role="dialog"] input[inputmode="decimal"]').first();
    await field.fill("3");
    await page.waitForTimeout(400);
    mark("save");
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
  // The group's own row in Home's Groups list (02 taps whichever link names
  // the group first, which is usually a "Needs you" row): its icon, name and
  // amount travel into the group's header, and back.
  "11-group-row": async (page, seedData, mark) => {
    const row = page.locator(`a[href="/groups/${seedData.trip}"]`).filter({ hasText: /you're owed|you owe|settled/ });
    mark("save");
    await row.first().click();
    await page.waitForURL(`**/groups/${seedData.trip}`);
    await page.waitForTimeout(1600);
    // Home again: the group's news is read now, so "Needs you" changes.
    mark("back");
    await page.goBack();
    await page.waitForTimeout(1600);
  },
  // Expenses, Balances, Insights and back: the tabs sit side by side.
  "10-group-tabs": async (page, seedData, mark) => {
    await page.goto(`${BASE}/groups/${seedData.trip}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    mark("save");
    for (const name of ["Balances", "Insights", "Expenses"]) {
      await page.getByRole("tab", { name }).click();
      await page.waitForTimeout(900);
    }
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
    // REDUCE=1 records with the phone's Reduce Motion setting on.
    reducedMotion: process.env.REDUCE ? "reduce" : "no-preference",
  });
  await context.addCookies([{ name: "divvy_id", value: seedData.cookie, url: BASE }]);
  const page = await context.newPage();
  // Skip the one-time install prompt so it doesn't cover anything.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("divvy-install-dismissed", String(Date.now()));
    } catch {
      // Storage can be blocked; the prompt then simply shows.
    }
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
  if (MODE === "timing" || process.env.SLOW) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    frameTimes.length = 0;
  }

  const frames = [];
  const started = Date.now();
  // Moments worth lining up across recordings, such as the tap on Save.
  const marks = {};
  const mark = (label) => {
    marks[label] = Date.now() - started;
  };
  if (MODE === "frames") {
    cdp.on("Page.screencastFrame", async (frame) => {
      // When the browser drew it, not when it reached us: frames can arrive
      // in bunches on a busy machine, and arrival time would squash them.
      const drawn = frame.metadata?.timestamp ? frame.metadata.timestamp * 1000 : Date.now();
      frames.push({ data: frame.data, at: Math.round(drawn - started) });
      await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 390, maxHeight: 844, everyNthFrame: 1 });
  }

  try {
    await flow(page, seedData, mark);
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
    writeFileSync(`${dir}/marks.json`, JSON.stringify(marks));
    console.log(`${name}: ${frames.length} frames`);
    await sheet(name, frames);
    await video(name, frames, 1);
    await video(name, frames, 0.25);
  } else {
    await page.evaluate(() => new Promise((r) => setTimeout(r, 250))).catch(() => {});
    const times = [...frameTimes].sort((a, b) => a - b);
    timing[name] = summarise(times);
    // The moment itself, apart from the page loading before it: the 2.5s
    // after Save, when the panel leaves and the money moves.
    if (marks.save !== undefined) {
      const saveAt = started + marks.save;
      timing[name].afterSave = summarise(times.filter((t) => t >= saveAt && t <= saveAt + 2500));
    }
    console.log(name, JSON.stringify(timing[name]));
  }
  await context.close();
}

/**
 * Frame gaps in a list of frame times: how many ran long, and how long.
 *
 * droppedShare depends on the screen: at 240 frames a second there are four
 * times as many frames for the same late ones to hide among. lateShareAt60Hz
 * divides by the frames a 60Hz phone would draw in the same time instead, so
 * runs on different screens can be compared.
 */
function summarise(times) {
  const gaps = times.slice(1).map((t, i) => t - times[i]).filter((g) => g < 1000);
  const sorted = [...gaps].sort((a, b) => a - b);
  const late = gaps.filter((g) => g > 25).length;
  const seconds = gaps.reduce((sum, g) => sum + g, 0) / 1000;
  return {
    lateShareAt60Hz: seconds ? +(late / (seconds * 60)).toFixed(3) : null,
    frames: gaps.length,
    medianMs: sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(1) : null,
    p95Ms: sorted.length ? +sorted[Math.floor(sorted.length * 0.95)].toFixed(1) : null,
    worstMs: sorted.length ? +sorted[sorted.length - 1].toFixed(1) : null,
    droppedOver25ms: gaps.filter((g) => g > 25).length,
    droppedShare: gaps.length ? +(gaps.filter((g) => g > 25).length / gaps.length).toFixed(3) : null,
  };
}

if (MODE === "timing") writeFileSync(`${OUT}/timing.json`, JSON.stringify(timing, null, 2));
await browser.close();

// A video made from the captured frames, each held for as long as it was on
// screen, rendered frame by frame (see motion-video.mjs). `speed` 0.25 gives
// the slow-motion copy used for review.
async function video(name, frames, speed) {
  if (frames.length < 2) return;
  mkdirSync(`${OUT}/videos`, { recursive: true });
  await renderVideo(
    browser,
    { tracks: [{ label: null, frames }], from: frames[0].at, to: frames[frames.length - 1].at, speed },
    `${OUT}/videos/${name}${speed === 1 ? "" : "-slow"}.webm`,
  );
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
