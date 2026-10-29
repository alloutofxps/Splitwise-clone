/**
 * Phone and accessibility check (RULES.md R2, R3, R4, R6, A1, A4).
 *
 *   node scripts/phone-check.mjs <base-url> <out-dir>
 *
 * WebKit keeps the app's Secure cookie only over https: serve it through a
 * local https relay and pass BASE_WEBKIT=https://localhost:<port> to include
 * Safari's engine. Without it, only Chrome's engine runs.
 *
 * On 23 screens and states, at iPhone 15 size:
 *   - tap:     every control whose real tap area is under 44 points either
 *              way, found by asking the browser what a tap at each point
 *              would hit, outward from the control's centre (so an invisible
 *              larger tap area counts);
 *   - axe:     axe's WCAG 2.2 AA rules, in Day and Night;
 *   - text:    text at 200%: sideways scrolling, and words drawn over words;
 *   - zoom:    200% zoom (the phone layout at half width): the same;
 *   - notch:   controls and words the notch or home bar covers for good: at
 *              the very top or bottom of a screen, or pinned in place (Chrome
 *              only: it can pretend to have a notch);
 *   - keyboard: every field of 9 forms with an iPhone-like keyboard up: is
 *              the field in view, and the form's Save button (and the forms'
 *              tap areas);
 *   - panels:  tap areas in every panel keyboard-check opens, at the top and
 *              scrolled to the end.
 *
 * PARTS=screens,forms,panels (the default) runs only the parts named.
 *
 * Writes <out-dir>/phone-check.txt and results.json and prints the totals.
 * A report: compare totals before and after a change. STRICT=1 exits 1 when
 * any total is not 0.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const BASE_ARG = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "phone-check";
let BASE = BASE_ARG;
const PARTS = (process.env.PARTS ?? "screens,forms,panels").split(",");
mkdirSync(OUT, { recursive: true });
const W = 393, H = 852, KB = 336, NOTCH = 59, HOME_BAR = 34;

// ---- test data -----------------------------------------------------------------

async function seed(browser) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  const out = await page.evaluate(async () => {
    const call = async (path, method = "GET", body) => {
      const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text();
      if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${t.slice(0, 200)}`);
      return t ? JSON.parse(t) : null;
    };
    const me = (await call("/api/identity", "POST", { displayName: "Priya Shah", avatarColor: "violet" })).me;
    sessionStorage.removeItem("divvy-recovery-key");
    localStorage.removeItem("divvy-recovery-pending");
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
    const even = (total, ids) => ids.map((p, i) => ({ personId: p, amount: String(Math.floor(total / ids.length) + (i < total % ids.length ? 1 : 0)) }));
    const add = (groupId, members, amount, payer, description, categoryId, n, currency = "EUR", extra = {}) =>
      call("/api/expenses", "POST", { groupId, description, categoryId, amount: String(amount), currency, splitMode: "EQUAL", date: day(n),
        payers: [{ personId: payer, amount: String(amount) }], splits: even(amount, members), ...extra });

    const trip = (await call("/api/groups", "POST", { name: "Lisbon 2026", kind: "trip", emoji: "🏝️", currency: "EUR", placeholderNames: ["Ravi", "Sam", "Nadia"] })).group;
    const td = (await call(`/api/groups/${trip.id}`)).group;
    const id = (g, name) => g.members.find((m) => m.displayName === name).id;
    const four = [me.id, id(td, "Ravi"), id(td, "Sam"), id(td, "Nadia")];
    await add(trip.id, four, 48000, me.id, "Airbnb Alfama", "accommodation", 6);
    await add(trip.id, four, 12850, id(td, "Ravi"), "Time Out Market", "dining", 5);
    await add(trip.id, four, 3200, me.id, "Tram 28", "transport", 4);
    await add(trip.id, four, 9600, id(td, "Sam"), "Sintra day trip", "entertainment", 3);
    await add(trip.id, four, 6420, id(td, "Nadia"), "Pastéis de Belém", "dining", 2);
    await call("/api/settlements", "POST", { groupId: trip.id, fromPersonId: id(td, "Ravi"), toPersonId: me.id, amount: "10000", currency: "EUR" });

    // Many people
    const names = ["Ana", "Ben", "Chloé", "Dev", "Emeka", "Farah", "Gus", "Hana", "Ivo", "Jae", "Kofi"];
    const big = (await call("/api/groups", "POST", { name: "Wedding weekend", kind: "event", emoji: "💍", currency: "GBP", placeholderNames: names })).group;
    const bd = (await call(`/api/groups/${big.id}`)).group;
    const all = bd.members.map((m) => m.id);
    for (let i = 0; i < 12; i++) await add(big.id, all, 1000 + i * 1371, all[i % all.length], `Shared cost ${i + 1}`, "general", i, "GBP");

    // Long names and big amounts
    const L = "Maximiliana Wolfeschlegelsteinhausenberg"; // 40 letters
    const long = (await call("/api/groups", "POST", { name: "The Extraordinarily Long Annual Reunion", kind: "other", emoji: "🎉", currency: "USD", placeholderNames: [L, "Bartholomew Featherstonehaugh-Cholmondeley"] })).group;
    const ld = (await call(`/api/groups/${long.id}`)).group;
    const lm = ld.members.map((m) => m.id);
    await add(long.id, lm, 999999999, id(ld, L), "An unusually long description for an expense that keeps going on", "general", 1, "USD");

    // Many currencies (rates may be unavailable offline; failures are recorded)
    const errors = [];
    for (const [cur, amt, rate] of [["USD", 4250, "0.92"], ["JPY", 12000, "0.0061"], ["KWD", 12500, "2.98"], ["INR", 250000, "0.011"], ["GBP", 3999, "1.17"]]) {
      try { await add(trip.id, four, amt, me.id, `Paid in ${cur}`, "general", 0, cur, { exchangeRate: rate }); } catch (e) { errors.push(String(e)); }
    }
    return { tripId: trip.id, bigId: big.id, longId: long.id, invite: td.inviteCode, myCode: me.inviteCode, errors, firstFriend: id(td, "Ravi") };
  });
  const state = await ctx.storageState();
  await ctx.close();
  return { ...out, state };
}

async function emptyIdentity(browser) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.evaluate(async () => {
    await fetch("/api/identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Tom", avatarColor: "teal" }) });
    sessionStorage.removeItem("divvy-recovery-key");
    localStorage.removeItem("divvy-recovery-pending");
  });
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

const screensFor = (data, empty) => [
  // [name, path, state, setup]
  ["welcome", "/", null],
  ["join-invite-fresh", `/join/${data.invite}`, null],
  ["privacy", "/privacy", null],
  ["home-empty", "/", empty],
  ["home", "/", data.state],
  ["group", `/groups/${data.tripId}`, data.state],
  ["group-balances", `/groups/${data.tripId}`, data.state, async (p) => { await p.getByRole("tab", { name: "Balances" }).click(); }],
  ["group-insights", `/groups/${data.tripId}`, data.state, async (p) => { await p.getByRole("tab", { name: "Insights" }).click(); }],
  ["composer", `/groups/${data.tripId}`, data.state, async (p) => { await p.getByRole("button", { name: /Add an expense/ }).first().click(); await p.waitForTimeout(800); await p.getByLabel("Amount").first().fill("64.50"); }],
  ["settle-up", `/groups/${data.tripId}`, data.state, async (p) => { await p.getByRole("button", { name: /Settle up/ }).first().click(); }],
  ["group-many", `/groups/${data.bigId}`, data.state],
  ["group-many-balances", `/groups/${data.bigId}`, data.state, async (p) => { await p.getByRole("tab", { name: "Balances" }).click(); }],
  ["group-long", `/groups/${data.longId}`, data.state],
  ["group-long-balances", `/groups/${data.longId}`, data.state, async (p) => { await p.getByRole("tab", { name: "Balances" }).click(); }],
  ["friends", "/friends", data.state],
  ["friend", `/friends/${data.firstFriend}`, data.state],
  ["activity", "/activity", data.state],
  ["account", "/account", data.state],
  ["search", "/search", data.state],
  ["join-invite-member", `/join/${data.invite}`, empty],
  ["offline-page", "/offline", data.state],
  ["home-loading", "/", data.state, null, async (ctx) => { await ctx.route("**/api/dashboard**", async (r) => { await new Promise((res) => setTimeout(res, 8000)); await r.continue().catch(() => {}); }); }, 900],
  ["home-error", "/", data.state, null, async (ctx) => { await ctx.route("**/api/dashboard**", (r) => r.fulfill({ status: 500, body: '{"error":"boom"}', contentType: "application/json" })); }, 12000],
  ["group-error", `/groups/${data.tripId}`, data.state, null, async (ctx) => { await ctx.route("**/api/groups/**", (r) => r.fulfill({ status: 500, body: '{"error":"boom"}', contentType: "application/json" })); }, 12000],
];

