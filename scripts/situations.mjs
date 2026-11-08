/**
 * The real situations people get into with signing in, walked through the real
 * screens (findings items 59 and 60).
 *
 * New phone, app removed and added back, a lost key, a phone unused for 180 days,
 * and a browser inside another app. What can only be told on a real phone is
 * listed on the findings page, not pretended here.
 *
 *   node scripts/situations.mjs http://localhost:3000
 *
 * One section changes the test database directly, to make a sign-in look 180 days
 * old, so it only runs against this machine (DATABASE_URL, as for db-check.mjs).
 */
import { createRequire } from "node:module";
import path from "node:path";
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

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const phone = { viewport: { width: 390, height: 844 } };

const fresh = async (options = {}, setup) => {
  const ctx = await browser.newContext({ ...phone, ...options });
  if (setup) await ctx.addInitScript(setup);
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  return { ctx, page };
};
const homeScreen = () => Object.defineProperty(navigator, "standalone", { get: () => true });
const post = (page, url, body) =>
  page.evaluate(
    async ([u, b]) => {
      const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
      return r.json();
    },
    [url, body],
  );
const whoAmI = (page) => page.evaluate(async () => (await (await fetch("/api/identity")).json()).me?.id ?? null);
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const button = (page, name) => page.getByRole("button", { name });

/** An account with a group and a bill, signed in on a phone of its own. */
async function account(name) {
  const { ctx, page } = await fresh();
  await page.goto(BASE, { waitUntil: "networkidle" });
  const made = await post(page, "/api/identity", { displayName: name, defaultCurrency: "EUR" });
  const group = (await post(page, "/api/groups", { name: `${name}'s flat`, currency: "EUR" })).group;
  await post(page, "/api/expenses", {
    groupId: group.id,
    description: "Rent",
    amount: "1000",
    currency: "EUR",
    splitMode: "EXACT",
    payers: [{ personId: made.me.id, amount: "1000" }],
    splits: [{ personId: made.me.id, amount: "1000", included: true }],
  });
  return { ctx, page, id: made.me.id, key: made.recoveryKey, name, groupId: group.id };
}

const signInWithKey = async (page, key) => {
  await button(page, "Sign in with a recovery key").click({ timeout: 8000 });
  await page.getByPlaceholder("dvy_…").fill(key);
  await button(page, "Get my account back").click();
  await page.getByPlaceholder("dvy_…").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
};

const groupsOf = (page) => page.evaluate(async () => (await (await fetch("/api/dashboard")).json()).groups.length);

// ---------------------------------------------------------------------------
console.log("\nA new phone, with the recovery key");
{
  const owner = await account("Nia");
  const { ctx, page } = await fresh();
  await page.goto(BASE, { waitUntil: "networkidle" });
  check("a phone that's never seen Divvy offers Get started", await button(page, /Get started/).isVisible());
  await button(page, "I already use Divvy").click();
  await signInWithKey(page, owner.key);
  check("the key brings the account back", (await whoAmI(page)) === owner.id);
  check("with its group", (await groupsOf(page)) === 1);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  check("and shows it", (await text(page)).includes("Nia's flat"), (await text(page)).slice(0, 160));
  check("without asking to back up again", !(await text(page)).includes("Back up your account"));
  await ctx.close();
  await owner.ctx.close();
}

// ---------------------------------------------------------------------------
console.log("\nA new phone, with the old one to hand");
{
  const owner = await account("Oli");
  const link = await post(owner.page, "/api/identity/link", {});
  const { ctx, page } = await fresh();
  await page.goto(`${BASE}${link.path}`, { waitUntil: "networkidle" });
  await page.getByText("You’re signed in").waitFor({ timeout: 8000 }).catch(() => {});
  check("the QR code's link signs the new phone in", (await whoAmI(page)) === owner.id);
  await ctx.close();
  await owner.ctx.close();
}

