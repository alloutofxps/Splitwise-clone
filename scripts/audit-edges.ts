/**
 * Edge-case probes for features the randomised audit does not reach.
 * Usage: npx tsx scripts/audit-edges.ts [base-url]
 */
const BASE = process.argv[2] ?? "http://localhost:3000";
let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
let n = 60;
function client() {
  let cookie = "";
  const address = `203.0.113.${n++}`;
  const c = {
    id: "",
    async call(path: string, o: { method?: string; body?: unknown; allowError?: boolean; raw?: boolean } = {}) {
      const r = await fetch(`${BASE}${path}`, { method: o.method ?? "GET", headers: { ...(o.body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), "X-Forwarded-For": address }, body: o.body ? JSON.stringify(o.body) : undefined });
      const m = /divvy_id=([^;]*)/.exec(r.headers.get("set-cookie") ?? "");
      if (m) cookie = `divvy_id=${m[1]}`;
      const text = await r.text();
      let body: any = text;
      if (!o.raw) { try { body = text ? JSON.parse(text) : null; } catch { /* keep text */ } }
      if (!r.ok && !o.allowError) throw new Error(`${o.method ?? "GET"} ${path} -> ${r.status} ${text.slice(0, 200)}`);
      return { status: r.status, body };
    },
  };
  return c;
}
const eq = (total: number, ids: string[]) => ids.map((p, i) => ({ personId: p, amount: String(Math.floor(total / ids.length) + (i < total % ids.length ? 1 : 0)) }));

