/**
 * Visual verification.
 *
 * Drives the real app in a real browser at a real phone viewport and captures
 * every screen, in both themes. Screenshots are the only way to catch the class
 * of bug that typechecks fine and looks broken: a clipped safe area, a label
 * colliding with a bar, a sheet that opens behind the tab bar.
 *
 *   node scripts/shots.mjs <recovery-key> [outDir]
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const KEY = process.argv[2];
const OUT = process.argv[3] ?? "./screenshots";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

if (!KEY) {
  console.error("Usage: node scripts/shots.mjs <recovery-key> [outDir]");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

// PLAYWRIGHT_BROWSERS_PATH points at a shared browser pool whose directory is
// versioned, so resolve it rather than hard-coding a path that a browser update
// would break.
function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  const dir = readdirSync(root).find((name) => /^chromium-\d+$/.test(name));
  if (!dir) return undefined;
  const candidate = join(root, dir, "chrome-linux", "chrome");
  return existsSync(candidate) ? candidate : undefined;
}

const browser = await chromium.launch({ executablePath: findChromium() });

const problems = [];

async function run(theme) {
  // iPhone 14 Pro: the primary target, and the viewport where safe-area insets
  // and the bottom tab bar are most likely to collide.
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: theme,
  });

  const page = await context.newPage();
  page.on("pageerror", (error) => problems.push(`[${theme}] page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`[${theme}] console: ${message.text()}`);
  });

  const shot = async (name) => {
    await page.waitForTimeout(650);
    await page.screenshot({ path: `${OUT}/${theme}-${name}.png` });
    console.log(`  ${theme}/${name}`);
  };

  await page.goto(BASE, { waitUntil: "networkidle" });
  await shot("01-welcome");

  await page.getByText("I already have a recovery key").click();
  await page.waitForTimeout(400);
  await page.locator("textarea").fill(KEY);
  await page.getByRole("button", { name: /Restore my account/i }).click();
  await page.waitForTimeout(2600);
  await shot("02-home");

  await page.getByText("Lisbon 2026").first().click();
  await page.waitForTimeout(1700);
  await shot("03-group");

  await page.getByRole("tab", { name: "Balances" }).click();
  await shot("04-balances");

  await page.getByRole("tab", { name: "Insights" }).click();
  await page.waitForTimeout(1100);
  await shot("05-insights");

  await page.getByRole("tab", { name: "Expenses" }).click();
  await page.waitForTimeout(500);
  await page.getByText("Dinner at Cervejaria").click();
  await page.waitForTimeout(900);
  await shot("06-expense-detail");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // The composer, opened from the tab bar's centre button.
  await page.getByRole("button", { name: "Add an expense" }).click();
  await page.waitForTimeout(900);
  await shot("07-composer");

  await page.getByRole("button", { name: /^Split/ }).click().catch(() => {});
  await page.waitForTimeout(300);
  const splitRow = page.locator("button", { hasText: "Split" }).last();
  await splitRow.click().catch(() => {});
  await page.waitForTimeout(900);
  await shot("08-split-editor");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  await page.goto(`${BASE}/activity`, { waitUntil: "networkidle" });
  await shot("09-activity");

  await page.goto(`${BASE}/friends`, { waitUntil: "networkidle" });
  await shot("10-friends");

  await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
  await shot("11-account");

  await page.goto(`${BASE}/search`, { waitUntil: "networkidle" });
  await shot("12-search");

  await page.goto(`${BASE}/join/mango-tiger-42`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await shot("13-join");

  await context.close();
}

async function desktop() {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
  });
  const page = await context.newPage();

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByText("I already have a recovery key").click();
  await page.waitForTimeout(400);
  await page.locator("textarea").fill(KEY);
  await page.getByRole("button", { name: /Restore my account/i }).click();
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${OUT}/desktop-home.png` });
  console.log("  desktop/home");

  await page.getByText("Lisbon 2026").first().click();
  await page.waitForTimeout(1700);
  await page.screenshot({ path: `${OUT}/desktop-group.png` });
  console.log("  desktop/group");

  await context.close();
}

console.log("Capturing screens…");
await run("light");
await run("dark");
await desktop();
await browser.close();

if (problems.length > 0) {
  console.log(`\n${problems.length} runtime problem(s):`);
  for (const problem of [...new Set(problems)]) console.log("  -", problem);
} else {
  console.log("\nNo console or page errors.");
}
