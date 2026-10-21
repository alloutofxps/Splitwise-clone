// Very long names, very large amounts, several currencies and right-to-left
// text, on every main screen, at 390 and 320 wide (and 1280 for the wide
// layout). Screenshots plus an automatic check for anything that runs off
// the screen or is cut without an ellipsis.
//
//   node scripts/long-text.mjs <base-url> <out-dir>
//
// The automatic flags are a starting point: a number that rolls into place
// or a sliding tab can be flagged while looking fine, so read them with the
// screenshots.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { client as makeClient, eq, launchOptions, signIn } from "./check-accounts.mjs";

const BASE = process.argv[2] ?? "http://localhost:3100";
const client = () => makeClient(BASE);

const OUT = process.argv[3] ?? "long-out";
mkdirSync(OUT, { recursive: true });

const pad40 = (s) => (s.length >= 40 ? s.slice(0, 40) : s + "x".repeat(40 - s.length));
const ME = pad40("Bartholomew Montgomery-Fitzgerald Junior");
const LONG2 = pad40("Alexandra Konstantinopoulou-Vanderbilt");
const AR = "محمد عبد الرحمن الهاشمي";
const HE = "אביגיל בן-דוד";
const G_LONG = pad40("Summer road trip across the Western Alps");
const G_AR = "رحلة الصيف إلى الإسكندرية";
const D_LONG = "Two weeks of chalet rental, ski passes and equipment hire for everyone";

const [me, b, ar, he] = [client(), client(), client(), client()];
for (const [c, name, color] of [[me, ME, "violet"], [b, LONG2, "cobalt"], [ar, AR, "sand"], [he, HE, "teal"]]) {
  c.id = (await c.call("/api/identity", { displayName: name, avatarColor: color, defaultCurrency: "EUR" })).me.id;
}
const mk = async (name, currency, emoji) => (await me.call("/api/groups", { name, currency, emoji })).group;
const gLong = await mk(G_LONG, "EUR", "🏔️");
const gAr = await mk(G_AR, "EGP", "🌊");
const gJpy = await mk("Tokyo", "JPY", "🗼");
const gInr = await mk("Goa", "INR", "🏖️");
const gKwd = await mk("Kuwait office", "KWD", "🏢");
for (const g of [gLong, gAr, gJpy, gInr, gKwd]) for (const c of [b, ar, he]) await c.call(`/api/invite/${g.inviteCode}/join`, {});
const all = [me.id, b.id, ar.id, he.id];
const add = (who, groupId, description, amount, currency, ids = all) =>
  who.call("/api/expenses", { groupId, description, amount: String(amount), currency, splitMode: "EQUAL", payers: [{ personId: who.id, amount: String(amount) }], splits: eq(amount, ids) });
// 9,999,999.99 and friends.
await add(me, gLong.id, D_LONG, 999999999, "EUR");
await add(b, gLong.id, "Fuel", 999999999, "EUR", [me.id, b.id]);
await add(ar, gAr.id, "عشاء على الشاطئ مع الجميع", 999999999, "EGP");
await add(me, gAr.id, "Hotel", 12345, "EGP");
await add(he, gJpy.id, "Ryokan", 9999999, "JPY");
await add(me, gInr.id, "Villa", 999999999, "INR");
await add(b, gKwd.id, "Office rent", 9999999999, "KWD");
// A direct expense with the right-to-left friend.
const meCode = (await me.call("/api/identity")).me.inviteCode;
await ar.call(`/api/invite/${meCode}/join`, {});
await me.call("/api/expenses", { friendId: ar.id, description: "قهوة", amount: "999999999", currency: "EUR", splitMode: "EQUAL", payers: [{ personId: me.id, amount: "999999999" }], splits: eq(999999999, [me.id, ar.id]) });
// One payment so Activity and the ledger show a settlement too.
await b.call("/api/settlements", { groupId: gLong.id, fromPersonId: b.id, toPersonId: me.id, amount: "500000000", currency: "EUR" }).catch((e) => console.log("settlement:", e.message));

