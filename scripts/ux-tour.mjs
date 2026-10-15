// UX tour: photographs every screen and state, phone and desktop, light and dark.
// Usage: CHROMIUM_PATH=... node scripts/ux-tour.mjs http://localhost:3000 ./ux-shots
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = process.argv[2];
const OUT = process.argv[3];
mkdirSync(OUT, { recursive: true });

const ip = (n) => `198.18.${Math.floor(n / 250)}.${n % 250}`;
let ipn = Math.floor(Math.random() * 40000);
async function makeFriend(name) {
  const r = await fetch(`${BASE}/api/identity`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip(ipn++) }, body: JSON.stringify({ displayName: name }) });
  const cookie = /divvy_id=([^;]*)/.exec(r.headers.get("set-cookie") ?? "")?.[1];
  return { ...(await r.json()).me, cookie };
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const log = [];

async function tour(theme, viewport, tag) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: viewport.width < 600, hasTouch: viewport.width < 600, colorScheme: theme });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/401/.test(m.text())) errors.push(m.text()); });
  const shot = async (name, full = false) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${tag}-${name}.png`, fullPage: full });
  };
  const esc = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(500); };

  // Onboarding, step by step
  await page.goto(BASE, { waitUntil: "networkidle" });
  await shot("00-welcome");
  if (tag.startsWith("phone-light")) {
    await page.getByRole("button", { name: "Get started" }).click();
    await shot("01-name");
    await page.locator('input[placeholder="Priya"]').fill("Priya Shah");
    await shot("01b-name-filled");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("Save your recovery key").waitFor({ timeout: 15000 }).catch(() => {});
    await shot("02-recovery-key");
    await page.locator("input[type=checkbox]").check();
    await page.getByRole("button", { name: "Start using Divvy" }).click();
    await page.waitForTimeout(2500);
    await shot("03-home-first-run");
  } else {
    await page.evaluate(async () => {
      await fetch("/api/identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Priya Shah", defaultCurrency: "EUR" }) });
      localStorage.removeItem("divvy-recovery-pending");
    });
  }

  // Rich data: two real friends, three groups, many expense kinds.
  const ravi = await makeFriend("Ravi Kumar");
  const sam = await makeFriend("Sam Lee");
  const seed = await page.evaluate(async ({ ravi, sam }) => {
    const call = async (p, m = "GET", b) => { const r = await fetch(p, { method: m, headers: b ? { "Content-Type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); return t ? JSON.parse(t) : null; };
    const me = (await call("/api/dashboard")).me;
    await call(`/api/invite/${ravi.inviteCode}/join`, "POST", {});
    await call(`/api/invite/${sam.inviteCode}/join`, "POST", {});
    const trip = (await call("/api/groups", "POST", { name: "Lisbon 2026", kind: "trip", emoji: "🏝️", currency: "EUR", memberIds: [ravi.id, sam.id], placeholderNames: ["Nadia"] })).group;
    const td = (await call(`/api/groups/${trip.id}`)).group; const id = (n) => td.members.find((m) => m.displayName.startsWith(n)).id;
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
    const four = [me.id, id("Ravi"), id("Sam"), id("Nadia")];
    const eq = (t, ids) => ids.map((p, i) => ({ personId: p, amount: String(Math.floor(t / ids.length) + (i < t % ids.length ? 1 : 0)) }));
    const add = (b) => call("/api/expenses", "POST", { currency: "EUR", splitMode: "EQUAL", ...b });
    await add({ groupId: trip.id, description: "Airbnb Alfama", categoryId: "accommodation", amount: "48000", date: day(9), payers: [{ personId: me.id, amount: "48000" }], splits: eq(48000, four) });
    await add({ groupId: trip.id, description: "Time Out Market", categoryId: "dining", amount: "12850", date: day(8), payers: [{ personId: id("Ravi"), amount: "12850" }], splits: eq(12850, four) });
    await add({ groupId: trip.id, description: "Tram 28", categoryId: "transport", amount: "3200", date: day(7), payers: [{ personId: me.id, amount: "3200" }], splits: eq(3200, four) });
    await add({ groupId: trip.id, description: "Surf lesson", categoryId: "activities", amount: "18000", date: day(6), splitMode: "SHARES", payers: [{ personId: id("Sam"), amount: "18000" }], splits: [{ personId: me.id, amount: "6000", weight: 1 }, { personId: id("Sam"), amount: "12000", weight: 2 }] });
    await add({ groupId: trip.id, description: "Car hire", categoryId: "carrental", amount: "11000", currency: "USD", exchangeRate: "0.9200", date: day(5), payers: [{ personId: id("Nadia"), amount: "11000" }], splits: eq(11000, four) });
    await add({ groupId: trip.id, description: "Dinner at Cervejaria", categoryId: "dining", amount: "9600", date: day(2), notes: "Ravi had the lobster", splitMode: "ITEMIZED", payers: [{ personId: me.id, amount: "9600" }],
      splits: [{ personId: me.id, amount: "2400", included: true }, { personId: id("Ravi"), amount: "4800", included: true }, { personId: id("Sam"), amount: "2400", included: true }, { personId: id("Nadia"), amount: "0", included: false }],
      items: [{ name: "Lobster", amount: "3600", participantIds: [id("Ravi")] }, { name: "Shared plates", amount: "3600", participantIds: [me.id, id("Ravi"), id("Sam")] }, { name: "Wine", amount: "2400", participantIds: [me.id, id("Ravi"), id("Sam")] }] });
    await add({ groupId: trip.id, description: "Pastéis de Belém", categoryId: "coffee", amount: "1840", date: day(1), payers: [{ personId: id("Sam"), amount: "1840" }], splits: eq(1840, four) });
    await call("/api/settlements", "POST", { groupId: trip.id, fromPersonId: id("Ravi"), toPersonId: me.id, amount: "5000", currency: "EUR", method: "Bank transfer" });
    const flat = (await call("/api/groups", "POST", { name: "Flat 4B", kind: "home", emoji: "🏡", currency: "EUR", placeholderNames: ["Jules"] })).group;
    const fd = (await call(`/api/groups/${flat.id}`)).group; const jules = fd.members.find((m) => m.displayName === "Jules").id;
    await add({ groupId: flat.id, description: "Electricity", categoryId: "utilities", amount: "8400", date: day(10), payers: [{ personId: jules, amount: "8400" }], splits: eq(8400, [me.id, jules]) });
    await add({ groupId: flat.id, description: "Big shop", categoryId: "groceries", amount: "6730", date: day(3), payers: [{ personId: me.id, amount: "6730" }], splits: eq(6730, [me.id, jules]) });
    const tokyo = (await call("/api/groups", "POST", { name: "Tokyo", kind: "trip", emoji: "🗼", currency: "JPY", memberIds: [sam.id] })).group;
    await add({ groupId: tokyo.id, description: "Ramen", categoryId: "dining", amount: "3400", currency: "JPY", date: day(20), payers: [{ personId: sam.id, amount: "3400" }], splits: eq(3400, [me.id, sam.id]) });
    await add({ friendId: ravi.id, description: "Concert tickets", categoryId: "entertainment", amount: "9000", date: day(4), payers: [{ personId: me.id, amount: "9000" }], splits: eq(9000, [me.id, ravi.id]) });
    await call("/api/budgets", "PUT", { amount: "60000", currency: "EUR", period: "MONTHLY" });
    return { trip: trip.id, flat: flat.id, me: me.id };
  }, { ravi, sam });

  // Ravi adds something so there's unread activity.
  await fetch(`${BASE}/api/expenses`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `divvy_id=${ravi.cookie}`, "X-Forwarded-For": ip(ipn++) }, body: JSON.stringify({ groupId: seed.trip, description: "Taxi to the airport", categoryId: "taxi", amount: "4200", currency: "EUR", splitMode: "EQUAL", payers: [{ personId: ravi.id, amount: "4200" }], splits: [{ personId: seed.me, amount: "2100" }, { personId: ravi.id, amount: "2100" }] }) }).catch(() => {});

  const go = async (path) => { await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1600); };
  await go("/");
  await shot("10-home");
  await shot("10b-home-full", true);
  await go(`/groups/${seed.trip}`);
  await shot("11-group");
  await shot("11b-group-full", true);
  await page.getByRole("tab", { name: "Balances" }).click(); await shot("12-balances");
  await page.getByRole("tab", { name: "Insights" }).click(); await shot("13-insights"); await shot("13b-insights-full", true);
  await page.getByRole("tab", { name: "Expenses" }).click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(500);
  await page.getByRole("button", { name: /Dinner at Cervejaria/ }).first().click(); await shot("14-expense-detail"); await shot("14b-expense-detail-full", true); await esc();
  await page.getByRole("button", { name: "Settle up" }).first().click(); await shot("15-settle-up");
  await page.locator('[role="dialog"] button').filter({ hasText: /pays you|Pay / }).first().click().catch(() => {}); await shot("15b-settle-amount"); await esc();
  await page.getByRole("button", { name: /^(Invite|Invite people)$/ }).click(); await shot("16-invite"); await esc();
  await page.getByRole("button", { name: "Group settings" }).click(); await shot("17-settings"); await shot("17b-settings-full", true); await esc();

  // Composer journey, reopening for each panel
  const openComposer = async () => {
    await go(`/groups/${seed.trip}`);
    await page.getByRole("button", { name: /Add an expense|Add expense/ }).first().click();
    await page.waitForTimeout(900);
  };
  const tryStep = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      log.push({ tag, step: name, error: String(e).slice(0, 160) });
    }
  };
  await tryStep("composer", async () => {
    await openComposer(); await shot("20-composer-empty");
    await page.getByLabel("Amount").first().fill("64.50"); await page.getByPlaceholder("What was it for?").fill("Dinner"); await shot("21-composer-filled");
  });
  await tryStep("split", async () => {
    await page.locator('[role="dialog"] button').filter({ hasText: /^Split/i }).first().click(); await shot("22-split-equal");
    for (const mode of ["Exactly", "Percent", "Shares", "Extras", "By item"]) {
      await page.getByRole("tab", { name: mode }).click({ timeout: 3000 }).catch(() => {}); await shot(`23-split-${mode.replace(" ", "")}`);
    }
  });
  await tryStep("paid-by", async () => { await openComposer(); await page.locator('[role="dialog"] button').filter({ hasText: /Paid by/i }).first().click({ timeout: 5000 }); await shot("24-paid-by"); });
  await tryStep("category", async () => { await openComposer(); await page.getByRole("button", { name: /^Category/ }).first().click({ timeout: 5000 }); await shot("25-category"); });
  await tryStep("receipt", async () => { await openComposer(); await page.getByRole("button", { name: /^Receipt/ }).first().click({ timeout: 5000 }); await shot("26-receipt"); });
  await tryStep("date", async () => { await openComposer(); await page.getByRole("button", { name: /^Note/ }).first().click({ timeout: 5000 }); await shot("27-note"); });

  await go("/friends"); await shot("30-friends");
  await page.getByRole("link", { name: /Ravi/ }).first().click().catch(() => {}); await page.waitForTimeout(1500); await shot("31-friend-detail"); await shot("31b-friend-full", true);
  await go("/activity"); await shot("40-activity"); await shot("40b-activity-full", true);
  await go("/search"); await shot("41-search-empty");
  await page.getByRole("searchbox").or(page.locator("input")).first().fill("dinner"); await page.waitForTimeout(1200); await shot("42-search-results");
  await go("/account"); await shot("50-account"); await shot("50b-account-full", true);
  await page.getByRole("button", { name: /How people can pay you/ }).click(); await shot("51-payment-methods"); await esc();
  await page.getByRole("button", { name: /Budgets/ }).click(); await shot("52-budgets"); await esc();
  await page.getByRole("button", { name: /Your devices/ }).click(); await shot("53-devices"); await esc();
  await page.getByRole("button", { name: /Default currency/ }).click(); await shot("54-currency"); await esc();
  await go("/"); await page.getByRole("button", { name: /^(New group|New|Start a group)$/ }).first().click(); await shot("60-new-group"); await esc();
  await page.getByRole("button", { name: /^Join$/ }).first().click(); await shot("61-join"); await esc();
  await go("/does-not-exist"); await shot("70-not-found");
  await ctx.setOffline(true); await go("/").catch(() => {}); await page.waitForTimeout(1500); await shot("71-offline"); await ctx.setOffline(false);
  log.push({ tag, errors });
  await ctx.close();
}

await tour("light", { width: 390, height: 844 }, "phone-light");
await tour("dark", { width: 390, height: 844 }, "phone-dark");
await tour("light", { width: 1440, height: 900 }, "desktop-light");
await browser.close();
console.log(JSON.stringify(log, null, 1));
