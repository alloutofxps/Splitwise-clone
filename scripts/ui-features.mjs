/**
 * The Splitwise-parity features, driven through the real screens:
 * a group's usual split, paying in another currency, importing a Splitwise
 * export and reading a receipt photo on the phone.
 *
 *   node scripts/ui-features.mjs http://localhost:3000
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !/401 \(Unauthorized\)/.test(m.text())) errors.push(m.text());
});

await page.goto(BASE, { waitUntil: "networkidle" });
const seed = await page.evaluate(async () => {
  const post = (p, b, method = "POST") =>
    fetch(p, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
  const me = (await post("/api/identity", { displayName: "Priya", defaultCurrency: "EUR" })).me;
  sessionStorage.removeItem("divvy-recovery-key");
  localStorage.removeItem("divvy-recovery-pending");
  const group = (await post("/api/groups", { name: "Flat", currency: "EUR", placeholderNames: ["Jules"] })).group;
  const detail = await (await fetch(`/api/groups/${group.id}`)).json();
  const jules = detail.group.members.find((m) => m.displayName === "Jules").id;
  await post("/api/expenses", {
    groupId: group.id, description: "Electricity", amount: "4000", currency: "EUR", splitMode: "EQUAL",
    payers: [{ personId: jules, amount: "4000" }],
    splits: [{ personId: me.id, amount: "2000" }, { personId: jules, amount: "2000" }],
  });
  return { groupId: group.id, meId: me.id, jules };
});

const sheet = () => page.locator('[role="dialog"]').last();
const groupDetail = () =>
  page.evaluate(async (id) => (await (await fetch(`/api/groups/${id}`)).json()).group, seed.groupId);

// --- Usual split ------------------------------------------------------------
console.log("\nA group's usual split");
await page.goto(`${BASE}/groups/${seed.groupId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Group settings" }).click();
await page.waitForTimeout(700);
await page.getByRole("button", { name: /Usual split/ }).click();
await page.waitForTimeout(700);
await sheet().getByRole("tab", { name: "By percent" }).click();
await page.getByLabel("Percent for you").fill("60");
await page.getByLabel("Percent for Jules").fill("40");
if (process.env.SHOTS) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${process.env.SHOTS}/feature-1-usual-split.png` });
}
check("the screen adds it up as you type", (await sheet().innerText()).includes("Adds up to 100%"));
await sheet().getByRole("button", { name: "Save" }).click();
await page.waitForTimeout(1200);
const afterSave = await groupDetail();
check("saving stores 60/40", afterSave.defaultSplit?.mode === "PERCENT", JSON.stringify(afterSave.defaultSplit));
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
await page.getByRole("button", { name: "Add an expense" }).first().click();
await page.waitForTimeout(900);
const composerText = await sheet().innerText();
check("a new expense starts with the usual split", /By percent|Percent/i.test(composerText), composerText.slice(0, 200).replace(/\n/g, " | "));
check("and says why", composerText.includes("usual split"));
if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/feature-1b-composer.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(600);

// --- Paying in another currency ---------------------------------------------
console.log("\nPaying a euro debt in dollars");
await page.goto(`${BASE}/groups/${seed.groupId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Settle up" }).first().click();
await page.waitForTimeout(900);
await page.getByRole("button", { name: "Currency: EUR" }).click();
await page.waitForTimeout(700);
await page.getByPlaceholder("Search currencies").fill("USD");
await page.waitForTimeout(400);
await page.getByRole("button", { name: /USD/ }).first().click();
await page.waitForTimeout(2500);
const settleText = await sheet().innerText();
if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/feature-2-pay-in-dollars.png` });
check("the amount switches to dollars", /\$|USD/.test(settleText), settleText.slice(0, 220).replace(/\n/g, " | "));
check("and shows what it comes to in euros", /≈\s*€20\.00/.test(settleText), settleText.match(/≈[^|\n]*/)?.[0] ?? "");
await sheet().getByRole("button", { name: "Save payment" }).click().catch(() => {});
await page.getByRole("button", { name: "Save payment" }).click().catch(() => {});
await page.waitForTimeout(2000);
const afterPay = await groupDetail();
check("paying it clears the debt exactly", (afterPay.balances.net[seed.meId] ?? "0") === "0", JSON.stringify(afterPay.balances.net));

