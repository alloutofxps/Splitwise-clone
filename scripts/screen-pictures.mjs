/**
 * Picture comparison (RULES.md L4): any change to how a screen looks is
 * caught before it ships.
 *
 *   node scripts/screen-pictures.mjs <base-url> <out-dir>
 *
 * Takes a picture of the main screens, panels and states, in Day and Night
 * on a phone and a few on a computer, and compares each with the approved
 * one in tests/screens/. A picture that differs, or has no approved one yet,
 * fails the check; <out-dir> then holds the new pictures (new/) and, for
 * each that differs, the old and new side by side with the changes in red
 * (diff/).
 *
 * The approved pictures come from Linux in CI: fonts and anti-aliasing differ
 * between systems, so pictures taken on Windows or a Mac won't match them.
 * When a change to the looks is intended, take the new pictures from the
 * failed CI run's "screen-pictures" download, check them, and commit them
 * to tests/screens/. UPDATE=1 writes the pictures straight into
 * tests/screens/ instead of comparing (only useful on Linux).
 *
 * Every run must take the same pictures, so the data, dates and clock are
 * fixed: a new account with the same groups and expenses each time, the
 * browser's clock held at one moment, the times the server stamps on things
 * replaced with fixed ones, the motion reduced and the service worker off.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "screen-pictures";
const APPROVED = "tests/screens";
const UPDATE = Boolean(process.env.UPDATE);
for (const dir of [OUT, join(OUT, "new"), join(OUT, "diff"), APPROVED]) mkdirSync(dir, { recursive: true });

/** The moment the browser's clock is held at, and the dates are counted from. */
const NOW = Date.parse("2026-10-15T12:00:00Z");
const PHONE = { width: 390, height: 844 };
const COMPUTER = { width: 1280, height: 800 };
/** A changed pixel is one pixelmatch sees past this (0 to 1; it ignores anti-aliasing). */
const PIXEL = 0.1;

// Each sign-up from its own address, as phone-check does: sign-ups are
// limited per address, and in CI every browser shares the machine's.
let people = 0;
const newAddress = () => `198.18.41.${++people}`;

/** Times the server stamps (when something was added, changed, last active). */
const STAMPS = new Set(["createdAt", "updatedAt", "lastActivityAt", "lastSeenAt", "joinedAt", "settledAt"]);
function fixStamps(value, at) {
  if (Array.isArray(value)) return value.map((item) => fixStamps(item, at));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, STAMPS.has(key) && typeof item === "string" ? at : fixStamps(item, at)]));
  }
  return value;
}

async function open(browser, { state, scheme = "light", size = PHONE }) {
  const ctx = await browser.newContext({
    viewport: size, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: "reduce",
    locale: "en-GB", timezoneId: "UTC", serviceWorkers: "block",
    storageState: state ?? undefined, extraHTTPHeaders: { "X-Forwarded-For": newAddress() },
  });
  // An hour before the held clock: "1h ago" on every run.
  const stamp = new Date(NOW - 3600_000).toISOString();
  await ctx.route("**/api/**", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const type = response.headers()["content-type"] ?? "";
    if (!type.includes("json")) return route.fulfill({ response });
    const body = fixStamps(await response.json(), stamp);
    return route.fulfill({ response, body: JSON.stringify(body) });
  });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  return { ctx, page };
}

// ---- test data -------------------------------------------------------------