// ---- measurements that run in the page --------------------------------------

/** Controls whose real tap area is under 44 points either way. */
const tapAreas = () => {
  const vw = innerWidth, vh = innerHeight, out = [];
  const label = (el) => (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || el.getAttribute("placeholder") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 50);
  const sel = "a[href], button, [role=button], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=link], [role=option], input:not([type=hidden]), select, textarea, summary";
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || s.visibility === "hidden" || s.display === "none" || el.closest("[inert]")) continue;
    if (el.matches("input") && s.opacity === "0" && el.labels?.length) continue; // measured through its label
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cx > vw || cy < 0 || cy > vh) continue;
    const owners = [el, ...(el.labels ?? [])];
    const mine = (x, y) => {
      if (x < 0 || y < 0 || x >= vw || y >= vh) return false;
      const hit = document.elementFromPoint(x, y);
      return !!hit && owners.some((o) => o === hit || o.contains(hit));
    };
    if (!mine(cx, cy)) continue; // covered by something else
    const reach = (dx, dy) => { let d = 0; while (d < 60 && mine(cx + dx * (d + 1), cy + dy * (d + 1))) d++; return d; };
    const w = reach(-1, 0) + reach(1, 0) + 1, h = reach(0, -1) + reach(0, 1) + 1;
    if (w < 44 || h < 44) out.push(`${label(el)} (${w}x${h})`);
  }
  return [...new Set(out)];
};

