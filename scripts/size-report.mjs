// What a phone downloads on a cold first visit to Home and to a group page:
// compressed bytes over the wire, per resource type (MOTION-SPEC 7).
//
//   node scripts/size-report.mjs <base-url>
//
// A fresh browser profile each time, cache off and the service worker
// blocked, so nothing comes from a cache. Counts everything fetched until the
// network has been quiet for 500ms, then 1.5s more, so link prefetches and
// lazily loaded pieces are included: that is what the phone really pays for.
// Scripts are also split into those that finished before the page's load event
// (needed to show the screen) and those after (fetched early for the next one).
// DETAIL=1 also lists every script with its size, on stderr.
//
// ScriptRaw and ScriptRawAfterLoad are the same scripts uncompressed. The
// compressed figures can move by about 0.6 KB with no code change: the build
// numbers its pieces differently in another folder, or after unrelated server
// code changes, and the numbers compress a little better or worse. The
// uncompressed figures only move when code really changes, so check them
// whenever a result is that close to a limit (PERF-BASELINE 21).
//
// Seeds its own data: two people, one group, one expense.
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3100";

let ip = 10 + Math.floor(Math.random() * 200);
function client() {
  let cookie = "";
  const address = `198.19.${Math.floor(Math.random() * 250)}.${ip++ % 250}`;
  return {
    id: "",
    get cookie() {
      return cookie;
    },
    async call(path, body) {
      const r = await fetch(BASE + path, {
        method: body ? "POST" : "GET",
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: `divvy_id=${cookie}` } : {}),
          "X-Forwarded-For": address,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const m = /divvy_id=([^;]*)/.exec(r.headers.get("set-cookie") ?? "");
      if (m) cookie = m[1];
      const text = await r.text();
      if (!r.ok) throw new Error(`${path} -> ${r.status} ${text.slice(0, 160)}`);
      return text ? JSON.parse(text) : null;
    },
  };
}

const me = client();
const ravi = client();
me.id = (await me.call("/api/identity", { displayName: "Priya Shah", avatarColor: "violet", defaultCurrency: "EUR" })).me.id;
ravi.id = (await ravi.call("/api/identity", { displayName: "Ravi Kumar", avatarColor: "cobalt", defaultCurrency: "EUR" })).me.id;
const trip = (await me.call("/api/groups", { name: "Lisbon 2026", currency: "EUR", emoji: "🌴" })).group;
await ravi.call(`/api/invite/${trip.inviteCode}/join`, {});
await me.call("/api/expenses", {
  groupId: trip.id,
  description: "Dinner",
  amount: "9600",
  currency: "EUR",
  splitMode: "EQUAL",
  payers: [{ personId: me.id, amount: "9600" }],
  splits: [
    { personId: me.id, amount: "4800" },
    { personId: ravi.id, amount: "4800" },
  ],
});

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const kb = (bytes) => +(bytes / 1000).toFixed(1);
const report = {};
for (const [name, path] of [
  ["Home", "/"],
  ["Group", `/groups/${trip.id}`],
]) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await context.addCookies([{ name: "divvy_id", value: me.cookie, url: BASE }]);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const seen = new Map();
  const raw = new Map();
  const totals = {};
  const scripts = [];
  let loaded = false;
  let scriptsAfterLoad = 0;
  let scriptsRaw = 0;
  let scriptsRawAfterLoad = 0;
  page.on("load", () => (loaded = true));
  cdp.on("Network.responseReceived", (e) => seen.set(e.requestId, { type: e.type, url: e.response.url.replace(BASE, "") }));
  cdp.on("Network.dataReceived", (e) => raw.set(e.requestId, (raw.get(e.requestId) ?? 0) + e.dataLength));
  cdp.on("Network.loadingFinished", (e) => {
    const { type, url } = seen.get(e.requestId) ?? { type: "Other", url: "?" };
    totals[type] = (totals[type] ?? 0) + e.encodedDataLength;
    if (type !== "Script") return;
    const rawBytes = raw.get(e.requestId) ?? 0;
    scripts.push([kb(e.encodedDataLength), kb(rawBytes), url + (loaded ? "  (after load)" : "")]);
    scriptsRaw += rawBytes;
    if (loaded) {
      scriptsAfterLoad += e.encodedDataLength;
      scriptsRawAfterLoad += rawBytes;
    }
  });
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  report[name] = Object.fromEntries(Object.entries(totals).map(([type, bytes]) => [type, kb(bytes)]));
  report[name].ScriptAfterLoad = kb(scriptsAfterLoad);
  report[name].ScriptRaw = kb(scriptsRaw);
  report[name].ScriptRawAfterLoad = kb(scriptsRawAfterLoad);
  if (process.env.DETAIL) {
    console.error(`${name}:`);
    for (const [size, rawSize, url] of scripts.sort((a, b) => b[0] - a[0]))
      console.error(`  ${String(size).padStart(6)} kB  ${String(rawSize).padStart(6)} kB raw  ${url}`);
  }
  await context.close();
}
console.log(JSON.stringify(report));
await browser.close();
