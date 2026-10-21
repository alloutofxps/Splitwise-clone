/**
 * Keyboard-only check of every panel, and of the two money tasks.
 *
 *   node scripts/keyboard-check.mjs <base-url> <out-dir>
 *
 * WIDTH=390 checks the phone layout (default 1280, the computer layout).
 *
 * For each panel, opened from its button with Enter as a keyboard user would:
 *   - does focus move into the panel when it opens;
 *   - does Tab stay inside it (30 presses);
 *   - does Escape close it;
 *   - does focus come back to the button that opened it.
 * Then adding an expense and settling up with keys alone, and the arrow keys
 * on a group's tabs. Writes <out-dir>/keyboard.txt and prints the totals.
 *
 * A report, not a pass/fail test: compare the totals before and after a change.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { launchOptions, seed, signIn } from "./check-accounts.mjs";

const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = process.argv[3] ?? "keyboard-out";
const WIDTH = Number(process.env.WIDTH ?? 1280);
const phone = WIDTH < 600;
mkdirSync(OUT, { recursive: true });

const data = await seed(BASE);
const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({ viewport: { width: WIDTH, height: phone ? 844 : 800 } });
await signIn(context, BASE, data.me.cookie);
const page = await context.newPage();
const lines = [];
const log = (line) => {
  console.log(line);
  lines.push(line);
};
const totals = { panels: 0, movedIn: 0, staysInside: 0, escapeCloses: 0, focusBack: 0 };

/** Where focus is: in the top panel, a lower one, the page behind, or nowhere. */
const active = () =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { where: "body", name: "" };
    const dialog = el.closest('[role="dialog"]');
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    return {
      where: dialog ? (dialog === dialogs[dialogs.length - 1] ? "panel" : "lower-panel") : dialogs.length ? "page-behind" : "page",
      name: (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 50),
      opener: el.hasAttribute("data-kbd-opener"),
      value: el.value ?? null,
    };
  });
const dialogCount = () => page.locator('[role="dialog"]').count();
const btn = (name, exact = false) => page.getByRole("button", { name, exact });
const addButton = () => (phone ? btn("Add an expense") : btn("Add expense", true));

async function tabIntoPanel(limit = 80) {
  for (let i = 0; i < limit; i++) {
    if ((await active()).where === "panel") return i;
    await page.keyboard.press("Tab");
  }
  return -1;
}

async function panel(label, path, getOpener) {
  if (path) await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const opener = (await getOpener()).first();
  if (!(await opener.count())) {
    log(`${label}: button not found`);
    return;
  }
  await opener.evaluate((el) => el.setAttribute("data-kbd-opener", ""));
  await opener.focus();
  const before = await dialogCount();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  if ((await dialogCount()) <= before) {
    log(`${label}: Enter opened no panel`);
    await page.evaluate(() => document.querySelector("[data-kbd-opener]")?.removeAttribute("data-kbd-opener"));
    return;
  }
  totals.panels += 1;
  const onOpen = await active();
  const movedIn = onOpen.where === "panel";
  const tabsIn = movedIn ? 0 : await tabIntoPanel();
  let left = 0;
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(20);
    const a = await active();
    // Leaving to the browser's own toolbar (body here) is how a native modal
    // behaves too; only landing on the page or a lower panel counts.
    if (a.where === "page-behind" || a.where === "lower-panel") left += 1;
  }
  // Escape from inside the panel, as the person would be.
  if ((await active()).where !== "panel") await tabIntoPanel();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  const closed = (await dialogCount()) === before;
  const back = await active();
  totals.movedIn += movedIn ? 1 : 0;
  totals.staysInside += left === 0 ? 1 : 0;
  totals.escapeCloses += closed ? 1 : 0;
  totals.focusBack += back.opener ? 1 : 0;
  log(
    `${label}: moved in ${movedIn ? "yes" : `no (${tabsIn} Tabs to reach it)`} | Tab left it ${left}/30 | Escape closed ${closed ? "yes" : "no"} | focus after: ${back.opener ? "back on its button" : `${back.where} "${back.name}"`}`,
  );
  await page.evaluate(() => document.querySelector("[data-kbd-opener]")?.removeAttribute("data-kbd-opener"));
}

const g = `/groups/${data.trip}`;
await panel("Add expense", g, addButton);
await panel("Settle up", g, () => btn("Settle up", true));
await panel("Expense details", g, () => btn(/Dinner at Cervejaria/));
await panel("Invite", g, () => btn("Invite", true));
await panel("Group settings", g, () => btn("Group settings"));
await panel("Members", g, () => btn(/4 people/));
await panel("Add a payment", g, async () => {
  if (phone) await page.getByRole("tab", { name: "Balances" }).click();
  await page.waitForTimeout(400);
  return btn("Add a payment");
});
await panel("Suggested payment", null, () => btn(/^Add Sam Lee paying you/));

