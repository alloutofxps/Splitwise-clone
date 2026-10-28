/**
 * Offline, two phones, and an update arriving mid-use, in a real browser
 * (RULES.md D5, D6, D7, R4).
 *
 *   1. Several changes made offline (add, edit, delete) all reach the server,
 *      in order, after the app is closed and reopened.
 *   2. Two people edit the same expense, one of them offline: the later one
 *      is refused and told why in the banner, and nothing is silently lost.
 *   3. A change the server refuses when it finally arrives (the person was
 *      removed from the group meanwhile) is shown, not dropped.
 *   4. A new version arriving while someone is typing an expense never
 *      reloads the page or loses what was typed.
 *   5. A second phone picks up another person's change when brought back to
 *      the front.
 *
 *   node scripts/offline-check.mjs http://localhost:3000
 *
 * Needs a production build (the service worker is off in development). Set
 * CHROMIUM_PATH to use an installed Chromium or Edge.
 */
import { chromium } from "playwright";
import { client } from "./check-accounts.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pageErrors = [];

/**
 * A phone: its own browser context, signed in as a person who signed up from
 * their own address, so the suites sharing CI's server keep their sign-up
 * allowance.
 */
async function phone(name) {
  const account = client(BASE);
  const me = (await account.call("/api/identity", { displayName: name, avatarColor: "teal" })).me;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: "divvy_id", value: account.cookie, url: BASE }]);
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${name}: ${e.message}`));
  await page.goto(BASE, { waitUntil: "load" });
  // Twice, so the service worker installs and then controls the page.
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1500);
  const self = { context, page, me };
  // Through whichever page is open now: the test closes and reopens them.
  self.api = async (path, body, method) =>
    self.page.evaluate(
      async ([path, body, method]) => {
        const r = await fetch(path, {
          method: method ?? (body ? "POST" : "GET"),
          headers: body ? { "Content-Type": "application/json" } : {},
          body: body ? JSON.stringify(body) : undefined,
        });
        const text = await r.text();
        if (!r.ok) throw new Error(`${path} -> ${r.status} ${text.slice(0, 200)}`);
        return text ? JSON.parse(text) : null;
      },
      [path, body, method],
    );
  return self;
}

const ana = await phone("Ana");
const ben = client(BASE);
const benMe = (await ben.call("/api/identity", { displayName: "Ben", avatarColor: "plum" })).me;

const group = (await ana.api("/api/groups", { name: "Lisbon", kind: "trip", emoji: "🏝️", currency: "EUR" })).group;
const invite = (await ana.api(`/api/groups/${group.id}`)).group.inviteCode;
await ben.call(`/api/invite/${invite}/join`, {});
const bill = (description, amount, payer = ana.me.id) => ({
  groupId: group.id, description, amount: String(amount), currency: "EUR", splitMode: "EQUAL",
  payers: [{ personId: payer, amount: String(amount) }],
  splits: [{ personId: ana.me.id, amount: String(amount / 2) }, { personId: benMe.id, amount: String(amount / 2) }],
});
const dinner = (await ana.api("/api/expenses", bill("Dinner", 3000))).expense;
await ana.api("/api/expenses", bill("Taxi", 1000));

const onServer = async () => {
  const r = await ben.call(`/api/groups/${group.id}/expenses`);
  return (r.items ?? []).map((i) => i.expense).filter(Boolean);
};
const groupPage = async (page, id = group.id) => {
  await page.goto(`${BASE}/groups/${id}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Add an expense" }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
};
const banner = (page) => page.locator("[role=status], [role=alert]").filter({ hasText: /Offline|waiting to send|couldn.t be saved/ });