// ---------------------------------------------------------------------------
console.log("\nThe app removed and added back");
{
  const owner = await account("Pia");
  // Nothing of the old app survives: a new context with no cookies or storage.
  const { ctx, page } = await fresh({}, homeScreen);
  await page.goto(BASE, { waitUntil: "networkidle" });
  const shown = await text(page);
  check("the home-screen app leads with signing back in", /Already use Divvy\? Sign back in/.test(shown), shown.slice(0, 200));
  check("the way to sign in is on the first screen", await button(page, "Sign in with a recovery key").evaluate((el) => {
    const box = el.getBoundingClientRect();
    return box.bottom <= innerHeight;
  }));
  await signInWithKey(page, owner.key);
  check("the key brings it back", (await whoAmI(page)) === owner.id);
  await ctx.close();
  await owner.ctx.close();
}

// ---------------------------------------------------------------------------
console.log("\nA phone that forgot its sign-in, and nothing else");
{
  const owner = await account("Quin");
  // This phone once skipped saving a key: its reminder is still in storage.
  await owner.page.goto(BASE, { waitUntil: "networkidle" });
  await owner.page.evaluate(() => localStorage.setItem("divvy-recovery-pending", "1"));
  await owner.page.waitForTimeout(800);
  await owner.ctx.clearCookies();
  await owner.page.goto(BASE, { waitUntil: "networkidle" });
  const shown = await text(owner.page);
  check("in a browser too, it leads with signing back in", /Already use Divvy\? Sign back in/.test(shown), shown.slice(0, 200));
  check("the drawing for new people has gone, so the buttons fit", await button(owner.page, "Sign in with a recovery key").evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight));
  check("someone else can still start", await button(owner.page, /new to Divvy/).isVisible());
  await signInWithKey(owner.page, owner.key);
  check("the key brings it back", (await whoAmI(owner.page)) === owner.id);
  await owner.page.goto(BASE, { waitUntil: "networkidle" });
  await owner.page.waitForTimeout(1000);
  check("and the old reminder goes, since they've just used their key", !(await text(owner.page)).includes("Back up your account"));
  await owner.ctx.close();
}

// ---------------------------------------------------------------------------
console.log("\nA lost recovery key, still signed in somewhere");
{
  const owner = await account("Rae");
  await owner.page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
  await button(owner.page, /Recovery key/).first().click({ timeout: 8000 });
  await owner.page.waitForTimeout(500);
  const sheet = await text(owner.page);
  check("You, Recovery key explains that a new one replaces it", /new/i.test(sheet), sheet.slice(-300));
  const rotated = await post(owner.page, "/api/identity/recovery", {});
  const newKey = rotated.recoveryKey;
  check("a new key can be made", typeof newKey === "string" && newKey.startsWith("dvy_"), JSON.stringify(rotated).slice(0, 120));

  const { ctx, page } = await fresh();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await button(page, "I already use Divvy").click();
  await button(page, "Sign in with a recovery key").click();
  await page.getByPlaceholder("dvy_…").waitFor({ timeout: 5000 }).catch(() => {});
  check("the screen says what to do if it's lost", (await text(page)).includes("Lost it?"));
  await page.getByPlaceholder("dvy_…").fill(owner.key);
  await button(page, "Get my account back").click();
  await page.waitForTimeout(800);
  check("the old key no longer works", (await whoAmI(page)) === null);
  await page.getByPlaceholder("dvy_…").fill(newKey);
  await button(page, "Get my account back").click();
  await page.getByPlaceholder("dvy_…").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  check("the new one does", (await whoAmI(page)) === owner.id);
  await ctx.close();
  await owner.ctx.close();
}

// ---------------------------------------------------------------------------
console.log("\nA lost recovery key, signed in nowhere");
{
  const owner = await account("Sol");
  await owner.ctx.close();
  const { ctx, page } = await fresh();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await button(page, "I already use Divvy").click();
  await button(page, "Sign in with a recovery key").click();
  await page.getByPlaceholder("dvy_…").fill("dvy_a_guess_that_is_not_a_real_key_at_all");
  await button(page, "Get my account back").click();
  await page.getByText("That key didn").first().waitFor({ timeout: 5000 }).catch(() => {});
  check("a wrong key says so", (await page.getByText("That key didn").count()) > 0);
  check("and says plainly when an account can't be got back", (await text(page)).includes("can’t be got back"));
  await ctx.close();
}