// Panels over a panel: from inside the composer.
for (const [label, name] of [["Composer > Split", /^Split/], ["Composer > Who paid", /^Paid by/], ["Composer > Currency", /^Currency/], ["Composer > Category", /^Category/]]) {
  await page.goto(BASE + g, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await (await addButton()).first().focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  await tabIntoPanel();
  await panel(label, null, () => page.locator('[role="dialog"]').last().getByRole("button", { name }));
}

await panel("New group", "/", () => btn("New group"));
await panel("Join a group", "/", () => btn("Join", true));
await panel("My code", "/friends", () => btn("My code"));
await panel("Add a friend", "/friends", () => btn("Add", true));
await panel("Friends filter", "/friends", () => btn("Filter this list"));
await panel("Friend settings", `/friends/${data.ravi.id}`, () => btn("Friend settings"));
await panel("Friend settle up", `/friends/${data.ravi.id}`, () => btn("Settle up", true));
await panel("Activity row", "/activity", () => btn(/added Concert tickets/));
await panel("Emoji", "/account", () => btn("Pick an emoji"));
await panel("How people pay you", "/account", () => btn(/How people can pay you/));
await panel("Default currency", "/account", () => btn(/Default currency/));
await panel("Budgets", "/account", () => btn(/^Budgets/));
await panel("Your devices", "/account", () => btn(/Your devices/));
await panel("Recovery key", "/account", () => btn(/Recovery key/));
await panel("Delete my account", "/account", () => btn("Delete my account"));

// Adding an expense with keys only.
await page.goto(BASE + g, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
{
  const steps = [];
  await (await addButton()).first().focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  steps.push(`Tabs to reach the panel: ${await tabIntoPanel()}`);
  let presses = 0;
  while (!/What was it for/i.test((await active()).name) && presses++ < 20) await page.keyboard.press("Tab");
  await page.keyboard.type("Keyboard lunch");
  while ((await active()).name !== "Amount" && presses++ < 30) await page.keyboard.press("Tab");
  await page.keyboard.type("12.50");
  let a = await active();
  steps.push(`amount typed: "${a.value}"`);
  let toSave = 0;
  while (!(/^Add expense$/.test(a.name) && a.where === "panel") && toSave < 40) {
    await page.keyboard.press("Tab");
    toSave += 1;
    a = await active();
  }
  steps.push(`Tabs from amount to Add expense: ${toSave}`);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  const after = await active();
  steps.push(`saved: ${(await page.getByText("Keyboard lunch").count()) > 0 ? "yes" : "no"}; focus after: ${after.opener ? "its button" : `${after.where} "${after.name}"`}`);
  log(`Task, add an expense: ${steps.join(" | ")}`);
}

// Settling up with keys only.
await page.goto(BASE + g, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
{
  const steps = [];
  await btn("Settle up", true).first().focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  steps.push(`Tabs to reach the panel: ${await tabIntoPanel()}`);
  let a = await active();
  for (let i = 0; i < 6 && !/pays you|^Pay /.test(a.name); i++) {
    await page.keyboard.press("Tab");
    a = await active();
  }
  await page.keyboard.press(" ");
  await page.waitForTimeout(800);
  for (let i = 0; i < 25 && !/^Save payment$/.test(a.name); i++) {
    await page.keyboard.press("Tab");
    a = await active();
  }
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3200);
  const after = await active();
  steps.push(`saved: ${(await dialogCount()) === 0 ? "yes" : "no"}; focus after: ${after.where} "${after.name}"`);
  log(`Task, settle up: ${steps.join(" | ")}`);
}

// Arrow keys on the group's tabs.
await page.goto(BASE + g, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
{
  const first = phone ? "Expenses" : "Balances";
  await page.getByRole("tab", { name: first }).first().focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  const selected = await page.locator('[role="tab"][aria-selected="true"]').first().innerText();
  log(`Group tabs: ArrowRight from ${first} -> focus "${(await active()).name}", selected "${selected.trim()}"`);
}

const t = totals;
log(`\nTotals over ${t.panels} panels: focus moved in ${t.movedIn}, Tab stayed inside ${t.staysInside}, Escape closed ${t.escapeCloses}, focus came back ${t.focusBack}`);
writeFileSync(`${OUT}/keyboard.txt`, lines.join("\n") + "\n");
await browser.close();