async function seed(browser) {
  const { ctx, page } = await open(browser, {});
  await page.goto(BASE, { waitUntil: "load" });
  const out = await page.evaluate(async (now) => {
    const call = async (path, method = "GET", body) => {
      const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text();
      if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${t.slice(0, 200)}`);
      return t ? JSON.parse(t) : null;
    };
    const me = (await call("/api/identity", "POST", { displayName: "Priya Shah", avatarColor: "violet" })).me;
    sessionStorage.removeItem("divvy-recovery-key");
    localStorage.removeItem("divvy-recovery-pending");
    const day = (n) => new Date(now - n * 86400000).toISOString();
    const even = (total, ids) => ids.map((p, i) => ({ personId: p, amount: String(Math.floor(total / ids.length) + (i < total % ids.length ? 1 : 0)) }));
    const add = (groupId, members, amount, payer, description, categoryId, n) =>
      call("/api/expenses", "POST", { groupId, description, categoryId, amount: String(amount), currency: "EUR", splitMode: "EQUAL", date: day(n),
        payers: [{ personId: payer, amount: String(amount) }], splits: even(amount, members) });

    const trip = (await call("/api/groups", "POST", { name: "Lisbon 2026", kind: "trip", emoji: "🏝️", currency: "EUR", placeholderNames: ["Ravi", "Sam", "Nadia"] })).group;
    const td = (await call(`/api/groups/${trip.id}`)).group;
    const id = (name) => td.members.find((m) => m.displayName === name).id;
    const four = [me.id, id("Ravi"), id("Sam"), id("Nadia")];
    await add(trip.id, four, 48000, me.id, "Airbnb Alfama", "accommodation", 6);
    await add(trip.id, four, 12850, id("Ravi"), "Time Out Market", "dining", 5);
    await add(trip.id, four, 3200, me.id, "Tram 28", "transport", 4);
    await add(trip.id, four, 9600, id("Sam"), "Sintra day trip", "entertainment", 3);
    await add(trip.id, four, 6420, id("Nadia"), "Pastéis de Belém", "dining", 2);
    await add(trip.id, four, 2400, id("Ravi"), "Coffee and pastries", "dining", 40);
    await call("/api/settlements", "POST", { groupId: trip.id, fromPersonId: id("Ravi"), toPersonId: me.id, amount: "10000", currency: "EUR", date: day(1) });
    return { tripId: trip.id, ravi: id("Ravi") };
  }, NOW);
  const state = await ctx.storageState();
  await ctx.close();
  return { ...out, state };
}

// ---- the pictures ----------------------------------------------------------

const tab = (name) => async (p) => { await p.getByRole("tab", { name }).click(); };
const pictures = (data) => [
  // [name, path, signed in, setup, sizes]
  ["welcome", "/", false],
  ["home", "/", true, null, [PHONE, COMPUTER]],
  ["group", `/groups/${data.tripId}`, true, null, [PHONE, COMPUTER]],
  ["group-balances", `/groups/${data.tripId}`, true, tab("Balances"), [PHONE, COMPUTER]],
  ["group-insights", `/groups/${data.tripId}`, true, tab("Insights")],
  ["composer", `/groups/${data.tripId}`, true, async (p) => {
    await p.getByRole("button", { name: /Add an expense/ }).first().click();
    await p.waitForTimeout(800);
    await p.getByLabel("Amount").first().fill("64.50");
  }],
  ["settle-up", `/groups/${data.tripId}`, true, async (p) => { await p.getByRole("button", { name: /Settle up/ }).first().click(); }],
  ["friends", "/friends", true],
  ["friend", `/friends/${data.ravi}`, true],
  ["activity", "/activity", true],
  ["account", "/account", true],
  ["privacy", "/privacy", false],
  ["nothing-here", "/this-is-not-a-page", true],
];

async function take(browser, data, [name, path, signedIn, setup, sizes = [PHONE]], scheme) {
  const taken = [];
  for (const size of sizes) {
    const file = `${name}-${size === PHONE ? "phone" : "computer"}-${scheme === "dark" ? "night" : "day"}.png`;
    const { ctx, page } = await open(browser, { state: signedIn ? data.state : null, scheme, size });
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      if (setup) await setup(page);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(700);
      // Covered: what is new for every account or machine, not part of the looks.
      const mask = [page.getByText(/^me-[a-z0-9-]+/), page.getByText(/Using [\d.,]+ [KMG]?B/)];
      writeFileSync(join(OUT, "new", file), await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide", mask }));
      taken.push(file);
    } catch (error) {
      console.log(`  ✗ ${file}: could not take it (${String(error).split("\n")[0]})`);
      taken.push(null);
    } finally {
      await ctx.close();
    }
  }
  return taken;
}

/** The approved and new pictures side by side, with what changed in red over the new one. */
function compare(file) {
  const approvedPath = join(APPROVED, file);
  if (!existsSync(approvedPath)) return { verdict: "new" };
  const before = PNG.sync.read(readFileSync(approvedPath));
  const after = PNG.sync.read(readFileSync(join(OUT, "new", file)));
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const pad = (png) => {
    if (png.width === width && png.height === height) return png;
    const out = new PNG({ width, height });
    out.data.fill(255);
    PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, 0);
    return out;
  };
  const a = pad(before), b = pad(after);
  const marks = new PNG({ width, height });
  const changed = pixelmatch(a.data, b.data, marks.data, width, height, { threshold: PIXEL, includeAA: false });
  if (changed === 0 && before.width === after.width && before.height === after.height) return { verdict: "same" };
  const sheet = new PNG({ width: width * 3, height });
  PNG.bitblt(a, sheet, 0, 0, width, height, 0, 0);
  PNG.bitblt(b, sheet, 0, 0, width, height, width, 0);
  PNG.bitblt(marks, sheet, 0, 0, width, height, width * 2, 0);
  writeFileSync(join(OUT, "diff", file), PNG.sync.write(sheet));
  const size = before.width === after.width && before.height === after.height ? "" : `, ${before.width}x${before.height} → ${after.width}x${after.height}`;
  return { verdict: "changed", detail: `${changed} pixels${size}` };
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const data = await seed(browser);
const files = [];
for (const picture of pictures(data)) {
  for (const scheme of ["light", "dark"]) files.push(...(await take(browser, data, picture, scheme)));
}
await browser.close();

let failed = files.filter((file) => file === null).length;
const counts = { same: 0, changed: 0, new: 0 };
for (const file of files.filter(Boolean)) {
  if (UPDATE) {
    copyFileSync(join(OUT, "new", file), join(APPROVED, file));
    continue;
  }
  const { verdict, detail } = compare(file);
  counts[verdict] += 1;
  if (verdict === "changed") console.log(`  ✗ ${file}: looks different (${detail})`);
  if (verdict === "new") console.log(`  ✗ ${file}: no approved picture yet`);
}
// An approved picture nobody takes any more is a screen this check lost.
const taken = new Set(files.filter(Boolean));
for (const file of readdirSync(APPROVED).filter((f) => f.endsWith(".png") && !taken.has(f))) {
  console.log(`  ✗ ${file}: approved, but no longer taken`);
  failed += 1;
}

if (UPDATE) {
  console.log(`\n${taken.size} pictures written to ${APPROVED}${failed ? `, ${failed} could not be taken` : ""}\n`);
} else {
  failed += counts.changed + counts.new;
  console.log(`\n${taken.size} pictures: ${counts.same} the same, ${counts.changed} different, ${counts.new} new${failed - counts.changed - counts.new ? `, ${failed - counts.changed - counts.new} other problems` : ""}\n`);
}
process.exit(failed === 0 ? 0 : 1);