async function main() {
  const A = client(), B = client(), C = client();
  for (const [c, name] of [[A, "Ann"], [B, "Bo"], [C, "Cy"]] as const) c.id = (await c.call("/api/identity", { method: "POST", body: { displayName: name, defaultCurrency: "EUR" } })).body.me.id;
  const g = (await A.call("/api/groups", { method: "POST", body: { name: "Edge", currency: "EUR" } })).body.group;
  await B.call(`/api/invite/${g.inviteCode}/join`, { method: "POST", body: {} });
  await C.call(`/api/invite/${g.inviteCode}/join`, { method: "POST", body: {} });
  const expense = (body: any, who = A) => who.call("/api/expenses", { method: "POST", body: { groupId: g.id, currency: "EUR", splitMode: "EQUAL", ...body } });

  console.log("\nArchiving a group that still has money owed in it");
  await expense({ description: "Hotel", amount: "9000", payers: [{ personId: A.id, amount: "9000" }], splits: eq(9000, [A.id, B.id, C.id]) });
  const before = (await A.call("/api/dashboard")).body;
  await A.call(`/api/groups/${g.id}`, { method: "PATCH", body: { archived: true } });
  const after = (await A.call("/api/dashboard")).body;
  const friendSum = after.friends.reduce((t: bigint, f: any) => t + BigInt(f.net.EUR ?? "0"), 0n);
  check("archiving doesn't make money owed disappear from the home total", after.totals.EUR === before.totals.EUR, `before ${before.totals.EUR}, after ${after.totals.EUR}`);
  check("home total still matches the friends list", BigInt(after.totals.EUR ?? "0") === friendSum, `${after.totals.EUR} vs ${friendSum}`);
  await A.call(`/api/groups/${g.id}`, { method: "PATCH", body: { archived: false } });

  console.log("\nBudgets across currencies");
  const jp = (await A.call("/api/groups", { method: "POST", body: { name: "Japan", currency: "JPY" } })).body.group;
  await B.call(`/api/invite/${jp.inviteCode}/join`, { method: "POST", body: {} });
  await A.call("/api/expenses", { method: "POST", body: { groupId: jp.id, description: "Hotel", amount: "40000", currency: "JPY", splitMode: "EQUAL", payers: [{ personId: A.id, amount: "40000" }], splits: eq(40000, [A.id, B.id]) } });
  await A.call("/api/budgets", { method: "PUT", body: { amount: "100000", currency: "EUR", period: "MONTHLY" } });
  const budgets = (await A.call("/api/budgets?tz=UTC")).body.budgets;
  const all = budgets.find((b: any) => !b.groupId && !b.categoryId);
  // Ann's share: €30 hotel in EUR plus ¥20,000 in yen.
  check("an all-groups budget counts spending in other currencies", BigInt(all.spent) > 3000n, `spent ${all.spent}`);
  check("and says when part of it was converted", Array.isArray(all.convertedFrom) && all.convertedFrom.includes("JPY"), JSON.stringify(all));

  console.log("\nSpreadsheet export");
  await expense({ description: '=HYPERLINK("http://evil","x"), with "quotes"\nand a line', amount: "300", payers: [{ personId: A.id, amount: "300" }], splits: eq(300, [A.id, B.id, C.id]) });
  const csv = (await A.call(`/api/groups/${g.id}/export`, { raw: true })).body as string;
  check("export has a header row", /^Date,/.test(csv.replace(/^\uFEFF/, "")), csv.slice(0, 80));
  check("a description can't run as a spreadsheet formula", !/(^|,)"?=HYPERLINK/m.test(csv), csv.split("\n").find((l) => l.includes("HYPERLINK")) ?? "");
  check("quotes and line breaks stay inside one cell", csv.includes('""quotes""'), "");

  console.log("\nPayments in another currency");
  const usd = await A.call("/api/settlements", { method: "POST", allowError: true, body: { groupId: g.id, fromPersonId: B.id, toPersonId: A.id, amount: "1000", currency: "USD", exchangeRate: "0.9" } });
  check("a payment in dollars into a euro group is accepted with a rate", usd.status < 400, JSON.stringify(usd.body).slice(0, 200));
  if (usd.status < 400) check("and counts as €9.00", usd.body.settlement.convertedAmount === "900", usd.body.settlement.convertedAmount);

  console.log("\nLeaving and coming back");
  const d = (await A.call(`/api/groups/${g.id}`)).body.group;
  const cNet = BigInt(d.balances.net[C.id] ?? "0");
  if (cNet < 0n) await C.call("/api/settlements", { method: "POST", body: { groupId: g.id, fromPersonId: C.id, toPersonId: A.id, amount: String(-cNet), currency: "EUR" } });
  const leave = await C.call(`/api/groups/${g.id}/members/${C.id}`, { method: "DELETE", allowError: true });
  check("someone who is settled up can leave", leave.status < 400, JSON.stringify(leave.body));
  const afterLeave = (await A.call(`/api/groups/${g.id}`)).body.group;
  const sum = Object.values(afterLeave.balances.net as Record<string, string>).reduce((t, v) => t + BigInt(v), 0n);
  check("balances still add up after they leave", sum === 0n, String(sum));
  check("their old expenses still show their name", JSON.stringify(afterLeave).includes("Cy") || (await A.call(`/api/groups/${g.id}/expenses`)).status === 200);
  const rejoin = await C.call(`/api/invite/${g.inviteCode}/join`, { method: "POST", body: {}, allowError: true });
  check("and can rejoin with the same code", rejoin.status < 400, JSON.stringify(rejoin.body).slice(0, 200));

  console.log("\nSearch");
  await expense({ description: "Museum", notes: "tickets for azulejo museum", amount: "1200", payers: [{ personId: A.id, amount: "1200" }], splits: eq(1200, [A.id, B.id]) });
  const s = (await A.call(`/api/search?q=azulejo`)).body;
  check("search finds a word in an expense's note", JSON.stringify(s).includes("Museum"), JSON.stringify(s).slice(0, 200));

  console.log("\nExpense dated in the future");
  const future = new Date(Date.now() + 40 * 86400000).toISOString();
  const fut = await expense({ description: "Next month's tickets", amount: "600", date: future, payers: [{ personId: A.id, amount: "600" }], splits: eq(600, [A.id, B.id]) }).catch((e) => ({ status: 422, body: String(e) }));
  check("a future-dated expense is either accepted or refused with a clear reason", fut.status < 500, JSON.stringify(fut.body).slice(0, 160));

  console.log("\nRemoving someone who has a balance");
  const owe = await A.call(`/api/groups/${g.id}/members/${B.id}`, { method: "DELETE", allowError: true });
  const bNet = (await A.call(`/api/groups/${g.id}`)).body.group.balances.net[B.id];
  check("removing someone who still owes money is refused", bNet === "0" || owe.status >= 400, `status ${owe.status}, net ${bNet}`);

  console.log("\nOne expense with several friends, outside any group");
  const D = client(), F = client();
  D.id = (await D.call("/api/identity", { method: "POST", body: { displayName: "Dee" } })).body.me.id;
  F.id = (await F.call("/api/identity", { method: "POST", body: { displayName: "Fay" } })).body.me.id;
  const codeOf = async (c: ReturnType<typeof client>) => (await c.call("/api/identity")).body.me.inviteCode;
  await A.call(`/api/invite/${await codeOf(D)}/join`, { method: "POST", body: {} });
  await A.call(`/api/invite/${await codeOf(F)}/join`, { method: "POST", body: {} });
  const three = await A.call("/api/expenses", { method: "POST", allowError: true, body: {
    friendId: D.id, description: "Concert tickets", amount: "9000", currency: "EUR", splitMode: "EQUAL",
    payers: [{ personId: A.id, amount: "9000" }], splits: eq(9000, [A.id, D.id, F.id]) } });
  check("Ann can pay for herself and two friends in one expense", three.status < 400, JSON.stringify(three.body).slice(0, 200));
  const annFriends = (await A.call("/api/dashboard")).body.friends;
  const netWith = (list: any[], id: string) => list.find((f) => f.person.id === id)?.directNet?.EUR;
  check("Dee owes Ann €30", netWith(annFriends, D.id) === "3000", String(netWith(annFriends, D.id)));
  check("Fay owes Ann €30", netWith(annFriends, F.id) === "3000", String(netWith(annFriends, F.id)));
  const deeSees = (await D.call("/api/dashboard")).body.friends;
  check("and Dee sees the same €30 from her side", netWith(deeSees, A.id) === "-3000", String(netWith(deeSees, A.id)));
  const strangers = await A.call("/api/expenses", { method: "POST", allowError: true, body: {
    friendId: D.id, description: "Taxi", amount: "6000", currency: "EUR", splitMode: "EQUAL",
    payers: [{ personId: D.id, amount: "6000" }], splits: eq(6000, [A.id, D.id, F.id]) } });
  check("Dee paying for Fay is refused, because they aren't friends", strangers.status === 422, `${strangers.status} ${JSON.stringify(strangers.body).slice(0, 160)}`);
  if (three.status < 400) {
    const existing = (await A.call(`/api/expenses/${three.body.expense.id}`)).body.expense;
    const edit = await A.call(`/api/expenses/${existing.id}`, { method: "PATCH", allowError: true, body: {
      expectedUpdatedAt: existing.updatedAt, description: "Concert tickets (front row)", amount: "12000", currency: "EUR", splitMode: "EQUAL",
      payers: [{ personId: A.id, amount: "12000" }], splits: eq(12000, [A.id, D.id, F.id]) } });
    check("editing it keeps all three people", edit.status < 400, JSON.stringify(edit.body).slice(0, 200));
    const after = (await A.call("/api/dashboard")).body.friends;
    check("and the new amount reaches both friends", netWith(after, D.id) === "4000" && netWith(after, F.id) === "4000", `${netWith(after, D.id)} / ${netWith(after, F.id)}`);
  }

  console.log("\nUnread dots and the Activity badge");
  const P = client(), Q = client(), R = client();
  for (const [c, name] of [[P, "Pia"], [Q, "Quin"], [R, "Rae"]] as const) c.id = (await c.call("/api/identity", { method: "POST", body: { displayName: name, defaultCurrency: "EUR" } })).body.me.id;
  const pg = (await P.call("/api/groups", { method: "POST", body: { name: "Plan", currency: "EUR" } })).body.group;
  await Q.call(`/api/invite/${pg.inviteCode}/join`, { method: "POST", body: {} });
  await R.call(`/api/invite/${pg.inviteCode}/join`, { method: "POST", body: {} });
  await P.call("/api/expenses", { method: "POST", body: { groupId: pg.id, description: "Pia buys Quin lunch", amount: "3000", currency: "EUR", splitMode: "EXACT", payers: [{ personId: P.id, amount: "3000" }], splits: [{ personId: Q.id, amount: "3000" }] } });
  await Q.call("/api/expenses", { method: "POST", body: { groupId: pg.id, description: "Quin buys Rae lunch", amount: "3000", currency: "EUR", splitMode: "EXACT", payers: [{ personId: Q.id, amount: "3000" }], splits: [{ personId: R.id, amount: "3000" }] } });
  await P.call(`/api/invite/${await codeOf(Q)}/join`, { method: "POST", body: {} });
  await P.call("/api/expenses", { method: "POST", body: { friendId: Q.id, description: "Coffee", amount: "400", currency: "EUR", splitMode: "EQUAL", payers: [{ personId: P.id, amount: "400" }], splits: eq(400, [P.id, Q.id]) } });
  const pFeed = (await P.call("/api/activity")).body.items;
  const ownUnread = pFeed.filter((item: any) => item.actorPersonId === P.id && item.isUnread);
  check("your own actions never show as unread", ownUnread.length === 0, `${ownUnread.length} of ${pFeed.length}`);
  const qFeed = (await Q.call("/api/activity")).body.items;
  const qDots = qFeed.filter((item: any) => item.isUnread).length;
  const qBadge = (await Q.call("/api/dashboard")).body.unreadActivityCount;
  check("the badge counts exactly the entries with a dot", qDots === qBadge && qBadge > 0, `dots ${qDots}, badge ${qBadge}`);
  check("an expense outside any group shows as unread too", qFeed.some((item: any) => item.groupId === null && item.isUnread), "");
  await Q.call("/api/activity/read", { method: "POST" });
  const qAfter = (await Q.call("/api/dashboard")).body.unreadActivityCount;
  const qFeedAfter = (await Q.call("/api/activity")).body.items.filter((item: any) => item.isUnread).length;
  check("opening Activity clears the badge, direct entries included", qAfter === 0 && qFeedAfter === 0, `badge ${qAfter}, dots ${qFeedAfter}`);

  console.log("\nWhy a friend's total can differ from the group's plan");
  const pq = (await P.call(`/api/friends/${Q.id}`)).body;
  const planLedger = (pq.ledgers ?? []).find((ledger: any) => ledger.groupId === pg.id);
  check("Quin owes Pia €30 in the group, person to person", planLedger?.net === "3000", JSON.stringify(planLedger));
  check("and the friend page knows the group plan has Quin pay Pia nothing", planLedger?.planned === "0", JSON.stringify(planLedger));
  const direct = (pq.ledgers ?? []).find((ledger: any) => ledger.groupId === null);
  check("a direct balance never carries a plan", direct?.planned === null, JSON.stringify(direct));
  await P.call(`/api/groups/${pg.id}`, { method: "PATCH", body: { simplifyDebts: false } });
  const plain = ((await P.call(`/api/friends/${Q.id}`)).body.ledgers ?? []).find((ledger: any) => ledger.groupId === pg.id);
  check("with simplifying off there is nothing to explain", plain?.planned === null, JSON.stringify(plain));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
