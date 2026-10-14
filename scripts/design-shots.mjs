/**
 * Screenshots of every main screen, seeded with realistic data, in both themes
 * at phone size. For design review: before/after comparisons.
 *
 *   node scripts/design-shots.mjs http://localhost:3000 out-dir
 *
 * Set CHROMIUM_PATH to drive an installed Chrome or Edge.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "design-shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: theme,
  });
  const page = await context.newPage();

  // Onboarding first, before an identity exists.
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, `${theme}-00-welcome.png`) });

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
    const me = (await call("/api/identity", "POST", { displayName: "Priya Shah", avatarColor: "violet" })).me;
    sessionStorage.removeItem("divvy-recovery-key");
    localStorage.removeItem("divvy-recovery-pending");
    const trip = (await call("/api/groups", "POST", { name: "Lisbon 2026", kind: "trip", emoji: "🏝️", currency: "EUR", placeholderNames: ["Ravi", "Sam", "Nadia"] })).group;
    const home = (await call("/api/groups", "POST", { name: "Flat 4B", kind: "home", emoji: "🏡", currency: "EUR", placeholderNames: ["Jules"] })).group;
    const td = (await call(`/api/groups/${trip.id}`)).group;
    const id = (name) => td.members.find((m) => m.displayName === name).id;
    const hd = (await call(`/api/groups/${home.id}`)).group;
    const jules = hd.members.find((m) => m.displayName === "Jules").id;
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
    const four = (amount, payer, description, categoryId, n) =>
      call("/api/expenses", "POST", {
        groupId: trip.id, description, categoryId, amount: String(amount), currency: "EUR", splitMode: "EQUAL", date: day(n),
        payers: [{ personId: payer, amount: String(amount) }],
        splits: [me.id, id("Ravi"), id("Sam"), id("Nadia")].map((p, i) => ({ personId: p, amount: String(Math.floor(amount / 4) + (i < amount % 4 ? 1 : 0)) })),
      });
    await four(48000, me.id, "Airbnb Alfama", "accommodation", 6);
    await four(12850, id("Ravi"), "Time Out Market", "dining", 5);
    await four(3200, me.id, "Tram 28", "transport", 4);
    await four(9600, id("Sam"), "Sintra day trip", "entertainment", 3);
    await four(6420, id("Nadia"), "Pastéis de Belém", "dining", 2);
    await four(2400, me.id, "Groceries", "groceries", 1);
    await call("/api/settlements", "POST", { groupId: trip.id, fromPersonId: id("Ravi"), toPersonId: me.id, amount: "10000", currency: "EUR" });
    await call("/api/expenses", "POST", {
      groupId: home.id, description: "Electricity", categoryId: "utilities", amount: "8400", currency: "EUR", splitMode: "EQUAL",
      payers: [{ personId: jules, amount: "8400" }], splits: [{ personId: me.id, amount: "4200" }, { personId: jules, amount: "4200" }],
    });
    return { tripId: trip.id };
  });

  const shots = [
    ["01-home", "/"],
    ["02-group", `/groups/${seed.tripId}`],
    ["04-friends", "/friends"],
    ["05-activity", "/activity"],
    ["06-account", "/account"],
  ];
  for (const [name, path] of shots) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, `${theme}-${name}.png`) });
  }

  // Balances tab and the composer, from the group screen.
  await page.goto(`${BASE}/groups/${seed.tripId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.getByRole("tab", { name: "Balances" }).click().catch(() => {});
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, `${theme}-03-balances.png`) });
  await page.getByRole("tab", { name: "Insights" }).click().catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, `${theme}-03b-insights.png`) });
  await page.getByRole("button", { name: /Add an expense/ }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await page.getByLabel("Amount").first().fill("64.50").catch(() => {});
  await page.getByPlaceholder(/What was it for/).first().fill("Dinner at Cervejaria").catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, `${theme}-07-composer.png`) });

  await context.close();
}

await browser.close();
console.log(`screenshots in ${OUT}`);