// ---------------------------------------------------------------------------
console.log("\n1. Several changes offline");
{
  const { page, context } = ana;
  await groupPage(page);
  await context.setOffline(true);
  await page.waitForTimeout(500);

  // Add.
  await page.getByRole("button", { name: "Add an expense" }).first().click();
  await page.waitForTimeout(900);
  for (const digit of ["2", "0"]) {
    await page.getByLabel("Amount keypad").getByRole("button", { name: digit, exact: true }).click();
  }
  await page.locator("input[placeholder='What was it for?']").fill("Offline lunch");
  await page.getByRole("button", { name: "Add expense" }).click();
  await page.locator("[role=dialog]").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);

  // Edit.
  await page.getByText("Dinner", { exact: true }).first().click();
  await page.getByRole("button", { name: /^Edit$/ }).first().click({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await page.locator("input[placeholder='What was it for?']").fill("Dinner at Rosa's");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // Delete.
  await page.getByText("Taxi", { exact: true }).first().click();
  await page.getByRole("button", { name: "Delete", exact: true }).first().click({ timeout: 10000 });
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Delete", exact: true }).last().click();
  await page.waitForTimeout(1500);

  const offlineText = (await banner(page).allInnerTexts()).join(" ");
  check("the banner counts the three changes waiting", /3 changes will be sent later/.test(offlineText), offlineText);
  const list = await page.locator("main").innerText();
  check("the screen already shows all three", list.includes("Offline lunch") && list.includes("Dinner at Rosa's") && !/\bTaxi\b/.test(list), list.slice(0, 200));

  // Close the app while offline, then come back online and reopen it.
  await page.close();
  await context.setOffline(false);
  ana.page = await context.newPage();
  ana.page.on("pageerror", (e) => pageErrors.push(`Ana: ${e.message}`));
  await groupPage(ana.page);
  let server = [];
  for (let i = 0; i < 20; i++) {
    server = await onServer();
    if (server.some((e) => e.description === "Offline lunch") && !server.some((e) => e.description === "Taxi")) break;
    await wait(1000);
  }
  const lunch = server.find((e) => e.description === "Offline lunch");
  check("the added expense reached the server, with its amount", lunch?.amount === "2000", JSON.stringify(lunch?.amount));
  check("the edit reached the server", server.some((e) => e.id === dinner.id && e.description === "Dinner at Rosa's"), server.map((e) => e.description).join(", "));
  check("the delete reached the server", !server.some((e) => e.description === "Taxi"));
  await ana.page.waitForTimeout(1500);
  check("the banner is gone once everything is sent", (await banner(ana.page).count()) === 0, (await banner(ana.page).allInnerTexts()).join(" "));
}

// ---------------------------------------------------------------------------
console.log("\n2. Two people edit the same expense, one offline");
{
  const { context } = ana;
  const page = ana.page;
  await groupPage(page);
  await context.setOffline(true);
  await page.waitForTimeout(500);
  await page.getByText("Dinner at Rosa's", { exact: true }).first().click();
  await page.getByRole("button", { name: /^Edit$/ }).first().click({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await page.locator("input[placeholder='What was it for?']").fill("Dinner (Ana)");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // Ben, online, changes it first.
  const current = (await ben.call(`/api/expenses/${dinner.id}`)).expense;
  await ben.call(`/api/expenses/${dinner.id}`, { ...bill("Dinner (Ben)", 3000), expectedUpdatedAt: current.updatedAt }, "PATCH");

  await context.setOffline(false);
  const alert = page.locator("[role=alert]").filter({ hasText: /couldn.t be saved/ });
  const shown = await alert.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  const said = shown ? await alert.innerText() : "";
  check("Ana is told her change couldn't be saved", shown, said);
  check("and why, in plain words", /changed by someone else/.test(said), said.replace(/\s+/g, " ").slice(0, 200));
  const kept = (await ben.call(`/api/expenses/${dinner.id}`)).expense;
  check("Ben's version is the one kept", kept.description === "Dinner (Ben)", kept.description);
  let screen = "";
  for (let i = 0; i < 10; i++) {
    screen = await page.locator("main").innerText();
    if (screen.includes("Dinner (Ben)")) break;
    await wait(1000);
  }
  check("Ana's screen shows Ben's version, not her refused one", screen.includes("Dinner (Ben)") && !screen.includes("Dinner (Ana)"), screen.slice(0, 200));
  await page.getByRole("button", { name: /^Dismiss / }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  check("dismissing it clears the banner", (await alert.count()) === 0);
}

// ---------------------------------------------------------------------------
console.log("\n3. A change refused when it finally arrives");
{
  const { context } = ana;
  const page = ana.page;
  const spare = (await ben.call("/api/groups", { name: "Spare room", kind: "home", emoji: "🛏️", currency: "EUR" })).group;
  const spareInvite = (await ben.call(`/api/groups/${spare.id}`)).group.inviteCode;
  await ana.api(`/api/invite/${spareInvite}/join`, {});
  await groupPage(page, spare.id);
  await context.setOffline(true);
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Add an expense" }).first().click();
  await page.waitForTimeout(900);
  for (const digit of ["9"]) {
    await page.getByLabel("Amount keypad").getByRole("button", { name: digit, exact: true }).click();
  }
  await page.locator("input[placeholder='What was it for?']").fill("Ghost drinks");
  await page.getByRole("button", { name: "Add expense" }).click();
  await page.locator("[role=dialog]").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // Meanwhile Ben removes Ana from the group.
  await ben.call(`/api/groups/${spare.id}/members/${ana.me.id}`, undefined, "DELETE");

  await context.setOffline(false);
  const alert = page.locator("[role=alert]").filter({ hasText: /couldn.t be saved/ });
  const shown = await alert.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  const said = shown ? (await alert.innerText()).replace(/\s+/g, " ") : "";
  check("the refused expense is shown, not dropped", shown && said.includes("Ghost drinks"), said.slice(0, 200));
  check("with the server's reason", shown && said.length > "1 change couldn't be saved Ghost drinks Retry".length + 10, said.slice(0, 200));
  const spareExpenses = await ben.call(`/api/groups/${spare.id}/expenses`);
  check("and it did not reach the group", !(spareExpenses.items ?? []).some((i) => i.expense?.description === "Ghost drinks"));
  await page.getByRole("button", { name: /^Dismiss / }).first().click().catch(() => {});
  await page.waitForTimeout(600);
}

// ---------------------------------------------------------------------------
console.log("\n4. A new version arrives while typing an expense");
{
  const page = ana.page;
  await groupPage(page);
  await page.evaluate(() => { window.__notReloaded = true; });
  await page.getByRole("button", { name: "Add an expense" }).first().click();
  await page.waitForTimeout(900);
  for (const digit of ["1", "5"]) {
    await page.getByLabel("Amount keypad").getByRole("button", { name: digit, exact: true }).click();
  }
  await page.locator("input[placeholder='What was it for?']").fill("Half-typed coffee");

  // A deploy: a worker for a different build installs and waits.
  const waiting = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register("/sw.js?v=mid-use-update", { scope: "/" });
    for (let i = 0; i < 60 && !registration.waiting; i += 1) await new Promise((r) => setTimeout(r, 100));
    return Boolean(registration.waiting);
  });
  await page.waitForTimeout(1500);
  check("the new version waits instead of taking over", waiting);
  check("the page did not reload", await page.evaluate(() => window.__notReloaded === true));
  const typed = await page.locator("input[placeholder='What was it for?']").inputValue().catch(() => "");
  check("what was typed is still there", typed === "Half-typed coffee", typed);
  await page.getByRole("button", { name: "Add expense" }).click();
  await page.locator("[role=dialog]").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  let saved = false;
  for (let i = 0; i < 10 && !saved; i++) {
    saved = (await onServer()).some((e) => e.description === "Half-typed coffee" && e.amount === "1500");
    if (!saved) await wait(1000);
  }
  check("and it saves normally", saved);
}

// ---------------------------------------------------------------------------
console.log("\n5. A second phone catches up");
{
  const benPhone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await benPhone.addCookies([{ name: "divvy_id", value: ben.cookie, url: BASE }]);
  const page = await benPhone.newPage();
  page.on("pageerror", (e) => pageErrors.push(`Ben: ${e.message}`));
  await groupPage(page);
  await ana.api("/api/expenses", bill("Late snack", 600));
  // Ben brings Divvy back to the front a little later. (Within five seconds
  // of loading, a screen counts as fresh and isn't asked for again.)
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    // As a browser does it: the event bubbles from the document to the
    // window, where the query library listens.
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
  });
  const seen = await page.getByText("Late snack").first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  check("Ben's phone shows Ana's new expense when he comes back to it", seen);
  await benPhone.close();
}

console.log("");
check("no page crashed along the way", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
