/**
 * Slow connections, no connection, and Reduce Motion (RULES R5 and A5).
 *
 *   node scripts/network-check.mjs <base-url> [out-dir]
 *
 * Needs a production server (the service worker is what opens the app
 * offline). In Chrome's engine:
 *
 *   - slow: a cold first visit to Home on a slow phone network (1.6 Mbit/s
 *     down, 150 ms round trips) with the processor slowed 4x, timed until
 *     your balance is on screen. Fails over SLOW_LIMIT_MS (default 6000).
 *   - offline: after one visit, the network cut: Home and a group still open
 *     and show the last known balances and expenses.
 *   - reduce motion: with the phone's Reduce Motion on, opening and closing
 *     panels, switching a group's tabs, adding an expense and moving between
 *     screens. Every animation the browser runs and every inline transform a
 *     script writes is recorded. Per MOTION-SPEC 6 every slide, scale,
 *     travel and roll becomes a fade or the end result: nothing may change
 *     position or size over time. Fades, colours and shadows may (depth
 *     stays, and a fade was never motion), and so may anything instant.
 *
 * Prints each check and exits 1 if any fails.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "network-check";
const SLOW_LIMIT_MS = Number(process.env.SLOW_LIMIT_MS ?? 6000);
mkdirSync(OUT, { recursive: true });

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` (${detail})` : ""}`);
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const phone = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

// Someone with a group, a few expenses and a payment.
async function seed() {
  // Its own address, as smoke.mjs does: sign-ups are limited per address,
  // and in CI every browser shares the machine's otherwise.
  const ctx = await browser.newContext({ ...phone, extraHTTPHeaders: { "X-Forwarded-For": "198.18.41.1" } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  const data = await page.evaluate(async () => {
    const call = async (path, body) => {
      const r = await fetch(path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw new Error(`${path} ${r.status}`);
      return r.json();
    };
    const me = (await call("/api/identity", { displayName: "Priya Shah", avatarColor: "violet" })).me;
    sessionStorage.removeItem("divvy-recovery-key");
    localStorage.removeItem("divvy-recovery-pending");
    const group = (await call("/api/groups", { name: "Lisbon 2026", currency: "EUR", placeholderNames: ["Ravi", "Sam"] })).group;
    const full = (await call(`/api/groups/${group.id}`)).group;
    const ids = full.members.map((m) => m.id);
    const ravi = full.members.find((m) => m.displayName === "Ravi").id;
    for (const [description, amount] of [["Airbnb Alfama", 48000], ["Tram 28", 3000], ["Pastéis de Belém", 6300]]) {
      await call("/api/expenses", {
        groupId: group.id, description, amount: String(amount), currency: "EUR", splitMode: "EQUAL",
        payers: [{ personId: me.id, amount: String(amount) }],
        splits: ids.map((id) => ({ personId: id, amount: String(amount / 3) })),
      });
    }
    await call("/api/settlements", { groupId: group.id, fromPersonId: ravi, toPersonId: me.id, amount: "5000", currency: "EUR" });
    return { groupId: group.id };
  });
  const state = await ctx.storageState();
  await ctx.close();
  return { ...data, state };
}

const data = await seed();
const balance = /You(?:’|')re owed|You owe/;

console.log("\nA slow connection");
{
  const ctx = await browser.newContext({ ...phone, storageState: data.state });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const started = Date.now();
  await page.goto(BASE, { waitUntil: "commit" });
  const firstPaint = await page.waitForFunction(() => document.body?.innerText.trim().length > 0, null, { timeout: 30000 }).then(() => Date.now() - started).catch(() => null);
  const useful = await page.getByText(balance).first().waitFor({ timeout: 30000 }).then(() => Date.now() - started).catch(() => null);
  await page.screenshot({ path: join(OUT, "slow-home.png") });
  check("something is on screen", firstPaint !== null, `${firstPaint} ms`);
  check(`your balance is on screen within ${SLOW_LIMIT_MS / 1000} s`, useful !== null && useful <= SLOW_LIMIT_MS, `${useful} ms`);
  await ctx.close();
}

console.log("\nNo connection");
{
  const ctx = await browser.newContext({ ...phone, storageState: data.state });
  const page = await ctx.newPage();
  // A first visit installs the service worker and keeps the latest data.
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByText(balance).first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.goto(`${BASE}/groups/${data.groupId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.evaluate(() => navigator.serviceWorker?.ready);
  await ctx.setOffline(true);
  await page.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => {});
  const home = await page.getByText(balance).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  await page.screenshot({ path: join(OUT, "offline-home.png") });
  check("Home opens offline with the last known balance", home);
  await page.goto(`${BASE}/groups/${data.groupId}`, { waitUntil: "domcontentloaded" }).catch(() => {});
  const group = await page.getByText("Airbnb Alfama").first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  await page.screenshot({ path: join(OUT, "offline-group.png") });
  check("a group opens offline with its expenses", group);
  await ctx.close();
}

console.log("\nReduce Motion");
{
  const ctx = await browser.newContext({ ...phone, storageState: data.state, reducedMotion: "reduce" });
  // Records every animation the browser runs (CSS and Web Animations) and
  // every inline transform a script writes, from before the app loads.
  await ctx.addInitScript(() => {
    const seen = (window.__motion = []);
    const describe = (el) => (el?.getAttribute?.("aria-label") || el?.className?.toString?.() || el?.tagName || "?").slice(0, 60);
    const note = (animation) => {
      const effect = animation.effect;
      const timing = effect?.getTiming?.() ?? {};
      const frames = effect?.getKeyframes?.() ?? [];
      const props = [...new Set(frames.flatMap((frame) => Object.keys(frame).filter((k) => !["offset", "easing", "composite", "computedOffset"].includes(k))))];
      seen.push({ kind: "animation", props, duration: Number(timing.duration) || 0, iterations: timing.iterations, target: describe(effect?.target) });
    };
    document.addEventListener("animationstart", (event) => { for (const a of event.target.getAnimations?.() ?? []) note(a); }, true);
    document.addEventListener("transitionrun", (event) => { for (const a of event.target.getAnimations?.() ?? []) note(a); }, true);
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      note(animation);
      return animation;
    };
    const writes = new Map();
    new MutationObserver((records) => {
      const now = performance.now();
      for (const record of records) {
        const el = record.target;
        if (!(el instanceof HTMLElement || el instanceof SVGElement) || !el.style?.transform) continue;
        // One write is a new position (a tab's underline jumping to it);
        // three within a third of a second is something being moved frame by
        // frame.
        const recent = [...(writes.get(el) ?? []), now].filter((t) => now - t < 330);
        writes.set(el, recent);
        if (recent.length === 3) seen.push({ kind: "script", props: ["transform"], duration: 0, target: describe(el) });
      }
    }).observe(document, { attributes: true, attributeFilter: ["style"], subtree: true });
  });
  const page = await ctx.newPage();
  const flows = [
    ["open and close Add an expense", async () => {
      await page.getByRole("button", { name: "Add an expense" }).first().click();
      await page.waitForTimeout(700);
      await page.keyboard.press("Escape");
    }],
    ["switch a group's tabs", async () => {
      await page.getByRole("tab", { name: "Balances" }).click();
      await page.waitForTimeout(500);
      await page.getByRole("tab", { name: "Insights" }).click();
      await page.waitForTimeout(500);
      await page.getByRole("tab", { name: "Expenses" }).click();
    }],
    ["open and close Settle up", async () => {
      await page.getByRole("button", { name: "Settle up", exact: true }).first().click();
      await page.waitForTimeout(700);
      await page.keyboard.press("Escape");
    }],
    ["add an expense", async () => {
      await page.getByRole("button", { name: "Add an expense" }).first().click();
      await page.waitForTimeout(700);
      await page.getByLabel("What was it for?").fill("Coffee");
      await page.getByLabel("Amount").first().fill("4.50");
      await page.getByRole("button", { name: "Add expense" }).click();
    }],
    ["go back to Home and into the group", async () => {
      await page.getByRole("link", { name: "Home" }).first().click();
      await page.waitForTimeout(1200);
      await page.getByRole("link", { name: /Lisbon 2026/ }).first().click();
    }],
  ];
  await page.goto(`${BASE}/groups/${data.groupId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__motion.length = 0; });
  for (const [name, flow] of flows) {
    try {
      await flow();
      await page.waitForTimeout(1500);
    } catch (e) {
      check(name, false, `couldn't run: ${String(e).slice(0, 120)}`);
      continue;
    }
    const seen = await page.evaluate(() => window.__motion.splice(0));
    const still = /^(opacity|color|backgroundColor|background|borderColor|borderw*Color|fill|stroke|boxShadow|outlinew*|textDecorationColor|caretColor)$/;
    const moving = seen.filter((m) =>
      m.iterations !== Infinity &&
      (m.kind === "script" || (m.duration > 1 && m.props.some((p) => !still.test(p)))),
    );
    const detail = moving.slice(0, 4).map((m) => `${m.props.join("+")} ${Math.round(m.duration)}ms on ${m.target}`).join("; ");
    check(`${name}: nothing moves`, moving.length === 0, moving.length ? detail : `${seen.length} fades or instant changes`);
  }
  await ctx.close();
}

await browser.close();
writeFileSync(join(OUT, "network-check.txt"), `${pass} passed, ${fail} failed\n`);
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
