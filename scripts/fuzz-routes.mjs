/**
 * Bad input at every route (RULES.md V2, V3; OWASP ASVS 5.1).
 *
 * Every route file under src/app/api is found and every method it exports is
 * called, signed out and signed in, with junk in the path, the query and the
 * body: broken and empty JSON, wrong types, huge and negative numbers, long
 * and odd text, prototype tricks. Path ids are tried both as junk and as real
 * ids of the caller's own rows, so validation is reached, not just a 404.
 *
 * What must hold for every answer:
 *   - never a 5xx (503 only from the health check);
 *   - nothing internal in the body: no stack trace, file path, Prisma or
 *     SQLite message;
 *   - an answer within five seconds;
 *   - the server still healthy at the end.
 *
 *   DIVVY_RATE_LIMIT_SCALE=1000 on the server, then
 *   node scripts/fuzz-routes.mjs http://localhost:3000 [path part]
 *
 * About 30,000 calls and half an hour, so it runs by hand rather than in CI.
 * Use a copy of the test database: it leaves a lot of junk behind.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { client } from "./check-accounts.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
/** Optional: only routes whose path contains this, to recheck one fix. */
const ONLY = process.argv[3] ?? "";
const API = join(process.cwd(), "src/app/api");

// ---------------------------------------------------------------------------
// The routes

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/route\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}
const routes = walk(API).flatMap((file) => {
  const path = "/api/" + relative(API, file).replace(/\\/g, "/").replace(/\/?route\.tsx?$/, "");
  const methods = [...readFileSync(file, "utf8").matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  return methods.map((method) => ({ path: path.replace(/\/$/, ""), method }));
}).filter((r) => r.path.includes(ONLY));
// Signing yourself out or deleting yourself would end the run early.
const LAST = (r) => (r.path.startsWith("/api/identity") && r.method === "DELETE" ? 1 : 0);
routes.sort((a, b) => LAST(a) - LAST(b));

// ---------------------------------------------------------------------------
// A signed-in caller with one of everything, so real ids exist

const me = client(BASE);
const meDto = (await me.call("/api/identity", { displayName: "Fuzz", avatarColor: "teal" })).me;
const friend = client(BASE);
const friendDto = (await friend.call("/api/identity", { displayName: "Fuzz friend", avatarColor: "plum" })).me;
const group = (await me.call("/api/groups", { name: "Fuzz", currency: "EUR", placeholderNames: ["Pat"] })).group;
await friend.call(`/api/invite/${(await me.call(`/api/groups/${group.id}`)).group.inviteCode}/join`, {});
const bill = {
  groupId: group.id, description: "Fuzz dinner", amount: "1000", currency: "EUR", splitMode: "EQUAL",
  payers: [{ personId: meDto.id, amount: "1000" }],
  splits: [{ personId: meDto.id, amount: "500" }, { personId: friendDto.id, amount: "500" }],
  attachments: [{ filename: "r.png", mimeType: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" }],
};
const expense = (await me.call("/api/expenses", bill)).expense;
const settlement = await me.call("/api/settlements", { groupId: group.id, fromPersonId: friendDto.id, toPersonId: meDto.id, amount: "100", currency: "EUR" });
await me.call("/api/identity/payment-methods", { kind: "paypal", value: "fuzz" });
/** The caller's own row of the kind a path takes, so validation is reached. */
function realId(path) {
  if (path.startsWith("/api/groups/")) return group.id;
  if (path.startsWith("/api/expenses/")) return expense.id;
  if (path.startsWith("/api/settlements/")) return (settlement.settlement ?? settlement).id;
  if (path.startsWith("/api/attachments/")) return expense.attachments?.[0]?.id ?? null;
  if (path.startsWith("/api/friends/") || path.startsWith("/api/people/")) return friendDto.id;
  if (path.startsWith("/api/invite/")) return meDto.inviteCode;
  return null;
}

// ---------------------------------------------------------------------------
// The junk

const LONG = "x".repeat(5000);
const JUNK_SEGMENTS = ["x", "' OR 1=1--", "..%2F..%2Fetc%2Fpasswd", encodeURIComponent(LONG), "%00", "%F0%9F%92%A5", "null", "-1", "1e309"];
const JUNK_VALUES = [
  null, true, -1, 0, Number.MAX_VALUE * 2, Number.MAX_SAFE_INTEGER * 1000, "", " ", LONG, "-1", "1e9999", "NaN", "Infinity", "99999999999999999999999999999",
  "0.0000000000000000000000001", "<script>alert(1)</script>", "' OR 1=1--", "../../etc/passwd", "\u0000", "💥".repeat(500),
  [], [null], {}, { $gt: "" }, [[[[[[[[[[[]]]]]]]]]]],
];
const FIELDS = ["groupId", "friendId", "personId", "fromPersonId", "toPersonId", "intoPersonId", "amount", "currency", "exchangeRate",
  "description", "name", "displayName", "splitMode", "payers", "splits", "items", "attachments", "date", "expectedUpdatedAt", "kind",
  "value", "code", "rows", "period", "frequency", "startDate", "body", "note", "active", "endsAt", "nextRunAt", "subscription", "id"];

function bodies() {
  const out = [
    { raw: "" }, { raw: "{" }, { raw: "null" }, { raw: "[]" }, { raw: '"text"' }, { raw: "{}" },
    { raw: JSON.stringify({ __proto__: { admin: true }, constructor: { prototype: { admin: true } } }) },
    { raw: "{" + '"a":'.repeat(1) + "[".repeat(5000) + "]".repeat(5000) + "}" },
    { raw: JSON.stringify({ description: "x".repeat(200_000) }) },
    { raw: JSON.stringify({ ...bill, id: undefined }) },
  ];
  for (const field of FIELDS) {
    for (const value of JUNK_VALUES) out.push({ raw: JSON.stringify({ ...bill, [field]: value }) });
  }
  // Each row of a list broken in turn.
  for (const value of JUNK_VALUES.slice(0, 14)) {
    out.push({ raw: JSON.stringify({ ...bill, payers: [{ personId: meDto.id, amount: value }] }) });
    out.push({ raw: JSON.stringify({ ...bill, splits: [{ personId: value, amount: "1000" }] }) });
  }
  return out;
}
const ALL = bodies();
const BASIC = ALL.slice(0, 10);
const QUERIES = ["", "?q=" + LONG, "?q=%00", "?cursor=junk", "?cursor=" + LONG, "?limit=-1", "?limit=1e9", "?base=../x&quote=EUR",
  "?base=USD&quote=" + LONG, "?groupId=' OR 1=1--", "?tz=Mars/Base", "?category=x&person=y", "?from=notadate&to=x"];

// ---------------------------------------------------------------------------

const LEAK = /\n\s+at |node_modules|[A-Z]:\\|\/app\/|prisma|sqlite|SQLITE|PrismaClient|TypeError|ReferenceError|Unexpected token/;
let calls = 0;
const problems = [];

async function hit(who, method, path, raw) {
  calls++;
  const started = Date.now();
  let status, text;
  try {
    const r = await fetch(BASE + path, {
      method,
      headers: {
        ...(raw !== undefined ? { "content-type": "application/json" } : {}),
        ...(who ? { cookie: `divvy_id=${who.cookie}` } : {}),
        "x-forwarded-for": `198.18.90.${(calls % 200) + 1}`,
        origin: BASE,
      },
      body: method === "GET" || method === "HEAD" ? undefined : raw,
      signal: AbortSignal.timeout(15000),
    });
    status = r.status;
    text = await r.text();
  } catch (error) {
    status = -1;
    text = String(error);
  }
  const ms = Date.now() - started;
  const isHealth = path.startsWith("/api/health");
  const bad = [];
  if (status >= 500 && !(isHealth && status === 503)) bad.push(`status ${status}`);
  if (status === -1) bad.push("no answer");
  if (!path.startsWith("/api/attachments") && LEAK.test(text)) bad.push("internal detail in the answer");
  if (ms > 5000) bad.push(`slow (${ms} ms)`);
  if (bad.length) problems.push({ who: who ? "signed in" : "signed out", method, path: path.slice(0, 120), body: (raw ?? "").slice(0, 120), bad, answer: text.slice(0, 200) });
}

for (const { path, method } of routes) {
  // Junk in every id, with the basic broken bodies...
  const hasParams = /\[[^\]]+\]/.test(path);
  if (hasParams) {
    for (const segment of JUNK_SEGMENTS) {
      const url = path.replace(/\[[^\]]+\]/g, segment);
      if (method === "GET" || method === "DELETE") await hit(me, method, url);
      else for (const { raw } of BASIC) { await hit(null, method, url, raw); await hit(me, method, url, raw); }
    }
  }
  // ...then everything at the real path, where validation is reached.
  const id = hasParams ? realId(path) : "";
  if (id !== null) {
    const url = path.replace(/\[[^\]]+\]/g, id);
    if (method === "GET" || method === "DELETE") {
      for (const q of QUERIES) { await hit(null, method, url + q); await hit(me, method, url + q); }
    } else {
      for (const { raw } of BASIC) await hit(null, method, url, raw);
      for (const { raw } of ALL) await hit(me, method, url, raw);
    }
  }
  process.stdout.write(`  ${method.padEnd(6)} ${path}  (${calls} calls so far, ${problems.length} problems)\n`);
}

const health = await fetch(`${BASE}/api/health`).then((r) => r.status).catch(() => 0);
console.log(`\n${routes.length} route methods, ${calls} calls. Server healthy afterwards: ${health === 200 ? "yes" : `no (${health})`}`);
const grouped = new Map();
for (const p of problems) {
  const key = `${p.method} ${p.path.replace(/\?.*/, "")} :: ${p.bad.join(", ")}`;
  if (!grouped.has(key)) grouped.set(key, { ...p, count: 0 });
  grouped.get(key).count++;
}
for (const [key, p] of grouped) console.log(`\nPROBLEM x${p.count}  ${key}\n  as ${p.who}, body ${JSON.stringify(p.body)}\n  answer ${JSON.stringify(p.answer)}`);
console.log(`\n${problems.length === 0 && health === 200 ? "all as expected" : `${grouped.size} kinds of problem`}`);
process.exit(problems.length === 0 && health === 200 ? 0 : 1);
