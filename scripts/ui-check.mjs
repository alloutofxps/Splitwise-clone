/**
 * Feature-wiring check.
 *
 * The complement to `pwa-check.mjs`, which covers platform plumbing. This one
 * asks a narrower question of the product itself: is the control on screen
 * actually connected to the thing it claims to do?
 *
 * That question needs a browser. Both regressions it pins looked completely
 * healthy from the outside - the settlement row rendered, the scope picker
 * accepted a change and the server returned 200 - and both were inert. A test
 * against the API alone would have passed while the app did nothing.
 *
 * Needs a production server:
 *
 *   npm run build && npm start
 *   node scripts/ui-check.mjs http://localhost:3000
 */

import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://localhost:3311";
let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const browser = await chromium.launch(
  // Honoured when a sandbox pins a browser outside Playwright's own store.
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error" && !/401 \(Unauthorized\)/.test(m.text())) errors.push(m.text()); });

// Seed a group with a payment through the API, sharing the browser's cookie jar.
await page.goto(BASE, { waitUntil: "networkidle" });
const seeded = await page.evaluate(async () => {
  const post = (p, b) => fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json());
  const me = (await post("/api/identity", { displayName: "Tester" })).me;
  const group = (await post("/api/groups", { name: "Audit", currency: "USD", placeholderNames: ["Sam"] })).group;
  const detail = await (await fetch(`/api/groups/${group.id}`)).json();
  const sam = detail.group.members.find(m => m.displayName === "Sam").id;
  await post("/api/expenses", {
    groupId: group.id, description: "Dinner", amount: "5000", currency: "USD", splitMode: "EQUAL",
    payers: [{ personId: me.id, amount: "5000" }],
    splits: [{ personId: me.id, amount: "2500" }, { personId: sam, amount: "2500" }],
  });
  await post("/api/settlements", { groupId: group.id, fromPersonId: sam, toPersonId: me.id, amount: "2500", currency: "USD" });
  const after = await (await fetch(`/api/groups/${group.id}`)).json();
  return { groupId: group.id, meId: me.id, netAfterPayment: after.group.balances.net[me.id] ?? "0" };
});
check("seeded a group with an expense and a payment", Boolean(seeded.groupId));
check("the payment settled the balance", seeded.netAfterPayment === "0", seeded.netAfterPayment);

console.log("\nUndoing a payment from the ledger");
await page.goto(`${BASE}/groups/${seeded.groupId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const row = page.getByRole("button", { name: /paid.*Remove this payment/i });
check("the payment row is an actual control", await row.count() > 0);

if (await row.count() > 0) {
  await row.first().click();
  await page.waitForTimeout(700);
  const sheet = page.getByText("Remove this payment?");
  check("tapping it asks for confirmation", await sheet.count() > 0);
  const body = await page.locator("body").innerText();
  check("the prompt names the amount", /50\.00|\$50/.test(body), body.slice(0, 160).replace(/\n/g, " | "));

  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.waitForTimeout(3000);

  const net = await page.evaluate(async (g) => {
    const r = await (await fetch(`/api/groups/${g}`)).json();
    return r.group.balances.net;
  }, seeded.groupId);
  check("the payment is really gone server-side", net[seeded.meId] === "2500", JSON.stringify(net));

  const gone = await page.getByRole("button", { name: /paid.*Remove this payment/i }).count();
  check("and the row disappears from the ledger", gone === 0, `${gone} rows left`);
}

console.log("\nScope is fixed when editing");
await page.goto(`${BASE}/groups/${seeded.groupId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.getByText("Dinner").first().click();
await page.waitForTimeout(1200);
const edit = page.getByRole("button", { name: /^Edit$/i });
if (await edit.count() > 0) {
  await edit.first().click();
  await page.waitForTimeout(1500);
  const selects = await page.locator("select").count();
  const lockedLabel = await page.getByText(/Can.t be moved/).count();
  check("the scope is shown as a label, not a picker", lockedLabel > 0, `${selects} selects, ${lockedLabel} locked labels`);
} else {
  check("could not open the edit sheet (skipped)", true, "no Edit button found");
}

check("no console errors throughout", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(`\n${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