/** Sideways scrolling, and words drawn over other words. Only what is
 * actually on top counts: text passing under the tab bar, or a swipe button
 * waiting behind its row, is not a problem. */
const layout = () => {
  const vw = document.documentElement.clientWidth, vh = innerHeight;
  const out = { sideways: document.documentElement.scrollWidth > vw + 1, offRight: [], overlaps: [] };
  const label = (el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 30);
  // On top where it's drawn, and not faded out (an invisible label still
  // answers elementFromPoint).
  // Screen-reader-only text (clipped to a pixel) isn't drawn either.
  const opaque = (el) => {
    let o = 1;
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.clip !== "auto" || (s.overflow === "hidden" && e.getBoundingClientRect().width <= 1)) return false;
      o *= Number(s.opacity);
    }
    return o > 0.05;
  };
  const shown = (el, x, y) => { const hit = document.elementFromPoint(x, y); return !!hit && (hit === el || el.contains(hit) || hit.contains(el)) && opaque(el); };
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || s.visibility === "hidden" || s.display === "none") continue;
    if (r.right > vw + 1 && s.position !== "fixed") {
      let p = el.parentElement, clipped = false;
      while (p && p !== document.body) { if (getComputedStyle(p).overflowX !== "visible") { clipped = true; break; } p = p.parentElement; }
      if (!clipped && !el.children.length) out.offRight.push(label(el));
    }
  }
  const runs = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, parent = node.parentElement;
    if (!node.textContent.trim() || !parent || parent.closest("script, style")) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.width <= 2 || r.height <= 2 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
      if (!shown(parent, Math.min(vw - 1, Math.max(0, r.left + Math.min(r.width / 2, 6))), r.top + r.height / 2)) continue;
      runs.push({ r, el: parent, text: node.textContent.trim().slice(0, 24) });
    }
  }
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
    const a = runs[i], b = runs[j];
    if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (x > 3 && y > 3) out.overlaps.push(`"${a.text}" / "${b.text}"`);
  }
  out.offRight = [...new Set(out.offRight)].slice(0, 10);
  out.overlaps = [...new Set(out.overlaps)].slice(0, 15);
  return out;
};