// ---------------------------------------------------------------------------
console.log("\nA phone unused for 180 days");
if (/localhost|127\.0\.0\.1/.test(BASE) && process.env.DATABASE_URL) {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const Database = require("better-sqlite3");
  let file = process.env.DATABASE_URL.replace(/^file:/, "").split("?")[0];
  if (!file.startsWith("/") && !/^[A-Za-z]:/.test(file)) file = path.join("prisma", file);
  const db = new Database(file);
  const age = (id, days) => db.prepare('UPDATE "Session" SET "lastSeenAt" = ? WHERE "personId" = ?').run(Date.now() - days * 86_400_000, id);

  const owner = await account("Tao");
  await owner.page.goto(BASE, { waitUntil: "networkidle" });
  await owner.page.waitForTimeout(600);

  age(owner.id, 179);
  check("179 days on, still signed in", (await whoAmI(owner.page)) === owner.id);
  const touched = db.prepare('SELECT MAX("lastSeenAt") AS at FROM "Session" WHERE "personId" = ?').get(owner.id).at;
  check("and the clock starts again", Date.now() - Number(touched) < 3_600_000, String(touched));

  age(owner.id, 181);
  await owner.page.goto(BASE, { waitUntil: "networkidle" });
  await owner.page.waitForTimeout(800);
  const shown = await text(owner.page);
  check("181 days on, signed out", (await whoAmI(owner.page)) === null);
  check("and offered signing back in, not a new account first", /Already use Divvy\? Sign back in/.test(shown), shown.slice(0, 200));
  await signInWithKey(owner.page, owner.key);
  check("the key still works", (await whoAmI(owner.page)) === owner.id);
  check("and everything's still there", (await groupsOf(owner.page)) === 1);
  db.close();
  await owner.ctx.close();
} else {
  console.log("    skipped: needs a local server and DATABASE_URL");
}

// ---------------------------------------------------------------------------
console.log("\nA browser inside another app");
{
  const owner = await account("Uma");
  const invite = await owner.page.evaluate(async (id) => (await (await fetch(`/api/groups/${id}`)).json()).group.inviteCode, owner.groupId);
  const existing = await account("Vic");

  // No passkeys and no clipboard, as reported of browsers inside other apps.
  const limited = () => {
    Object.defineProperty(navigator, "credentials", { get: () => undefined });
    delete window.PublicKeyCredential;
    Object.defineProperty(navigator, "clipboard", { get: () => ({ writeText: () => Promise.reject(new Error("blocked")), readText: () => Promise.reject(new Error("blocked")) }) });
  };
  const whatsApp = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/2.26.1";

  const { ctx, page } = await fresh({ userAgent: whatsApp }, limited);
  await page.goto(`${BASE}/join/${invite}`, { waitUntil: "networkidle" });
  await button(page, "I already have Divvy").click();
  await page.waitForTimeout(500);
  check("no passkey button that can't work", (await button(page, "Sign in with fingerprint or face").count()) === 0);
  check("the code is on screen", (await text(page)).includes(invite));
  await button(page, "Copy code").click();
  await page.getByText("Couldn't copy").first().waitFor({ timeout: 3000 }).catch(() => {});
  check("Copy code says when it can't", (await page.getByText("Couldn't copy").count()) > 0);
  await button(page, "Sign in with a recovery key").click();
  await page.getByPlaceholder("dvy_…").fill(existing.key);
  await button(page, "Sign in", { exact: true }).first().click();
  await page.getByText("Joining as").waitFor({ timeout: 8000 }).catch(() => {});
  check("a recovery key still works there", (await text(page)).includes("Joining as Vic"));
  await ctx.close();
  await existing.ctx.close();

  const newcomer = await fresh({ userAgent: whatsApp }, limited);
  await newcomer.page.goto(`${BASE}/join/${invite}`, { waitUntil: "networkidle" });
  await button(newcomer.page, /new to Divvy/).click();
  await newcomer.page.getByPlaceholder("Priya").fill("Wren");
  await button(newcomer.page, /^Join /).click();
  await button(newcomer.page, "Save a recovery key instead").waitFor({ timeout: 15000 }).catch(() => {});
  check("someone new is still asked to protect the account", await button(newcomer.page, "Save a recovery key instead").isVisible());
  check("without offering a passkey it can't make", (await button(newcomer.page, "Use Face ID or fingerprint").count()) === 0);
  await newcomer.ctx.close();
  await owner.ctx.close();
}

