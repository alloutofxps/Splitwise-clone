// RULES S3: on a mid-range phone (processor 4x slower, slow 4G), Home shows
// balances within 2.5s and a tap gets a response within 200ms.
//
//   node scripts/phone-speed.mjs <base-url> [runs]
//
// Also when the whole of Home is there, its groups listed (no limit: for
// comparison). Cold: a first visit, nothing cached. Warm: the next visit, with the
// browser's cache and the service worker. Taps, once Home has settled: the +
// button and opening a group, timed by the browser's own Event Timing (the
// measure behind Interaction to Next Paint). Prints every run and the median.
//
// The live site speaks HTTP/2, which fetches every file at once; `next start`
// speaks HTTP/1.1, six at a time, which makes a first visit look about a
// second slower than it is. For fair numbers put an HTTP/2 relay in front of
// a local server (this machine has one, not in git:
// `node perf-runs/tls/proxy-h2.mjs 3444 3100`) and measure
// https://localhost:3444.
//
// DETAIL=1 also lists, for each tap, the frames over 50ms and the code that
// ran in them, with the time it spent making the browser lay the page out
// again (the Long Animation Frames report).
//
// Seeds its own data: one person, two groups of eight expenses.
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3100";
const RUNS = Number(process.argv[3] ?? 3);
// DevTools' "Slow 4G", the network Lighthouse's mobile run stands for.
const SLOW_4G = { offline: false, latency: 562.5, downloadThroughput: (1474.56 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 };
const LIMITS = { balancesAt: 2500, homeAt: null, plus: 200, group: 200 };

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--ignore-certificate-errors"],
});

async function seed() {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { "X-Forwarded-For": `198.18.42.${Math.floor(Math.random() * 250) + 1}` },
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.evaluate(async () => {
    const post = (path, body) =>
      fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    await post("/api/identity", { displayName: "Priya Shah", avatarColor: "violet" });
    sessionStorage.removeItem("divvy-recovery-key");
    localStorage.removeItem("divvy-recovery-pending");
    for (const [name, people] of [
      ["Lisbon 2026", ["Ravi", "Sam", "Nadia"]],
      ["Flat", ["Jo", "Kit"]],
    ]) {
      const group = (await post("/api/groups", { name, currency: "EUR", placeholderNames: people })).group;
      const all = (await (await fetch(`/api/groups/${group.id}`)).json()).group.members.map((m) => m.id);
      for (let i = 0; i < 8; i++) {
        const amount = 1200 + i * 731;
        await post("/api/expenses", {
          groupId: group.id,
          description: `Cost ${i + 1}`,
          amount: String(amount),
          currency: "EUR",
          splitMode: "EQUAL",
          payers: [{ personId: all[i % all.length], amount: String(amount) }],
          splits: all.map((p, j) => ({ personId: p, amount: String(Math.floor(amount / all.length) + (j < amount % all.length ? 1 : 0)) })),
        });
      }
    }
  });
  const state = await context.storageState();
  await context.close();
  return state;
}

/** Runs in the page from its first moment: when the balance headline shows, and what the taps cost. */
const watch = () => {
  window.__balancesAt = null;
  window.__homeAt = null;
  const look = () => {
    if (window.__homeAt === null && document.querySelector('main a[href^="/groups/"]')) window.__homeAt = performance.now();
    if (window.__balancesAt !== null) return;
    const headline = [...document.querySelectorAll("main h1, main p, main span")].find(
      (el) => /You.re owed|You owe|All settled|Nothing owed/.test(el.textContent || "") && el.getBoundingClientRect().height > 0,
    );
    if (headline) window.__balancesAt = performance.now();
  };
  new MutationObserver(look).observe(document, { childList: true, subtree: true, characterData: true });
  window.__events = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__events.push({ duration: e.duration, id: e.interactionId });
  }).observe({ type: "event", durationThreshold: 16, buffered: true });
  window.__frames = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries())
      window.__frames.push({
        duration: e.duration,
        scripts: e.scripts.map((s) => ({
          duration: s.duration,
          layout: s.forcedStyleAndLayoutDuration,
          who: `${s.invokerType}:${s.invoker}`.slice(0, 60),
          file: (s.sourceURL || "").split("/").pop(),
          fn: s.sourceFunctionName,
        })),
      });
  }).observe({ type: "long-animation-frame", buffered: true });
};

async function visit(state, warm) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    storageState: state,
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  await page.addInitScript(watch);
  if (warm) {
    // A first visit fills the cache and lets the service worker take over.
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
  }
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", SLOW_4G);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(() => window.__balancesAt !== null && window.__homeAt !== null, null, { timeout: 30000 }).catch(() => {});
  const { balancesAt, homeAt } = await page.evaluate(() => ({ balancesAt: window.__balancesAt, homeAt: window.__homeAt }));
  await page.waitForTimeout(3500);
  const detail = [];
  const tap = async (label, locator) => {
    await page.evaluate(() => {
      window.__events = [];
      window.__frames = [];
    });
    await locator.tap();
    await page.waitForTimeout(2500);
    const { events, frames } = await page.evaluate(() => ({ events: window.__events, frames: window.__frames }));
    detail.push({ label, frames });
    return Math.max(0, ...events.filter((e) => e.id).map((e) => e.duration));
  };
  const plus = await tap("tap +", page.getByRole("button", { name: "Add an expense" }).last());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
  const group = await tap("tap a group", page.getByRole("link", { name: /Lisbon 2026/ }).first());
  await context.close();
  return { balancesAt, homeAt, plus, group, detail };
}

const median = (values) => {
  const sorted = values.filter((v) => v !== null).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const ms = (v) => (v === null ? "none" : `${Math.round(v)}ms`);

const state = await seed();
let failed = false;
for (const warm of [false, true]) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await visit(state, warm));
  console.log(warm ? "Next visit (cached)" : "First visit (nothing cached)");
  for (const [key, label] of [
    ["balancesAt", "balances on screen"],
    ["homeAt", "all of Home"],
    ["plus", "tap +"],
    ["group", "tap a group"],
  ]) {
    const middle = median(runs.map((r) => r[key]));
    const runsText = runs.map((r) => ms(r[key])).join(", ");
    if (LIMITS[key] === null) {
      console.log(`  ${label}: ${ms(middle)} (${runsText})`);
      continue;
    }
    const pass = middle !== null && middle <= LIMITS[key];
    if (!pass) failed = true;
    console.log(`  ${label}: ${ms(middle)} (${runsText}), limit ${LIMITS[key]}ms, ${pass ? "passes" : "FAILS"}`);
  }
  if (process.env.DETAIL)
    for (const [i, run] of runs.entries())
      for (const { label, frames } of run.detail) {
        console.log(`  run ${i + 1}, ${label}: ${frames.length} frames over 50ms`);
        for (const f of frames)
          console.log(
            `    ${Math.round(f.duration)}ms ` +
              f.scripts
                .filter((s) => s.duration > 5)
                .map((s) => `[${Math.round(s.duration)}ms ${s.who} ${s.file} ${s.fn || ""}${s.layout ? ` layout ${Math.round(s.layout)}ms` : ""}]`)
                .join(" "),
          );
      }
}
await browser.close();
process.exitCode = process.env.STRICT && failed ? 1 : 0;
