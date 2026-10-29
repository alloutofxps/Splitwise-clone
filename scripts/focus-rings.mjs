// Close-ups of the keyboard focus ring on each kind of control, Day and Night,
// put side by side on one sheet: <out-dir>/focus-rings.png.
//
//   node scripts/focus-rings.mjs <base-url> <out-dir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { launchOptions, seed, signIn } from "./check-accounts.mjs";

const BASE = process.argv[2] ?? "http://localhost:3100";

const OUT = process.argv[3] ?? "rings-out";
mkdirSync(OUT, { recursive: true });
const data = await seed(BASE);
const browser = await chromium.launch(launchOptions());
const shots = [];
for (const scheme of ["light", "dark"]) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: "reduce" });
  await signIn(context, BASE, data.me.cookie);
  const page = await context.newPage();
  const ring = async (label, path, locate) => {
    if (path) await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const el = (await locate()).first();
    // A key press first, so the browser treats the focus as keyboard focus
    // and :focus-visible applies, as it would for someone tabbing.
    await el.scrollIntoViewIfNeeded();
    await page.keyboard.press("Shift");
    await el.focus();
    await page.waitForTimeout(250);
    const box = await page.evaluate(() => {
      const r = document.activeElement.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, name: document.activeElement.getAttribute("aria-label") || document.activeElement.innerText?.slice(0, 30) };
    });
    const pad = 10;
    const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(390, box.w + pad * 2), height: Math.min(300, box.h + pad * 2) };
    const file = `${OUT}/${scheme}-${label}.png`;
    await page.screenshot({ path: file, clip });
    shots.push({ scheme, label, file, name: box.name });
  };
  const btn = (n, exact) => page.getByRole("button", { name: n, exact });
  await ring("settle-up-button", `/groups/${data.trip}`, () => btn("Settle up", true));
  await ring("tab-balances", null, () => page.getByRole("tab", { name: "Balances" }));
  await ring("ledger-row", null, () => btn(/Dinner at Cervejaria/));
  await ring("back-button", null, () => btn("Back"));
  await ring("tab-bar-friends", null, () => page.getByRole("link", { name: "Friends" }));
  await ring("tab-bar-add", null, () => btn("Add an expense"));
  await ring("flow-bar", "/", () => btn(/Who makes up this balance/));
  await ring("needs-you-row", null, () => page.getByRole("link", { name: /Settle up/ }));
  await ring("small-pill", null, () => btn("New group"));
  await ring("group-row", null, () => page.getByRole("link", { name: /Lisbon 2026/ }).last());
  await ring("friends-row", "/friends", () => page.getByRole("link", { name: /Ana Costa/ }));
  await ring("friend-history-row", `/friends/${data.ravi.id}`, () => btn(/Concert tickets/));
  await ring("friend-chip", null, () => btn("Everything", true));
  await ring("name-field", "/account", () => page.getByLabel("Your name"));
  await ring("switch", null, () => page.getByRole("switch").first());
  await ring("theme-segment", null, () => page.getByRole("radio", { name: "Night" }));
  await ring("filter-chip", "/activity", () => btn("All", true));
  await ring("activity-row", null, () => btn(/added Concert tickets/));
  await ring("settle-suggestion", `/groups/${data.trip}`, async () => {
    await btn("Settle up", true).first().click();
    await page.waitForTimeout(700);
    return page.locator('[role="dialog"] button').filter({ hasText: /pays you|^Pay / });
  });
  await ring("keypad-key", null, async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await btn("Add an expense").first().click();
    await page.waitForTimeout(700);
    await page.getByLabel("Amount").first().click();
    await page.waitForTimeout(300);
    return page.getByLabel("Amount keypad").getByRole("button", { name: "5", exact: true });
  });
  await page.keyboard.press("Escape");
  await context.close();
}
// One sheet.
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const { readFileSync } = await import("node:fs");
const items = shots.map((s) => ({ ...s, data: readFileSync(s.file).toString("base64") }));
const png = await page.evaluate(async (items) => {
  const labels = [...new Set(items.map((i) => i.label))];
  const rowH = 110, colW = 480;
  const canvas = document.createElement("canvas");
  canvas.width = colW * 2 + 20;
  canvas.height = labels.length * rowH + 30;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#888";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "14px sans-serif";
  ctx.fillStyle = "#000";
  ctx.fillText("Day", 10, 20);
  ctx.fillText("Night", colW + 20, 20);
  for (const [r, label] of labels.entries()) {
    for (const [c, scheme] of ["light", "dark"].entries()) {
      const it = items.find((i) => i.label === label && i.scheme === scheme);
      if (!it) continue;
      const img = new Image();
      img.src = `data:image/png;base64,${it.data}`;
      await img.decode();
      const scale = Math.min(1, (colW - 20) / img.width, (rowH - 24) / img.height);
      ctx.fillStyle = "#000";
      ctx.fillText(label, c * (colW + 10) + 10, 30 + r * rowH + 14);
      ctx.drawImage(img, c * (colW + 10) + 10, 30 + r * rowH + 18, img.width * scale, img.height * scale);
    }
  }
  return canvas.toDataURL("image/png").split(",")[1];
}, items);
writeFileSync(`${OUT}/focus-rings.png`, Buffer.from(png, "base64"));
await browser.close();
console.log("done", shots.length);