/**
 * Controls and words, actually on top, that the notch or home bar covers for
 * good. Scrolling content passing under the clock is normal; what counts is
 * what can't be scrolled out from under it: anything at the very top of the
 * page (`end` false) or the very bottom (`end` true), and anything pinned in
 * place (fixed or sticky) at either edge.
 */
const underInsets = ([top, bottom, end]) => {
  const vh = innerHeight, out = [];
  const label = (el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 30);
  const pinned = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) if (/fixed|sticky/.test(getComputedStyle(e).position)) return true; return false; };
  for (const el of document.querySelectorAll("a[href], button, [role=button], [role=tab], input, textarea, h1, h2, h3, p, span")) {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || s.visibility === "hidden" || s.display === "none" || s.opacity === "0") continue;
    if (el.matches("p, span, h1, h2, h3") && (el.children.length || !el.textContent.trim())) continue;
    let inTop = r.top < top - 1 && r.bottom > 2, inBottom = r.bottom > vh - bottom + 1 && r.top < vh - 2;
    if (inTop && end && !pinned(el)) inTop = false;
    if (inBottom && !end && !pinned(el)) inBottom = false;
    if (!inTop && !inBottom) continue;
    const y = inTop ? Math.max(1, r.top + 1) : Math.min(vh - 2, r.bottom - 1);
    const hit = document.elementFromPoint(r.left + r.width / 2, y);
    if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) continue; // under something
    out.push(`${inTop ? "top" : "bottom"}: ${label(el)}`);
  }
  return [...new Set(out)];
};

// An iPhone-like keyboard, installed before the app loads: the layout
// viewport stays put, the visual one shrinks and slides to the focused field.
const fakeKeyboard = () => {
  const vv = new EventTarget();
  let kb = 0, top = 0;
  Object.defineProperties(vv, {
    height: { get: () => innerHeight - kb }, width: { get: () => innerWidth },
    offsetTop: { get: () => top }, offsetLeft: { get: () => 0 },
    pageTop: { get: () => scrollY + top }, pageLeft: { get: () => 0 }, scale: { get: () => 1 },
  });
  Object.defineProperty(window, "visualViewport", { get: () => vv, configurable: true });
  window.__keyboard = (px, slide) => { kb = px; top = slide; vv.dispatchEvent(new Event("resize")); vv.dispatchEvent(new Event("scroll")); };
};

/** With the keyboard up: is the focused field in view, and the Save button? */
const keyboardView = () => {
  const vv = window.visualViewport, top = vv.offsetTop, bottom = vv.offsetTop + vv.height;
  const el = document.activeElement, r = el.getBoundingClientRect();
  const name = (el.getAttribute("aria-label") || el.labels?.[0]?.textContent || el.getAttribute("placeholder") || el.tagName).trim().slice(0, 30);
  const scope = el.closest("[role=dialog]") ?? document.body;
  // The last such button: a panel's footer comes after its fields. (A button
  // with no type counts as "submit", so this goes by its words.)
  const save = [...scope.querySelectorAll("button")].filter((b) => {
    const t = (b.textContent || "").trim(), s = getComputedStyle(b), br = b.getBoundingClientRect();
    return br.width > 0 && s.display !== "none" && s.visibility !== "hidden" &&
      /^(Save|Add|Create|Record|Continue|Settle|Join|Start|Next|Send|Pay|Mark|Get started)/i.test(t) && !/^Add (a |an |someone|people)/i.test(t);
  }).at(-1);
  const inView = (rr) => rr.top >= top - 1 && rr.bottom <= bottom + 1;
  return { field: name, fieldInView: inView(r), save: save ? (save.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24) : null, saveInView: save ? inView(save.getBoundingClientRect()) : null };
};

// ---- the run -----------------------------------------------------------------

async function open(browser, { state, theme = "light", width = W, height = H, chrome, ctxSetup, init }) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height }, deviceScaleFactor: 2, isMobile: chrome, hasTouch: true, colorScheme: theme, storageState: state ?? undefined });
  if (init) await ctx.addInitScript(init);
  if (ctxSetup) await ctxSetup(ctx);
  return { ctx, page: await ctx.newPage() };
}

