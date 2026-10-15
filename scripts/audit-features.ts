/**
 * Checks the Splitwise-parity features end to end against a running server:
 * a group's usual split, paying in another currency, and importing a
 * Splitwise export.
 *
 * Usage: npx tsx scripts/audit-features.ts [base-url]
 */
import { convert, exactRate } from "../src/lib/money";
import { parseSplitwiseExport } from "../src/lib/splitwise-import";

const BASE = process.argv[2] ?? "http://localhost:3000";
let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
let n = 170;
function client() {
  let cookie = "";
  const address = `203.0.113.${n++}`;
  return {
    id: "",
    async call(path: string, o: { method?: string; body?: unknown; allowError?: boolean } = {}) {
      const r = await fetch(`${BASE}${path}`, { method: o.method ?? "GET", headers: { ...(o.body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), "X-Forwarded-For": address }, body: o.body ? JSON.stringify(o.body) : undefined });
      const m = /divvy_id=([^;]*)/.exec(r.headers.get("set-cookie") ?? "");
      if (m) cookie = `divvy_id=${m[1]}`;
      const text = await r.text();
      let body: any = text;
      try { body = text ? JSON.parse(text) : null; } catch { /* keep text */ }
      if (!r.ok && !o.allowError) throw new Error(`${o.method ?? "GET"} ${path} -> ${r.status} ${text.slice(0, 200)}`);
      return { status: r.status, body };
    },
  };
}