// --- Importing from Splitwise -----------------------------------------------
console.log("\nImporting from Splitwise");
const csv = [
  "Date,Description,Category,Cost,Currency,Priya,Ravi,Sam",
  "2026-05-01,Airbnb,Hotel,300.00,EUR,200.00,-100.00,-100.00",
  "2026-05-02,Lunch,Dining out,45.00,EUR,-15.00,30.00,-15.00",
  "2026-05-03,Ravi paid Priya,Payment,50.00,EUR,-50.00,50.00,0.00",
  "",
  "2026-05-31,Total balance, , ,EUR,135.00,-20.00,-115.00",
].join("\n");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: /^(New group|New|Start a group)$/ }).first().click();
await page.waitForTimeout(800);
await page.getByRole("button", { name: /Have this group in Splitwise/ }).click();
await page.waitForTimeout(800);
await sheet().locator('input[type="file"]').setInputFiles({ name: "lisbon-trip_2026-06-01_export.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
await page.waitForTimeout(900);
const preview = await sheet().innerText();
if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/feature-3-import.png` });
check("the preview counts what's in the file", /2\s*expenses and\s*1\s*payment/.test(preview.replace(/\n/g, " ")), preview.slice(0, 260).replace(/\n/g, " | "));
check("it names the group after the file", (await sheet().locator("input:not([type=file])").first().inputValue()) === "Lisbon trip");
check("it guesses which name is you", (await sheet().getByRole("radio", { name: /Priya/ }).getAttribute("aria-checked")) === "true");
await sheet().getByRole("button", { name: /Import 3 items/ }).click().catch(() => {});
await page.getByRole("button", { name: /Import 3 items/ }).click().catch(() => {});
await page.waitForURL(/\/groups\//, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
check("importing opens the new group", /\/groups\//.test(page.url()), page.url());
const importedText = await page.locator("main").innerText();
check("with Priya owed €135, as in Splitwise", importedText.includes("135.00"), importedText.slice(0, 200).replace(/\n/g, " | "));

// --- Reading a receipt --------------------------------------------------------
console.log("\nReading a receipt photo");
const receiptPage = await ctx.newPage();
await receiptPage.setViewportSize({ width: 420, height: 640 });
await receiptPage.setContent(`<body style="margin:0;background:#fff">
  <div id="r" style="width:380px;padding:24px;font:22px/1.5 'Courier New',monospace;color:#111;background:#fff">
  <div style="text-align:center;font-weight:bold;font-size:26px">CAFE LISBOA</div>
  <div style="text-align:center">Rua Augusta 120</div><br>
  <div>Pastel de nata&nbsp;&nbsp;&nbsp;&nbsp;3.00</div>
  <div>Galao&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;1.80</div>
  <div>Tosta mista&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;4.50</div>
  <div>Agua&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;1.20</div><br>
  <div style="font-weight:bold">TOTAL&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;10.50</div>
  </div></body>`);
const photo = await receiptPage.locator("#r").screenshot({ type: "jpeg", quality: 92 });
await receiptPage.close();

await page.goto(`${BASE}/groups/${seed.groupId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Add an expense" }).first().click();
await page.waitForTimeout(900);
await sheet().getByRole("button", { name: /^Receipt/ }).click();
await page.waitForTimeout(700);
await sheet().locator('input[type="file"]:not([capture])').setInputFiles({ name: "receipt.jpg", mimeType: "image/jpeg", buffer: photo });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Read receipt" }).first().click();
const started = Date.now();
await page.getByText("Read the receipt").first().waitFor({ timeout: 90000 }).catch(() => {});
console.log(`    (reading took ${((Date.now() - started) / 1000).toFixed(1)}s, including the first download)`);
await page.waitForTimeout(800);
const amount = await page.getByLabel("Amount").first().inputValue().catch(() => "");
check("reading the photo fills in the total", amount === "10.50", `amount field: "${amount}"`);
const description = await page.getByPlaceholder("What was it for?").inputValue().catch(() => "");
check("and the shop's name", /cafe lisboa/i.test(description), `description: "${description}"`);
if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/feature-4-receipt.png` });
check("and offers to split it by item", (await page.getByRole("button", { name: "Split by item" }).count()) > 0);
if ((await page.getByRole("button", { name: "Split by item" }).count()) > 0) {
  await page.getByRole("button", { name: "Split by item" }).click();
  await page.waitForTimeout(900);
  // Item names sit in text fields, which innerText doesn't include.
  const names = await sheet()
    .locator("input")
    .evaluateAll((els) => els.map((el) => el.value).filter((v) => /[a-z]{3}/i.test(v)));
  check("which fills in the item lines", names.some((n) => /pastel|tosta|galao|agua/i.test(n)), JSON.stringify(names));
}

// --- Panels on top of panels -----------------------------------------------
console.log("\nEscape and the settle-up amount");
await page.evaluate(async (s) => {
  await fetch("/api/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      groupId: s.groupId, description: "Groceries", amount: "6000", currency: "EUR", splitMode: "EQUAL",
      payers: [{ personId: s.jules, amount: "6000" }],
      splits: [{ personId: s.meId, amount: "3000" }, { personId: s.jules, amount: "3000" }],
    }),
  });
}, seed);
await page.goto(`${BASE}/groups/${seed.groupId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Settle up" }).first().click();
await page.waitForTimeout(900);
const selected = await page.evaluate(() => {
  const el = document.activeElement;
  return el instanceof HTMLInputElement ? { value: el.value, length: (el.selectionEnd ?? 0) - (el.selectionStart ?? 0) } : null;
});
check("the amount opens ready to type, without a highlight", selected !== null && selected.value !== "" && selected.length === 0, JSON.stringify(selected));
await page.keyboard.type("7");
const replaced = await page.evaluate(() => (document.activeElement instanceof HTMLInputElement ? document.activeElement.value : null));
check("and the first key typed replaces it", replaced === "7", String(replaced));
await page.getByRole("button", { name: "Currency: EUR" }).click();
await page.waitForTimeout(700);
const pickerText = await sheet().innerText();
check("the currency list has no flag letters", !/[\u{1F1E6}-\u{1F1FF}]/u.test(pickerText) && pickerText.includes("€"), pickerText.slice(0, 120).replace(/\n/g, " | "));
const openBefore = await page.locator('[role="dialog"]').count();
await page.keyboard.press("Escape");
await page.waitForTimeout(600);
const openAfter = await page.locator('[role="dialog"]').count();
check("Escape closes only the panel on top", openBefore === 2 && openAfter === 1, `${openBefore} then ${openAfter}`);
await page.keyboard.press("Escape");
await page.waitForTimeout(600);
check("and the next Escape closes the one below", (await page.locator('[role="dialog"]').count()) === 0);

// --- Undo, the row menu, and the invite code ---------------------------------
console.log("\nUndo and the row menu");
await page.goto(`${BASE}/groups/${seed.groupId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Add an expense" }).first().click();
await page.waitForTimeout(900);
await page.getByPlaceholder("What was it for?").fill("Undo me");
await page.getByLabel("Amount").first().fill("12");
await page.getByRole("button", { name: "Add expense" }).last().click();
// Waited for: the toast rises once the panel has finished leaving.
const undo = page.getByRole("button", { name: "Undo", exact: true });
const offered = await undo
  .first()
  .waitFor({ timeout: 6000 })
  .then(() => true)
  .catch(() => false);
check("adding an expense offers Undo", offered);
await undo.first().click().catch(() => {});
await page.waitForTimeout(2000);
const afterUndo = await page.evaluate(async (id) => {
  const ledger = await (await fetch(`/api/groups/${id}/expenses`)).json();
  return (ledger.items ?? []).some((item) => item.expense?.description === "Undo me");
}, seed.groupId);
check("and Undo takes it back out", afterUndo === false);

// Right-click is the desktop's long-press.
const row = page.getByRole("button", { name: /Groceries/ }).first();
await row.click({ button: "right" });
await page.waitForTimeout(700);
const menuText = await sheet().innerText().catch(() => "");
check("a row's menu offers Edit, Duplicate and Delete", /Edit/.test(menuText) && /Duplicate/.test(menuText) && /Delete/.test(menuText), menuText.slice(0, 80).replace(/\n/g, " | "));
await sheet().getByRole("button", { name: "Duplicate" }).click();
await page.waitForTimeout(1000);
const copyText = await page.getByPlaceholder("What was it for?").inputValue().catch(() => "");
check("Duplicate opens a new expense filled in from it", copyText === "Groceries", copyText);
await page.keyboard.press("Escape");
await page.waitForTimeout(600);

console.log("\nInviting in person");
await page.getByRole("button", { name: /^(Invite|Invite people)$/ }).first().click();
await page.waitForTimeout(1200);
const qr = await sheet().locator('[role="img"] svg').count();
check("the invite shows a QR code", qr > 0);
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

console.log("\nProtecting a new account");
{
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await fresh.newPage();
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Get started" }).click();
  await p.locator('input[placeholder="Priya"]').fill("Later Person");
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByText("Protect your account").waitFor({ timeout: 15000 });
  check("sign-up asks how to protect the account", true);
  check("with a recovery key as the other way", (await p.getByRole("button", { name: "Save a recovery key instead" }).count()) > 0);
  await p.getByRole("button", { name: "Not now" }).click();
  await p.waitForTimeout(2500);
  const home = await p.locator("body").innerText();
  check("Not now still gets you in", /Nothing owed yet|Get started/.test(home), home.slice(0, 100).replace(/\n/g, " | "));
  check("and Home asks you to back up later", /Back up your account/.test(home));
  const stash = await p.evaluate(() => sessionStorage.getItem("divvy-recovery-key"));
  check("the unseen key isn't kept on the phone", stash === null, String(stash));
  await fresh.close();
}

check("no errors in the browser console", errors.length === 0, errors.slice(0, 3).join(" / "));
console.log(`\n${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed ? 1 : 0);