/** Lets running animations finish (the welcome drawing plays once at load),
 * so words caught mid-flight aren't counted. Endless ones (a spinner) are cut
 * off after four seconds. */
async function settled(page) {
  await page.waitForTimeout(300);
  await page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))),
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ]));
  await page.waitForTimeout(200);
}

async function show(page, path, action, wait) {
  await page.goto(BASE + path, { waitUntil: wait ? "domcontentloaded" : "load", timeout: 30000 });
  await page.waitForTimeout(wait ?? 1300);
  if (action) { await action(page); await page.waitForTimeout(1000); }
}

// Forms that bring up the keyboard: [name, path, signed in?, how to open].
// Every panel, opened the way keyboard-check opens it: [name, path, how].
const panels = (data) => {
  const group = `/groups/${data.tripId}`;
  const btn = (p, name, exact) => p.getByRole("button", { name, exact }).first().click();
  const inComposer = (name) => async (p) => {
    await btn(p, /Add an expense/);
    await p.waitForTimeout(800);
    await p.locator("[role=dialog]").last().getByRole("button", { name }).first().click();
  };
  return [
    ["expense details", group, (p) => btn(p, /Airbnb Alfama/)],
    ["invite", group, (p) => btn(p, "Invite", true)],
    ["members", group, (p) => btn(p, /4 people/)],
    ["add a payment", group, async (p) => { await p.getByRole("tab", { name: "Balances" }).click(); await p.waitForTimeout(400); await btn(p, "Add a payment"); }],
    ["suggested payment", group, async (p) => { await p.getByRole("tab", { name: "Balances" }).click(); await p.waitForTimeout(400); await btn(p, /^Settle, /); }],
    ["composer > split", group, inComposer(/^Split/)],
    ["composer > who paid", group, inComposer(/^Paid by/)],
    ["composer > currency", group, inComposer(/^Currency/)],
    ["composer > category", group, inComposer(/^Category/)],
    ["join a group", "/", (p) => btn(p, "Join", true)],
    ["my code", "/friends", (p) => btn(p, "My code")],
    ["friends filter", "/friends", (p) => btn(p, /Filter this list/)],
    ["friend settings", `/friends/${data.firstFriend}`, (p) => btn(p, "Friend settings")],
    ["friend settle up", `/friends/${data.firstFriend}`, (p) => btn(p, "Settle up", true)],
    ["activity row", "/activity", (p) => p.locator("main button").filter({ hasText: /added/ }).first().click()],
    ["emoji", "/account", (p) => btn(p, /Pick an emoji|Change your emoji/)],
    ["how people pay you", "/account", (p) => btn(p, /How people can pay you/)],
    ["default currency", "/account", (p) => btn(p, /Default currency/)],
    ["budgets", "/account", (p) => btn(p, /^Budgets/)],
    ["your devices", "/account", (p) => btn(p, /Your devices/)],
    ["recovery key", "/account", (p) => btn(p, /Recovery key/)],
    ["delete my account", "/account", (p) => btn(p, "Delete my account")],
  ];
};

const forms = (data) => [
  ["welcome", "/", false, async (p) => { await p.getByRole("button", { name: /Get started/ }).first().click(); }],
  ["invite", `/join/${data.invite}`, false, null],
  ["add an expense", `/groups/${data.tripId}`, true, async (p) => { await p.getByRole("button", { name: /Add an expense/ }).first().click(); }],
  ["settle up", `/groups/${data.tripId}`, true, async (p) => { await p.getByRole("button", { name: /Settle up/ }).first().click(); }],
  ["new group", "/", true, async (p) => { await p.getByRole("button", { name: /New group/ }).first().click(); }],
  ["add a friend", "/friends", true, async (p) => { await p.getByRole("button", { name: /^Add/ }).first().click(); }],
  ["group settings", `/groups/${data.tripId}`, true, async (p) => { await p.getByRole("button", { name: /Group settings/ }).first().click(); }],
  ["account", "/account", true, null],
  ["search", "/search", true, null],
];

const results = [];
const report = [];
const totals = {};
const count = (engine, kind, n) => { const key = `${kind} (${engine})`; totals[key] = (totals[key] ?? 0) + n; };