// ---------------------------------------------------------------------------
console.log("\nSomething wrong? Tell us");
{
  // Signed out, from the welcome screen: not getting in is often the problem.
  const { ctx, page } = await fresh();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await button(page, "Something wrong? Tell us").click();
  await page.getByPlaceholder("I tapped the invite link and…").fill("I can't find my recovery key");
  await button(page, "Send").click();
  await page.getByText("Sent. Thank you.").first().waitFor({ timeout: 5000 }).catch(() => {});
  check("someone signed out can send one", (await page.getByText("Sent. Thank you.").count()) > 0);
  await ctx.close();

  const sender = await account("Xan");
  await sender.page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
  await button(sender.page, /Something wrong\?/).click({ timeout: 8000 });
  await sender.page.getByPlaceholder("I tapped the invite link and…").fill("The total on Home looks wrong");
  await button(sender.page, "Send").click();
  await sender.page.getByText("Sent. Thank you.").first().waitFor({ timeout: 5000 }).catch(() => {});
  check("so can someone signed in, from the You tab", (await sender.page.getByText("Sent. Thank you.").count()) > 0);
  const empty = await sender.page.evaluate(async () => (await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "  ", path: "/" }) })).status);
  check("an empty one is refused", empty === 422, String(empty));
  const peek = await sender.page.evaluate(async () => (await fetch("/api/reports")).status);
  check("and nobody but the reader can read them", peek === 403, String(peek));

  const reader = process.env.DIVVY_REPORTS_TO;
  if (reader && /localhost|127\.0\.0\.1/.test(BASE) && process.env.DATABASE_URL) {
    const require = createRequire(path.join(process.cwd(), "package.json"));
    const Database = require("better-sqlite3");
    let file = process.env.DATABASE_URL.replace(/^file:/, "").split("?")[0];
    if (!file.startsWith("/") && !/^[A-Za-z]:/.test(file)) file = path.join("prisma", file);
    const owner = await account("Owner");
    const db = new Database(file);
    db.prepare('UPDATE "Person" SET "inviteCode" = ? WHERE "id" = ?').run(reader, owner.id);
    db.close();
    await owner.page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
    await owner.page.getByText("Reports people sent").click({ timeout: 8000 });
    await owner.page.getByText("The total on Home looks wrong").waitFor({ timeout: 8000 }).catch(() => {});
    const list = await text(owner.page);
    check("the reader sees them, newest first", list.indexOf("The total on Home looks wrong") > -1 && list.indexOf("The total on Home looks wrong") < list.indexOf("I can't find my recovery key"), list.slice(0, 300));
    check("with who sent it, or that they weren't signed in", list.includes("Xan") && list.includes("Someone not signed in"));
    check("and which screen it came from", list.includes("/account"));
    await owner.ctx.close();
  } else {
    console.log("    the reader's view skipped: needs DIVVY_REPORTS_TO, a local server and DATABASE_URL");
  }
  await sender.ctx.close();
}

check("no errors in the browser console", errors.length === 0, errors.slice(0, 3).join(" / "));
console.log(`\n${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed ? 1 : 0);
