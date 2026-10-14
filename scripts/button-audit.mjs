/**
 * Button audit: taps every control on every screen and reports the ones that
 * do nothing.
 *
 * "I pressed it and nothing happened" is a class of bug no unit or API test
 * sees: the handler is fine, the route is fine, and the tap never arrives -
 * something invisible is on top, the control is disabled without saying why,
 * or the handler returns early without a word. So this drives a real browser
 * at phone size, and for every visible control:
 *
 *   1. checks the point it would be tapped at actually hits it (not an overlay);
 *   2. taps it from a freshly loaded screen;
 *   3. watches for any effect - navigation, a request, a sheet opening or
 *      closing, the page changing, focus moving into a field, a popup;
 *   4. one level deeper, does the same for every control inside a sheet that a
 *      tap opened.
 *
 * Destructive confirmations are opened but never confirmed.
 *
 *   node scripts/button-audit.mjs http://localhost:3000
 *
 * Set CHROMIUM_PATH to drive an installed Chrome or Edge.
 */

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
const SETTLE_MS = 1100;

/** Labels never pressed inside a sheet: these would actually destroy or leave. */
const NEVER_CONFIRM = /^(Delete|Remove|Sign out|Leave|Delete my account|Sign out and discard|Delete group|Remove this payment|Revoke|Rotate|Turn off|Disable)/i;

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));

// ---------------------------------------------------------------------------
// Seed an account with something on every screen
// ---------------------------------------------------------------------------

