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
await sheet().getByRole("radio", { name: "By percent" }).click();
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

// Someone copies the whole invite, or just the link, into Join with a code.
console.log("\nPasting an invite into Join with a code");
{
  await page.evaluate(() => {
    navigator.share = (shared) => {
      window.__shared = shared.text;
      return Promise.resolve();
    };
  });
  await page.getByRole("button", { name: "Share invite" }).click();
  const message = await page.evaluate(() => window.__shared);
  const invite = /\/join\/(\S+)/.exec(message)?.[1];
  check("the invite tells people who already have Divvy what to do", /Already have Divvy\? Open it, tap Join and enter this code\./.test(message), message);
  check("with the link first and the code last", message.indexOf("/join/") < message.lastIndexOf(invite) && message.trim().endsWith(invite), message);

  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await other.grantPermissions(["clipboard-read", "clipboard-write"]);
  const p = await other.newPage();
  p.on("pageerror", (error) => errors.push(error.message));
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.evaluate(() => fetch("/api/identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Pasting Person", defaultCurrency: "EUR" }) }));
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Join with a code" }).click({ timeout: 8000 });
  const box = p.getByPlaceholder("mango-tiger-42");
  const joinButton = p.getByRole("button", { name: /^Join (?!with a code)/ });

  await box.fill(message);
  check("the whole message comes down to the code", (await box.inputValue()) === invite, await box.inputValue());
  await joinButton.waitFor({ timeout: 5000 }).catch(() => {});
  check("and finds the group", await joinButton.isVisible());
  await box.fill(`${BASE}/join/${invite}`);
  check("so does just the link", (await box.inputValue()) === invite, await box.inputValue());
  await box.fill("mango-tiger-");
  check("and typing a code is left alone", (await box.inputValue()) === "mango-tiger-");

  const asked = [];
  p.on("request", (request) => {
    if (request.url().includes("/api/invite/")) asked.push(request.url());
  });
  await box.fill("");
  await p.evaluate(() => navigator.clipboard.writeText("my secret password"));
  await p.getByRole("button", { name: "Paste", exact: true }).click();
  await p.getByText("No invite code copied").waitFor({ timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(600);
  check("Paste says when what's copied isn't an invite", await p.getByText("No invite code copied").first().isVisible());
  check("and sends none of it anywhere", asked.length === 0 && (await box.inputValue()) === "", asked.join(" "));

  await p.evaluate((text) => navigator.clipboard.writeText(text), message);
  await p.getByRole("button", { name: "Paste", exact: true }).click();
  await joinButton.waitFor({ timeout: 5000 }).catch(() => {});
  check("Paste takes the code from a whole invite", (await box.inputValue()) === invite, await box.inputValue());
  await joinButton.click();
  await p.waitForURL(/\/groups\//, { timeout: 10000 }).catch(() => {});
  check("and joins", /\/groups\//.test(p.url()), p.url());
  await other.close();
}
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

console.log("\nProtecting a new account");
{
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await fresh.newPage();
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Get started" }).click();
  await p.getByLabel("Your name").fill("Later Person");
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

// Joining from an invite link is how most people arrive. Their account needs a
// way back in as much as anyone's: it used to get none, and no warning.
console.log("\nJoining from an invite link");
{
  const code = await page.evaluate(
    async (id) => (await (await fetch(`/api/groups/${id}`)).json()).group.inviteCode,
    seed.groupId,
  );
  const heading = (p, name) => p.getByRole("heading", { name });
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await fresh.newPage();
  p.on("pageerror", (error) => errors.push(error.message));
  await p.goto(`${BASE}/join/${code}`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: /new to Divvy/ }).click();
  await p.getByPlaceholder("Priya").fill("Noor Invite");
  await p.getByRole("button", { name: /^Join / }).click();
  await heading(p, "Protect your account").waitFor({ timeout: 15000 }).catch(() => {});
  check("you're asked how to get back in", await heading(p, "Protect your account").isVisible());
  check("in the group you joined", /\/groups\//.test(p.url()), p.url());
  await p.getByRole("button", { name: "Save a recovery key instead" }).click();
  await heading(p, "Save your recovery key").waitFor({ timeout: 5000 }).catch(() => {});
  check("the key is there to save", await heading(p, "Save your recovery key").isVisible());
  await p.reload({ waitUntil: "networkidle" });
  await heading(p, "Save your recovery key").waitFor({ timeout: 8000 }).catch(() => {});
  check("a reload comes back to the key", await heading(p, "Save your recovery key").isVisible());
  await p.locator("input[type=checkbox]").check();
  await p.getByRole("button", { name: "Start using Divvy" }).click();
  await p.getByRole("tab", { name: "Expenses" }).waitFor({ timeout: 8000 }).catch(() => {});
  check("saving it lands in the group", /\/groups\//.test(p.url()) && (await p.getByRole("tab", { name: "Expenses" }).isVisible()), p.url());
  await fresh.close();

  const later = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const q = await later.newPage();
  q.on("pageerror", (error) => errors.push(error.message));
  await q.goto(`${BASE}/join/${code}`, { waitUntil: "networkidle" });
  await q.getByRole("button", { name: /new to Divvy/ }).click();
  await q.getByPlaceholder("Priya").fill("Leo Invite");
  await q.getByRole("button", { name: /^Join / }).click();
  await q.getByRole("button", { name: "Not now" }).click({ timeout: 15000 });
  await q.waitForTimeout(2000);
  const group = await q.locator("body").innerText();
  check("Not now shows the group", /Expenses/.test(group) && !/Protect your account/.test(group), group.slice(0, 100).replace(/\n/g, " "));
  await q.goto(BASE, { waitUntil: "networkidle" });
  await q.waitForTimeout(1500);
  check("and Home asks you to back up later", /Back up your account/.test(await q.locator("body").innerText()));
  check("the unseen key isn't kept", (await q.evaluate(() => sessionStorage.getItem("divvy-recovery-key"))) === null);
  await later.close();

  // Making a passkey on the screen after joining, and using it from an invite
  // to sign back in. Chromium's pretend fingerprint reader stands in for a phone.
  const withReader = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const r = await withReader.newPage();
  r.on("pageerror", (error) => errors.push(error.message));
  const cdp = await withReader.newCDPSession(r);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await r.goto(`${BASE}/join/${code}`, { waitUntil: "networkidle" });
  await r.getByRole("button", { name: /new to Divvy/ }).click();
  await r.getByPlaceholder("Priya").fill("Pia Passkey");
  await r.getByRole("button", { name: /^Join / }).click();
  await r.getByRole("button", { name: "Use Face ID or fingerprint" }).click({ timeout: 15000 });
  await r.getByRole("tab", { name: "Expenses" }).waitFor({ timeout: 10000 }).catch(() => {});
  check("a passkey can be made straight after joining", await r.getByRole("tab", { name: "Expenses" }).isVisible());
  const pia = await r.evaluate(async () => (await (await fetch("/api/identity")).json()).me.id);
  await r.goto(BASE, { waitUntil: "networkidle" });
  await r.waitForTimeout(1200);
  check("and Home doesn't ask for a backup", !/Back up your account/.test(await r.locator("body").innerText()));

  await withReader.clearCookies();
  await r.goto(`${BASE}/join/${code}`, { waitUntil: "networkidle" });
  await r.getByRole("button", { name: "I already have Divvy" }).click();
  await r.getByRole("button", { name: "Sign in with fingerprint or face" }).click();
  await r.getByText("Joining as").waitFor({ timeout: 10000 }).catch(() => {});
  check("a passkey signs back in from an invite", /Joining as\s+Pia Passkey/.test(await r.locator("body").innerText()));
  check("as the same person", (await r.evaluate(async () => (await (await fetch("/api/identity")).json()).me.id)) === pia);
  await withReader.close();
}

// Someone with Divvy on their home screen taps a link: it opens in the browser,
// signed out. Asking only for a name made them a second account.
console.log("\nAn invite, for someone who already has Divvy");
{
  const code = await page.evaluate(
    async (id) => (await (await fetch(`/api/groups/${id}`)).json()).group.inviteCode,
    seed.groupId,
  );
  const own = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const home = await own.newPage();
  await home.goto(BASE, { waitUntil: "networkidle" });
  const account = await home.evaluate(async () => {
    const response = await fetch("/api/identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Sana Existing", defaultCurrency: "EUR" }) });
    return response.json();
  });

  const browserTab = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await browserTab.grantPermissions(["clipboard-read", "clipboard-write"]);
  const b = await browserTab.newPage();
  b.on("pageerror", (error) => errors.push(error.message));
  await b.goto(`${BASE}/join/${code}`, { waitUntil: "networkidle" });
  const first = await b.locator("body").innerText();
  check("the page asks before asking for a name", /I already have Divvy/.test(first) && (await b.getByPlaceholder("Priya").count()) === 0);
  await b.getByRole("button", { name: "I already have Divvy" }).click();
  check("the code is there to read", (await b.locator("body").innerText()).includes(code));
  await b.getByRole("button", { name: "Copy code" }).click();
  await b.getByRole("button", { name: "Copied" }).waitFor({ timeout: 3000 }).catch(() => {});
  check("Copy code copies just the code", (await b.evaluate(() => navigator.clipboard.readText())) === code);

  // The code it copied works in the app that person is signed in to.
  await home.goto(BASE, { waitUntil: "networkidle" });
  await home.getByRole("button", { name: "Join with a code" }).click({ timeout: 8000 });
  await home.getByPlaceholder("mango-tiger-42").fill(code);
  await home.getByRole("button", { name: /^Join (?!with a code)/ }).click({ timeout: 8000 });
  await home.waitForURL(/\/groups\//, { timeout: 10000 }).catch(() => {});
  check("and joins from the app, as their own account", /\/groups\//.test(home.url()), home.url());
  await own.close();

  const before = await page.evaluate(async (id) => (await (await fetch(`/api/groups/${id}`)).json()).group.members.length, seed.groupId);
  await b.getByRole("button", { name: "Sign in with a recovery key" }).click();
  await b.getByRole("textbox").fill("dvy_this_is_not_a_real_key");
  await b.getByRole("button", { name: "Sign in", exact: true }).click();
  await b.waitForTimeout(800);
  check("a wrong key stays here, signed out", (await b.getByRole("textbox").count()) === 1);
  await b.getByRole("textbox").fill(account.recoveryKey);
  await b.getByRole("button", { name: "Sign in", exact: true }).click();
  await b.getByText("Joining as").waitFor({ timeout: 10000 }).catch(() => {});
  check("the right key signs in on the page", /Joining as\s+Sana Existing/.test(await b.locator("body").innerText()));
  check("Join has the focus, one tap away", await b.getByRole("button", { name: /^Join / }).evaluate((el) => el === document.activeElement));
  await b.getByRole("button", { name: /^Join / }).click();
  await b.waitForURL(/\/groups\//, { timeout: 10000 }).catch(() => {});
  check("and lands in the group", /\/groups\//.test(b.url()), b.url());
  const who = await b.evaluate(async () => (await (await fetch("/api/identity")).json()).me);
  check("as the same account, not a second one", who.id === account.me.id, who.id);
  const after = await page.evaluate(async (id) => (await (await fetch(`/api/groups/${id}`)).json()).group.members.length, seed.groupId);
  check("already a member, so nobody was added twice", after === before, `${before} then ${after}`);
  await browserTab.close();

  // Between the browser and the home-screen app on one phone: a camera can't
  // help, so the code is copied across.
  const signedInThere = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await signedInThere.grantPermissions(["clipboard-read", "clipboard-write"]);
  const there = await signedInThere.newPage();
  there.on("pageerror", (error) => errors.push(error.message));
  await there.goto(BASE, { waitUntil: "networkidle" });
  const coder = await there.evaluate(async () => (await (await fetch("/api/identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Cody Code", defaultCurrency: "EUR" }) })).json()).me.id);
  const makeCode = async () => {
    await there.goto(`${BASE}/account`, { waitUntil: "networkidle" });
    await there.getByRole("button", { name: /Your devices/ }).click({ timeout: 8000 });
    await there.getByRole("button", { name: "Add another device" }).click({ timeout: 8000 });
    await there.getByRole("button", { name: "Copy sign-in code" }).click({ timeout: 8000 });
    await there.getByRole("button", { name: "Copied" }).waitFor({ timeout: 3000 }).catch(() => {});
    return there.evaluate(() => navigator.clipboard.readText());
  };
  const firstCode = await makeCode();
  check("a sign-in code is short, in two parts", /^[2-9a-kmnp-z]{4}-[2-9a-kmnp-z]{4}$/.test(firstCode), firstCode);

  const homeApp = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await homeApp.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  const app = await homeApp.newPage();
  app.on("pageerror", (error) => errors.push(error.message));
  await app.goto(BASE, { waitUntil: "networkidle" });
  await app.getByRole("button", { name: "Sign in with a code" }).click({ timeout: 8000 });
  await app.getByPlaceholder("k7fq-m2xp").fill("aaaa-aaaa");
  await app.getByRole("button", { name: "Sign in", exact: true }).click();
  await app.getByText("That code didn").first().waitFor({ timeout: 5000 }).catch(() => {});
  check("a wrong code says so, and stays signed out", (await app.getByText("That code didn").count()) > 0 && (await app.getByPlaceholder("k7fq-m2xp").count()) === 1);
  await app.getByPlaceholder("k7fq-m2xp").fill(firstCode.toUpperCase());
  await app.getByRole("button", { name: "Sign in", exact: true }).click();
  await app.getByPlaceholder("k7fq-m2xp").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  check("the home-screen app signs in with it, as the same person", (await app.evaluate(async () => (await (await fetch("/api/identity")).json()).me?.id)) === coder);
  await homeApp.close();

  const again = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await again.newPage();
  a.on("pageerror", (error) => errors.push(error.message));
  await a.goto(`${BASE}/join/${code}`, { waitUntil: "networkidle" });
  await a.getByRole("button", { name: "I already have Divvy" }).click();
  await a.getByRole("button", { name: "Sign in with a code" }).click();
  await a.getByPlaceholder("k7fq-m2xp").fill(firstCode);
  await a.getByRole("button", { name: "Sign in", exact: true }).click();
  await a.getByText("already been used").first().waitFor({ timeout: 5000 }).catch(() => {});
  check("the same code doesn't work twice", (await a.getByText("already been used").count()) > 0);
  await a.getByPlaceholder("k7fq-m2xp").fill(await makeCode());
  await a.getByRole("button", { name: "Sign in", exact: true }).click();
  await a.getByText("Joining as").waitFor({ timeout: 10000 }).catch(() => {});
  check("a new one signs in on an invite, ready to join", /Joining as\s+Cody Code/.test(await a.locator("body").innerText()));
  await again.close();
  await signedInThere.close();

  // Two accounts become one, from the You tab. The money side of this is tested
  // much harder in scripts/audit-combine.ts.
  {
    const keepCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const otherCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await otherCtx.grantPermissions(["clipboard-read", "clipboard-write"]);
    const keep = await keepCtx.newPage();
    const old = await otherCtx.newPage();
    keep.on("pageerror", (error) => errors.push(error.message));
    old.on("pageerror", (error) => errors.push(error.message));
    const sign = (p, displayName) => p.evaluate(async (name) => (await (await fetch("/api/identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: name, defaultCurrency: "EUR" }) })).json()).me.id, displayName);
    await keep.goto(BASE, { waitUntil: "networkidle" });
    await old.goto(BASE, { waitUntil: "networkidle" });
    const keepId = await sign(keep, "Sana New");
    await sign(old, "Sana Old");
    await old.evaluate((invite) => fetch(`/api/invite/${invite}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), code);

    await old.goto(`${BASE}/account`, { waitUntil: "networkidle" });
    await old.getByRole("button", { name: /Your devices/ }).click({ timeout: 8000 });
    await old.getByRole("button", { name: "Add another device" }).click({ timeout: 8000 });
    await old.getByRole("button", { name: "Copy sign-in code" }).click({ timeout: 8000 });
    await old.getByRole("button", { name: "Copied" }).waitFor({ timeout: 3000 }).catch(() => {});
    const proof = await old.evaluate(() => navigator.clipboard.readText());

    await keep.goto(`${BASE}/account`, { waitUntil: "networkidle" });
    await keep.getByRole("button", { name: /Combine two accounts/ }).click({ timeout: 8000 });
    await keep.getByPlaceholder("k7fq-m2xp").fill(proof);
    await keep.getByRole("button", { name: "Continue" }).click();
    await keep.getByText("This can").waitFor({ timeout: 8000 }).catch(() => {});
    const asked = await keep.locator("body").innerText();
    check("combining says what will happen before doing it", /Move\s+Sana Old\s+into\s+Sana New/.test(asked) && /1 group and 0 expenses/.test(asked) && /can.t be undone/.test(asked), asked.slice(-400));
    check("and nothing has happened yet", (await old.evaluate(async () => (await (await fetch("/api/identity")).json()).me?.displayName)) === "Sana Old");
    await keep.getByRole("button", { name: "Combine accounts" }).click();
    await keep.getByText("This can").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    check("the old device stays signed in, as the account that stayed", (await old.evaluate(async () => (await (await fetch("/api/identity")).json()).me?.id)) === keepId);
    const groups = await keep.evaluate(async () => (await (await fetch("/api/dashboard")).json()).groups.length);
    check("and the group came across", groups === 1, String(groups));
    await keepCtx.close();
    await otherCtx.close();
  }

  // Changing your mind, and nothing about a home-screen app to copy into.
  const change = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const c = await change.newPage();
  await c.goto(`${BASE}/join/${code}`, { waitUntil: "networkidle" });
  await c.getByRole("button", { name: "I already have Divvy" }).click();
  await c.getByRole("button", { name: /new to Divvy/ }).click();
  check("you can change your mind", await c.getByPlaceholder("Priya").isVisible());
  await c.getByRole("button", { name: "I already have Divvy" }).click();
  check("either way", await c.getByRole("button", { name: "Copy code" }).isVisible());
  await change.close();

  const installed = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installed.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  const i = await installed.newPage();
  await i.goto(`${BASE}/join/${code}`, { waitUntil: "networkidle" });
  await i.getByRole("button", { name: "I already have Divvy" }).click();
  check("in the home-screen app, it doesn't send you to the app", (await i.getByRole("button", { name: "Copy code" }).count()) === 0 && (await i.getByRole("button", { name: "Sign in with a recovery key" }).isVisible()));
  await installed.close();
}

check("no errors in the browser console", errors.length === 0, errors.slice(0, 3).join(" / "));
console.log(`\n${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed ? 1 : 0);