async function main() {
  const A = client(), B = client();
  A.id = (await A.call("/api/identity", { method: "POST", body: { displayName: "Ana", defaultCurrency: "EUR" } })).body.me.id;
  B.id = (await B.call("/api/identity", { method: "POST", body: { displayName: "Ben" } })).body.me.id;
  const g = (await A.call("/api/groups", { method: "POST", body: { name: "Couple", currency: "EUR" } })).body.group;
  await B.call(`/api/invite/${g.inviteCode}/join`, { method: "POST", body: {} });

  console.log("\nA group's usual split");
  const bad = await A.call(`/api/groups/${g.id}`, { method: "PATCH", allowError: true, body: { defaultSplit: { mode: "PERCENT", entries: [{ personId: A.id, value: 60 }, { personId: B.id, value: 30 }] } } });
  check("percentages that don't add up to 100 are refused, with the reason", bad.status === 422 && /90%/.test(JSON.stringify(bad.body)), JSON.stringify(bad.body).slice(0, 160));
  await A.call(`/api/groups/${g.id}`, { method: "PATCH", body: { defaultSplit: { mode: "PERCENT", entries: [{ personId: A.id, value: 60 }, { personId: B.id, value: 40 }] } } });
  const saved = (await B.call(`/api/groups/${g.id}`)).body.group.defaultSplit;
  check("a 60/40 split is saved and everyone in the group sees it", saved?.mode === "PERCENT" && saved.entries.length === 2, JSON.stringify(saved));
  const stranger = client();
  stranger.id = (await stranger.call("/api/identity", { method: "POST", body: { displayName: "Zed" } })).body.me.id;
  const outsider = await A.call(`/api/groups/${g.id}`, { method: "PATCH", allowError: true, body: { defaultSplit: { mode: "SHARES", entries: [{ personId: stranger.id, value: 1 }] } } });
  check("someone outside the group can't be put in it", outsider.status === 422, String(outsider.status));
  const feed = (await B.call("/api/activity")).body;
  check("the change shows in the activity feed", JSON.stringify(feed).includes("usual split"), "");
  await A.call(`/api/groups/${g.id}`, { method: "PATCH", body: { defaultSplit: null } });
  check("and it can go back to equal", (await A.call(`/api/groups/${g.id}`)).body.group.defaultSplit === null);

  console.log("\nPaying a euro debt in dollars");
  await A.call("/api/expenses", { method: "POST", body: { groupId: g.id, description: "Dinner", amount: "4000", currency: "EUR", splitMode: "EQUAL", payers: [{ personId: A.id, amount: "4000" }], splits: [{ personId: A.id, amount: "2000" }, { personId: B.id, amount: "2000" }] } });
  const owed = 2000n;
  const rate = (await B.call(`/api/rates?base=USD&quote=EUR`)).body.rate?.rate as string | undefined;
  check("today's dollar rate is available", Boolean(rate), String(rate));
  const usd = convert(owed, "EUR", "USD", (1 / Number(rate ?? "0.92")).toFixed(12));
  const pay = await B.call("/api/settlements", { method: "POST", allowError: true, body: { groupId: g.id, fromPersonId: B.id, toPersonId: A.id, amount: usd.toString(), currency: "USD", exchangeRate: exactRate(owed, "EUR", usd, "USD") } });
  check(`Ben pays $${Number(usd) / 100} for the €20 he owed`, pay.status === 201, JSON.stringify(pay.body).slice(0, 200));
  const after = (await A.call(`/api/groups/${g.id}`)).body.group.balances.net;
  check("and the debt is cleared exactly, not a cent left", (after[A.id] ?? "0") === "0" && (after[B.id] ?? "0") === "0", JSON.stringify(after));

  console.log("\nImporting from Splitwise");
  const csv = [
    "Date,Description,Category,Cost,Currency,Ana Lima,Ben Ortiz,Cy",
    "2026-03-01,Dinner,Dining out,90.00,EUR,60.00,-30.00,-30.00",
    '2026-03-02,"Tickets, museum",Entertainment - Other,45.00,EUR,-15.00,30.00,-15.00',
    "2026-03-03,Ben paid Ana,Payment,30.00,EUR,-30.00,30.00,0.00",
    "2026-03-04,Taxi,Taxi,10.01,EUR,5.00,-5.00,-0.01",
    "2026-03-05,Car hire,Car,100.00,USD,0.00,-50.00,50.00",
    "2026-03-06,Hotel paid by two,Hotel,300.00,EUR,100.00,50.00,-150.00",
    "",
    "2026-03-31,Total balance, , ,EUR,120.00,5.00,-195.01",
  ].join("\n");
  const parsed = parseSplitwiseExport(csv);
  const imported = await A.call("/api/import/splitwise", { method: "POST", allowError: true, body: {
    name: "Lisbon (from Splitwise)", currency: "EUR",
    people: parsed.people.map((name, i) => ({ name, isMe: i === 0 })),
    rows: parsed.rows,
  } });
  check("the file imports", imported.status === 201, JSON.stringify(imported.body).slice(0, 240));
  if (imported.status === 201) {
    check("it counts 5 expenses and 1 payment", imported.body.imported.expenses === 5 && imported.body.imported.payments === 1, JSON.stringify(imported.body.imported));
    const detail = (await A.call(`/api/groups/${imported.body.group.id}`)).body.group;
    const byName = new Map(detail.members.map((m: any) => [m.displayName, m.id]));
    check("Ana is the person importing, not a copy of her", byName.get("Ana") === A.id || detail.members.some((m: any) => m.id === A.id), JSON.stringify([...byName.keys()]));
    check("Ben and Cy are added by name", byName.has("Ben Ortiz") && byName.has("Cy"));
    const net = detail.balances.net as Record<string, string>;
    // Euro rows: Ana 60-15-30+5+100 = 120.00, plus the cent from the taxi row
    // (which is a cent off zero, and the biggest entry absorbs it); Ben
    // -30+30+30-5+50 = 75.00; Cy -30-15-0.01-150 = -195.01. The dollar row then
    // moves $50 from Ben to Cy at today's rate.
    const eurOnly = { ana: 12001n, ben: 7500n, cy: -19501n };
    const usdShift = convert(5000n, "USD", "EUR", rate ?? "0.92");
    check("Ana's balance matches the file", BigInt(net[A.id]) === eurOnly.ana, `${net[A.id]}`);
    check("Ben's matches, with the dollar row at today's rate", BigInt(net[byName.get("Ben Ortiz") as string]) === eurOnly.ben - usdShift, `${net[byName.get("Ben Ortiz") as string]} vs ${eurOnly.ben - usdShift}`);
    const total = Object.values(net).reduce((t, v) => t + BigInt(v), 0n);
    check("and the balances add up to zero", total === 0n, String(total));
    const items = (await A.call(`/api/groups/${imported.body.group.id}/expenses`)).body.items;
    check("a description with a comma survives", JSON.stringify(items).includes("Tickets, museum"));
    check("Splitwise categories become ours", items.some((i: any) => i.expense?.description === "Hotel paid by two" && i.expense.categoryId === "accommodation"));
  }
  const notMe = await A.call("/api/import/splitwise", { method: "POST", allowError: true, body: { name: "x", currency: "EUR", people: parsed.people.map((name) => ({ name, isMe: false })), rows: parsed.rows } });
  check("an import where nobody is you is refused", notMe.status === 422 && /which name/i.test(JSON.stringify(notMe.body)), JSON.stringify(notMe.body).slice(0, 120));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