const browser = await chromium.launch(launchOptions());
const report = [];
for (const width of [390, 320, 1280]) {
  const context = await browser.newContext({ viewport: { width, height: width > 600 ? 800 : 844 }, deviceScaleFactor: width > 600 ? 1 : 2, reducedMotion: "reduce" });
  await signIn(context, BASE, me.cookie);
  const page = await context.newPage();
  const check = async (label, full = true) => {
    await page.waitForTimeout(800);
    const problems = await page.evaluate(() => {
      const out = [];
      const vw = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`);
      const scope = document.querySelector('[role="dialog"]:last-of-type') ?? document.body;
      for (const el of scope.querySelectorAll("*")) {
        if (!el.getClientRects().length) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own) continue;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const text = el.textContent.trim().slice(0, 50);
        // Inside a sideways scroller (chips, tabs) running off is by design.
        let scroller = false;
        for (let n = el.parentElement; n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (/(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth) { scroller = true; break; }
        }
        if (!scroller && (r.right > vw + 1 || r.left < -1)) out.push(`off screen (${Math.round(r.left)}..${Math.round(r.right)}): "${text}"`);
        if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== "ellipsis" && !/(auto|scroll)/.test(cs.overflowX) && cs.overflowX !== "visible")
          out.push(`cut off without "…": "${text}"`);
        // Screen-reader-only text is 1px wide on purpose.
        if (el.clientWidth > 1 && el.scrollWidth > el.clientWidth + 1 && cs.overflowX === "visible" && cs.whiteSpace === "nowrap")
          out.push(`spills past its box: "${text}" (${el.scrollWidth} > ${el.clientWidth})`);
      }
      return [...new Set(out)].slice(0, 25);
    });
    await page.screenshot({ path: `${OUT}/${width}-${label}.png`, fullPage: full });
    report.push(`## ${width} ${label}\n${problems.length ? problems.map((p) => `- ${p}`).join("\n") : "- nothing flagged"}`);
  };
  const go = (p) => page.goto(BASE + p, { waitUntil: "networkidle" });
  const btn = (n, exact) => page.getByRole("button", { name: n, exact });
  try {
    await go("/"); await check("home");
    for (const [key, g] of [["long", gLong], ["ar", gAr], ["jpy", gJpy], ["inr", gInr], ["kwd", gKwd]]) {
      await go(`/groups/${g.id}`); await check(`group-${key}-expenses`);
      if (width < 600) {
        await page.getByRole("tab", { name: "Balances" }).click(); await check(`group-${key}-balances`);
        await btn("Everyone’s balance").click().catch(() => {}); await check(`group-${key}-everyone`);
        await page.getByRole("tab", { name: "Insights" }).click(); await check(`group-${key}-insights`);
        await page.getByRole("tab", { name: "Expenses" }).click();
      }
      if (key === "long" || key === "ar" || key === "kwd") {
        await page.getByRole("button", { name: /Settle up/ }).first().click(); await check(`group-${key}-settle-up`, false);
        const pick = page.locator('[role="dialog"] button').filter({ hasText: /pays you|^Pay / }).first();
        if (await pick.count()) { await pick.click(); await check(`group-${key}-settle-up-picked`, false); }
        await page.keyboard.press("Escape"); await page.waitForTimeout(500);
        await page.locator("main").getByRole("listitem").getByRole("button").first().click(); await check(`group-${key}-details`, false);
        await page.keyboard.press("Escape"); await page.waitForTimeout(500);
      }
    }
    // The composer with a very large amount typed, and a long description.
    await go(`/groups/${gLong.id}`);
    await btn(width < 600 ? "Add an expense" : "Add expense", true).first().click();
    await page.waitForTimeout(700);
    await page.getByPlaceholder("What was it for?").fill(D_LONG);
    await page.getByLabel("Amount").first().click();
    await page.keyboard.type("9999999.99");
    await check("add-expense-big", false);
    await page.getByRole("button", { name: /^Split/ }).first().click(); await check("add-expense-split", false);
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    await page.getByRole("button", { name: /^Paid by/ }).first().click(); await check("add-expense-payer", false);
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
    await go("/friends"); await check("friends");
    await go(`/friends/${ar.id}`); await check("friend-ar");
    await go(`/friends/${b.id}`); await check("friend-long");
    await go("/activity"); await check("activity");
    await go("/account"); await check("you");
    await go("/search?q=a"); await check("search");
  } catch (e) {
    report.push(`## ${width} ERROR ${e.message.split("\n")[0]}`);
    console.error(width, e.message.split("\n")[0]);
  }
  await context.close();
}
writeFileSync(`${OUT}/report.md`, report.join("\n\n") + "\n");
await browser.close();
console.log("done");