await page.goto(BASE, { waitUntil: "networkidle" });
const seed = await page.evaluate(async () => {
  const call = async (path, method = "GET", body) => {
    const response = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  const me = (await call("/api/identity", "POST", { displayName: "Auditor" })).me;
  sessionStorage.removeItem("divvy-recovery-key");
  localStorage.removeItem("divvy-recovery-pending");
  await call("/api/identity/payment-methods", "POST", { kind: "upi", value: "auditor@okbank" });
  const group = (await call("/api/groups", "POST", { name: "Lisbon trip", currency: "EUR", placeholderNames: ["Sam", "Ravi"] })).group;
  const detail = (await call(`/api/groups/${group.id}`)).group;
  const sam = detail.members.find((m) => m.displayName === "Sam").id;
  const ravi = detail.members.find((m) => m.displayName === "Ravi").id;
  const dinner = (await call("/api/expenses", "POST", {
    groupId: group.id, description: "Dinner", amount: "9000", currency: "EUR", splitMode: "EQUAL",
    payers: [{ personId: me.id, amount: "9000" }],
    splits: [{ personId: me.id, amount: "3000" }, { personId: sam, amount: "3000" }, { personId: ravi, amount: "3000" }],
  })).expense;
  await call("/api/expenses", "POST", {
    groupId: group.id, description: "Taxi", amount: "2400", currency: "EUR", splitMode: "EQUAL",
    payers: [{ personId: sam, amount: "2400" }],
    splits: [{ personId: me.id, amount: "1200" }, { personId: sam, amount: "1200" }],
  });
  await call(`/api/expenses/${dinner.id}/comments`, "POST", { body: "Great place" });
  await call("/api/settlements", "POST", { groupId: group.id, fromPersonId: ravi, toPersonId: me.id, amount: "1000", currency: "EUR" });
  await call("/api/budgets", "PUT", { amount: "50000", currency: "EUR", period: "MONTHLY" });
  await call("/api/recurrences", "POST", {
    groupId: group.id, description: "Locker", amount: "1000", currency: "EUR",
    payers: [{ personId: me.id, amount: "1000" }], splits: [{ personId: me.id, amount: "1000" }],
    frequency: "MONTHLY", startDate: new Date(Date.now() + 86400000).toISOString(),
  });
  return { groupId: group.id, dinnerId: dinner.id, samId: sam };
});

const SCREENS = [
  { name: "Home", path: "/" },
  { name: "Group", path: `/groups/${seed.groupId}` },
  { name: "Friends", path: "/friends" },
  { name: "Activity", path: "/activity" },
  { name: "Search", path: "/search" },
  { name: "Account", path: "/account" },
];

// ---------------------------------------------------------------------------
// Instrumentation
// ---------------------------------------------------------------------------

async function openScreen(path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
}

/** Every visible, distinct control, as a stable selector key. */
async function controls(scope) {
  return page.evaluate((scopeSelector) => {
    const root = scopeSelector ? document.querySelector(scopeSelector) : document.body;
    if (!root) return [];
    const found = [];
    const seen = new Map();
    for (const el of root.querySelectorAll('button, a[href], [role="button"], [role="tab"], [role="switch"], [role="radio"], summary')) {
      if (!scopeSelector && el.closest('[role="dialog"]')) continue;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width < 2 || rect.height < 2 || style.visibility === "hidden" || style.display === "none") continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight * 3) continue;
      const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60);
      const key = `${el.tagName}|${label}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      found.push({
        key, label: label || `(unlabelled ${el.tagName.toLowerCase()})`, nth: n - 1,
        disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
        tag: el.tagName, href: el.getAttribute("href"),
      });
    }
    return found;
  }, scope ?? null);
}

async function locate(control, scope) {
  const root = scope ? page.locator(scope).last() : page.locator("body");
  const all = root.locator('button, a[href], [role="button"], [role="tab"], [role="switch"], [role="radio"], summary');
  const count = await all.count();
  let n = 0;
  for (let i = 0; i < count; i++) {
    const el = all.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const info = await el.evaluate((node, inDialogScope) => {
      if (!inDialogScope && node.closest('[role="dialog"]')) return null;
      const label = (node.getAttribute("aria-label") || node.textContent || node.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60);
      return `${node.tagName}|${label}`;
    }, Boolean(scope)).catch(() => null);
    if (info !== control.key) continue;
    if (n === control.nth) return el;
    n++;
  }
  return null;
}

/** What is actually at the point a finger would land on the control. */
async function coveredBy(el) {
  return el.evaluate((node) => {
    node.scrollIntoView({ block: "center", inline: "center" });
    const r = node.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || node === hit || node.contains(hit)) return null;
    const describe = (e) => `${e.tagName.toLowerCase()}${e.getAttribute("role") ? `[role=${e.getAttribute("role")}]` : ""}${e.className && typeof e.className === "string" ? `.${e.className.split(" ").slice(0, 4).join(".")}` : ""}`;
    return describe(hit);
  });
}

async function startWatch() {
  await page.evaluate(() => {
    window.__audit = { mutations: 0, requests: 0 };
    window.__auditObserver?.disconnect();
    window.__auditObserver = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && (record.attributeName === "style" || record.attributeName === "class")) continue;
        window.__audit.mutations++;
      }
    });
    window.__auditObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}

async function snapshot() {
  return page.evaluate(() => ({
    url: location.href,
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    text: document.body.innerText.length,
    theme: document.documentElement.className,
    focus: document.activeElement ? `${document.activeElement.tagName}:${document.activeElement.getAttribute("aria-label") ?? ""}` : "",
    mutations: window.__audit?.mutations ?? 0,
  }));
}

let requests = 0;
page.on("request", (request) => {
  if (!/\/_next\/|\.(png|svg|ico|woff2?)$/.test(request.url())) requests++;
});

/** Taps one control and says what, if anything, happened. */
async function tap(el) {
  await startWatch();
  const before = await snapshot();
  const requestsBefore = requests;
  let popup = false;
  const onPopup = () => (popup = true);
  context.once("page", onPopup);
  const download = page.waitForEvent("download", { timeout: SETTLE_MS }).then(() => true).catch(() => false);
  try {
    await el.click({ timeout: 2500 });
  } catch (error) {
    context.off("page", onPopup);
    return { effect: false, error: String(error).split("\n")[0].slice(0, 160) };
  }
  await page.waitForTimeout(SETTLE_MS);
  context.off("page", onPopup);
  const after = await snapshot().catch(() => ({ url: "navigated" }));
  const changes = [];
  if (after.url !== before.url) changes.push("navigated");
  if (after.dialogs !== before.dialogs) changes.push(after.dialogs > before.dialogs ? "opened a sheet" : "closed a sheet");
  if (requests > requestsBefore) changes.push("made a request");
  if (after.theme !== before.theme) changes.push("changed theme");
  if (after.focus !== before.focus && /INPUT|TEXTAREA/.test(after.focus)) changes.push("focused a field");
  if (after.mutations > 2) changes.push(`changed the page (${after.mutations})`);
  if (popup) changes.push("opened a tab");
  if (await download) changes.push("downloaded");
  return { effect: changes.length > 0, changes, opened: after.dialogs > before.dialogs };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const results = [];
const record = (screen, label, outcome) => {
  results.push({ screen, label, ...outcome });
  const mark = outcome.covered ? "⛔ covered" : outcome.disabled ? "· disabled" : outcome.effect ? "✓" : "✗ NO EFFECT";
  console.log(`  ${mark}  ${label}${outcome.changes?.length ? ` — ${outcome.changes.join(", ")}` : ""}${outcome.covered ? ` — by ${outcome.covered}` : ""}${outcome.error ? ` — ${outcome.error}` : ""}`);
};

for (const screen of SCREENS) {
  console.log(`\n${screen.name} (${screen.path})`);
  await openScreen(screen.path);
  const list = await controls();

  for (const control of list) {
    if (control.disabled) {
      record(screen.name, control.label, { disabled: true, effect: false });
      continue;
    }
    await openScreen(screen.path);
    const el = await locate(control);
    if (!el) {
      record(screen.name, control.label, { effect: false, error: "could not find it again after reload" });
      continue;
    }
    const covered = await coveredBy(el).catch(() => null);
    if (covered) {
      record(screen.name, control.label, { covered, effect: false });
      continue;
    }
    const outcome = await tap(el);
    record(screen.name, control.label, outcome);

    // One level into any sheet the tap opened.
    if (outcome.opened) {
      const scope = '[role="dialog"]';
      const inner = await controls(scope);
      for (const child of inner) {
        if (NEVER_CONFIRM.test(child.label) && !/^Delete my account$|^Sign out on/.test(child.label)) {
          // Opening a confirmation is fine; pressing the final destructive
          // button is not. Leave these to the dedicated UI checks.
          continue;
        }
        if (child.disabled) {
          record(`${screen.name} › ${control.label}`, child.label, { disabled: true, effect: false });
          continue;
        }
        await openScreen(screen.path);
        const parent = await locate(control);
        if (!parent) continue;
        await parent.click({ timeout: 2500 }).catch(() => {});
        await page.waitForTimeout(900);
        const el2 = await locate(child, scope);
        if (!el2) {
          record(`${screen.name} › ${control.label}`, child.label, { effect: false, error: "not found in the reopened sheet" });
          continue;
        }
        const covered2 = await coveredBy(el2).catch(() => null);
        if (covered2) {
          record(`${screen.name} › ${control.label}`, child.label, { covered: covered2, effect: false });
          continue;
        }
        record(`${screen.name} › ${control.label}`, child.label, await tap(el2));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The "tapped too soon after closing a sheet" case
// ---------------------------------------------------------------------------

console.log("\nTapping straight after a sheet closes");
{
  await openScreen("/account");
  const opener = page.getByRole("button", { name: /Budgets/i }).first();
  let afterClose = { effect: false, error: "no budgets row to open" };
  if (await opener.count()) {
    await opener.click();
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Close" }).last().click();
    // Immediately - well inside the closing animation.
    await page.waitForTimeout(80);
    const target = page.getByRole("button", { name: /Your invite code|My code|Share your code|Payment/i }).first();
    const covered = await coveredBy(target).catch(() => null);
    afterClose = covered ? { covered, effect: false } : await tap(target);
  }
  record("Account", "a row tapped 80 ms after closing a sheet", afterClose);
}

await browser.close();

const dead = results.filter((r) => !r.effect && !r.disabled);
const disabled = results.filter((r) => r.disabled);
console.log(`\n${results.length} controls tapped · ${results.length - dead.length - disabled.length} worked · ${dead.length} did nothing or were covered · ${disabled.length} disabled`);
if (pageErrors.length) console.log(`page errors: ${[...new Set(pageErrors)].slice(0, 5).join(" | ")}`);
process.exit(dead.length === 0 ? 0 : 1);