const engines = [["chromium", chromium, process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}]];
if (process.env.BASE_WEBKIT) engines.push(["webkit", webkit, {}]);

for (const [engine, launcher, opts] of engines) {
  BASE = engine === "webkit" ? process.env.BASE_WEBKIT : BASE_ARG;
  const chrome = engine === "chromium";
  const browser = await launcher.launch(opts);
  const data = await seed(browser);
  const empty = await emptyIdentity(browser);
  for (const kind of ["tap", "axe", "text", "zoom", "keyboard", ...(chrome ? ["notch"] : [])]) count(engine, kind, 0);

  for (const [name, path, state, action, ctxSetup, wait] of PARTS.includes("screens") ? screensFor(data, empty) : []) {
    const runs = [
      { kind: "base", theme: "light" }, { kind: "base", theme: "dark" },
      { kind: "text" }, { kind: "zoom", width: Math.round(W / 2), height: Math.round(H / 2) },
      ...(chrome ? [{ kind: "notch" }] : []),
    ];
    for (const run of runs) {
      const { ctx, page } = await open(browser, { state, theme: run.theme, width: run.width, height: run.height, chrome, ctxSetup });
      const rec = { engine, name, kind: run.kind, theme: run.theme };
      try {
        if (run.kind === "notch") {
          const cdp = await ctx.newCDPSession(page);
          await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: NOTCH, bottom: HOME_BAR, left: 0, right: 0 } });
        }
        await show(page, path, action, wait);
        if (run.kind === "base") {
          if (run.theme === "light") rec.tap = await page.evaluate(tapAreas);
          const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
          rec.axe = axe.violations.map((v) => `${v.id} x${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")}`);
          rec.axeCount = axe.violations.reduce((sum, v) => sum + v.nodes.length, 0);
        } else if (run.kind === "text") {
          await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
          await settled(page);
          Object.assign(rec, await page.evaluate(layout));
          await page.screenshot({ path: join(OUT, `${engine}-text-${name}.png`) });
        } else if (run.kind === "zoom") {
          await settled(page);
          Object.assign(rec, await page.evaluate(layout));
          await page.screenshot({ path: join(OUT, `${engine}-zoom-${name}.png`) });
        } else if (run.kind === "notch") {
          rec.atTop = await page.evaluate(underInsets, [NOTCH, HOME_BAR, false]);
          await page.screenshot({ path: join(OUT, `${engine}-notch-${name}-top.png`) });
          await page.mouse.move(W / 2, H / 2);
          for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 5000);
          await page.waitForTimeout(700);
          rec.scrolled = await page.evaluate(underInsets, [NOTCH, HOME_BAR, true]);
          await page.screenshot({ path: join(OUT, `${engine}-notch-${name}-end.png`) });
        }
      } catch (e) {
        rec.failed = String(e).slice(0, 300);
      }
      results.push(rec);
      await ctx.close();

      const lines = [];
      if (rec.failed) lines.push(`FAILED ${rec.failed}`);
      if (rec.tap?.length) { count(engine, "tap", rec.tap.length); lines.push(`tap under 44: ${rec.tap.join("; ")}`); }
      if (rec.axe?.length) { count(engine, "axe", rec.axeCount); lines.push(`axe (${rec.theme}): ${rec.axe.join("; ")}`); }
      if (run.kind === "text" || run.kind === "zoom") {
        const n = (rec.sideways ? 1 : 0) + (rec.overlaps?.length ?? 0);
        count(engine, run.kind, n);
        if (rec.sideways) lines.push(`${run.kind}: scrolls sideways (${rec.offRight.join("; ")})`);
        if (rec.overlaps?.length) lines.push(`${run.kind}: words over words: ${rec.overlaps.join("; ")}`);
      }
      if (run.kind === "notch") {
        const all = [...(rec.atTop ?? []).map((x) => `at the start, ${x}`), ...(rec.scrolled ?? []).map((x) => `scrolled to the end, ${x}`)];
        count(engine, "notch", all.length);
        if (all.length) lines.push(`notch or home bar: ${all.join("; ")}`);
      }
      if (lines.length) report.push(`${engine} ${name}\n${lines.map((l) => `  - ${l}`).join("\n")}`);
      console.log(engine, name, run.kind, run.theme ?? "", rec.failed ? "FAILED" : lines.length ? `${lines.length} problem lines` : "ok");
    }
  }

  for (const [name, path, signedIn, opener] of PARTS.includes("forms") ? forms(data) : []) {
    const { ctx, page } = await open(browser, { state: signedIn ? data.state : null, chrome, init: fakeKeyboard });
    try {
      await show(page, path, opener);
      // The forms' own controls, which the screens above don't open.
      const small = await page.evaluate(tapAreas);
      count(engine, "tap", small.length);
      if (small.length) report.push(`${engine} ${name} (form)\n  - tap under 44: ${small.join("; ")}`);
      const scope = (await page.locator("[role=dialog]").count()) ? page.locator("[role=dialog]").last() : page.locator("body");
      // inputmode=none fields (the amount pad) never bring up the phone's keyboard.
      const fields = scope.locator("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([inputmode=none]), textarea");
      for (let i = 0; i < (await fields.count()); i++) {
        const field = fields.nth(i);
        if (!(await field.isVisible())) continue;
        await page.evaluate(() => window.__keyboard(0, 0));
        await page.waitForTimeout(150);
        await field.focus();
        // Where iOS slides the visible part to, to show the field.
        await page.evaluate((kb) => {
          const r = document.activeElement.getBoundingClientRect();
          window.__keyboard(kb, Math.max(0, Math.min(kb, r.bottom + 12 - (innerHeight - kb))));
        }, KB);
        await page.waitForTimeout(500);
        const view = await page.evaluate(keyboardView);
        results.push({ engine, name, kind: "keyboard", ...view });
        const bad = [];
        if (!view.fieldInView) bad.push(`the field "${view.field}" is under the keyboard`);
        if (view.save && !view.saveInView) bad.push(`"${view.save}" is under the keyboard while typing in "${view.field}"`);
        count(engine, "keyboard", bad.length);
        if (bad.length) report.push(`${engine} ${name} (keyboard)\n${bad.map((l) => `  - ${l}`).join("\n")}`);
        console.log(engine, name, "keyboard", view.field, bad.length ? bad.join("; ") : "ok");
      }
    } catch (e) {
      report.push(`${engine} ${name} (keyboard)\n  - FAILED ${String(e).slice(0, 200)}`);
      console.log(engine, name, "keyboard FAILED", String(e).slice(0, 120));
    }
    await ctx.close();
  }

  // Every panel, as keyboard-check opens them: tap areas, at the top of the
  // panel and scrolled to its end.
  for (const [name, path, opener] of PARTS.includes("panels") ? panels(data) : []) {
    const { ctx, page } = await open(browser, { state: data.state, chrome });
    try {
      await show(page, path, opener);
      const small = new Set(await page.evaluate(tapAreas));
      await page.evaluate(() => {
        const body = [...document.querySelectorAll("[role=dialog] .scroll-area")].at(-1);
        if (body) body.scrollTop = body.scrollHeight;
      });
      await page.waitForTimeout(300);
      for (const s of await page.evaluate(tapAreas)) small.add(s);
      count(engine, "tap", small.size);
      if (small.size) report.push(`${engine} ${name} (panel)\n  - tap under 44: ${[...small].join("; ")}`);
      console.log(engine, name, "panel", small.size ? `${small.size} small` : "ok");
    } catch (e) {
      report.push(`${engine} ${name} (panel)\n  - FAILED ${String(e).slice(0, 200)}`);
      console.log(engine, name, "panel FAILED", String(e).slice(0, 120));
    }
    await ctx.close();
  }
  await browser.close();
}

const summary = Object.entries(totals).map(([k, v]) => `${k}: ${v}`).join("\n");
writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 1));
writeFileSync(join(OUT, "phone-check.txt"), `${summary}\n\n${report.join("\n\n")}\n`);
console.log(`\nTotals\n${summary}`);
const failures = results.filter((r) => r.failed).length;
if (failures) console.log(`${failures} screens couldn't be checked`);
process.exit(process.env.STRICT && (failures || Object.values(totals).some((v) => v > 0)) ? 1 : 0);
