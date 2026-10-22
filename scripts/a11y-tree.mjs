// Screen-reader check: what assistive tech is told on each screen and panel.
//
//   node scripts/a11y-tree.mjs <base-url> <out-dir>
//
// Writes, per screen: the accessibility tree as Playwright reads it
// (<name>.yml), and a summary (<name>.txt): page title, landmarks, headings,
// live regions, and every control the browser computes no name for.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { launchOptions, seed, signIn } from "./check-accounts.mjs";

const BASE = process.argv[2] ?? "http://localhost:3100";

const OUT = process.argv[3] ?? "tree-out";
mkdirSync(OUT, { recursive: true });
const data = await seed(BASE);
const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
await signIn(context, BASE, data.me.cookie);
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const summary = [];

async function capture(label) {
  await page.waitForTimeout(700);
  const tree = await page.locator("body").ariaSnapshot();
  writeFileSync(`${OUT}/${label}.yml`, tree);
  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  const interactive = new Set(["button", "link", "textbox", "switch", "tab", "checkbox", "combobox", "radio", "menuitem", "slider", "spinbutton", "searchbox"]);
  const unnamed = nodes
    .filter((n) => !n.ignored && interactive.has(n.role?.value) && !(n.name?.value ?? "").trim())
    .map((n) => n.role.value);
  const info = await page.evaluate(() => ({
    title: document.title,
    lang: document.documentElement.lang,
    landmarks: [...document.querySelectorAll("main,nav,header,footer,aside,[role=main],[role=navigation],[role=banner],[role=contentinfo],[role=region][aria-label]")].map((e) => `${e.tagName.toLowerCase()}${e.getAttribute("role") ? `[${e.getAttribute("role")}]` : ""}${e.getAttribute("aria-label") ? `"${e.getAttribute("aria-label")}"` : ""}`),
    headings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]")].filter((h) => h.getClientRects().length).map((h) => `${h.tagName}:${h.textContent.trim().slice(0, 40)}`),
    live: [...document.querySelectorAll("[aria-live],[role=status],[role=alert],[role=log]")].map((e) => `${e.tagName.toLowerCase()} live=${e.getAttribute("aria-live") ?? e.getAttribute("role")} "${e.textContent.trim().slice(0, 40)}"`),
    svgsNoName: [...document.querySelectorAll("svg")].filter((s) => s.getAttribute("aria-hidden") !== "true" && !s.closest("[aria-hidden=true]") && !s.getAttribute("aria-label") && !s.querySelector("title") && s.getAttribute("role") !== "presentation" && s.getClientRects().length).length,
    imgsNoAlt: [...document.querySelectorAll("img:not([alt])")].length,
    dialogs: [...document.querySelectorAll("[role=dialog]")].map((d) => `"${d.getAttribute("aria-label")}" labelledby=${d.getAttribute("aria-labelledby")} describedby=${d.getAttribute("aria-describedby")}`),
    pageBehindHidden: (() => {
      const d = document.querySelector("[role=dialog]");
      if (!d) return null;
      const main = document.querySelector("main") ?? document.body.firstElementChild;
      for (let n = main; n; n = n.parentElement) if (n.inert || n.getAttribute("aria-hidden") === "true") return true;
      return false;
    })(),
  }));
  const lines = [
    `# ${label}`,
    `title: ${info.title} | lang: ${info.lang}`,
    `landmarks: ${info.landmarks.join(", ") || "(none)"}`,
    `headings: ${info.headings.join(" | ") || "(none)"}`,
    `live regions: ${info.live.join(" | ") || "(none)"}`,
    `controls with no name: ${unnamed.length ? unnamed.join(", ") : "none"}`,
    `drawings (svg) exposed without a name: ${info.svgsNoName}; images without alt: ${info.imgsNoAlt}`,
    info.dialogs.length ? `panels: ${info.dialogs.join(" ; ")} | page behind hidden from screen readers: ${info.pageBehindHidden}` : "",
  ].filter(Boolean);
  writeFileSync(`${OUT}/${label}.txt`, lines.join("\n") + "\n");
  summary.push(lines.join("\n"));
  console.log(lines.join("\n"));
}

const go = (p) => page.goto(BASE + p, { waitUntil: "networkidle" });
const btn = (n, exact) => page.getByRole("button", { name: n, exact });
const g = `/groups/${data.trip}`;

await go("/"); await capture("home");
await go(g); await capture("group-expenses");
await page.getByRole("tab", { name: "Balances" }).click(); await capture("group-balances");
await btn("Everyone’s balance").click().catch(() => {}); await capture("group-balances-everyone");
await page.getByRole("tab", { name: "Insights" }).click(); await capture("group-insights");
await btn("Show as a table").click().catch(() => {}); await capture("group-insights-table");
await page.getByRole("tab", { name: "Expenses" }).click();
await btn("Add an expense").first().click(); await capture("add-expense");
await page.getByLabel("Amount").first().click().catch(() => {}); await capture("add-expense-keypad");
await page.keyboard.press("Escape"); await page.waitForTimeout(400); await page.keyboard.press("Escape"); await page.waitForTimeout(600);
await go(g);
await btn("Settle up", true).first().click(); await capture("settle-up");
await page.locator('[role="dialog"] button').filter({ hasText: /pays you|^Pay / }).first().click(); await capture("settle-up-picked");
await page.keyboard.press("Escape"); await page.waitForTimeout(600);
await btn(/Dinner at Cervejaria/).first().click(); await capture("expense-details");
await page.keyboard.press("Escape"); await page.waitForTimeout(600);
await go("/friends"); await capture("friends");
await go(`/friends/${data.ravi.id}`); await capture("friend");
await go("/activity"); await capture("activity");
await go("/account"); await capture("you");
await go("/search"); await capture("search");

// What is announced after saving: watch live regions and the toast.
await go(g);
await page.evaluate(() => {
  window.__announced = [];
  new MutationObserver((records) => {
    for (const r of records) {
      const host = (r.target.nodeType === 1 ? r.target : r.target.parentElement)?.closest?.("[aria-live],[role=status],[role=alert]");
      if (host) window.__announced.push(`${host.getAttribute("aria-live") ?? host.getAttribute("role")}: ${host.textContent.trim().slice(0, 80)}`);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
});
await btn("Add an expense").first().click();
await page.waitForTimeout(800);
await page.getByPlaceholder("What was it for?").fill("Tapas");
await page.getByLabel("Amount").first().click();
for (const k of ["4", "8"]) await page.getByLabel("Amount keypad").getByRole("button", { name: k, exact: true }).click();
await btn("Add expense").last().click();
await page.waitForTimeout(3000);
const announced = await page.evaluate(() => [...new Set(window.__announced)]);
summary.push(`# after saving an expense, live regions said:\n${announced.join("\n") || "(nothing)"}`);
console.log("announced after save:", announced);

writeFileSync(`${OUT}/summary.txt`, summary.join("\n\n") + "\n");
await browser.close();
