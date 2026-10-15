/**
 * Randomised money audit.
 *
 * Five people, three groups in currencies with 2, 0 and 3 decimals, a
 * placeholder member, a direct friendship, every split mode, several payers,
 * foreign-currency expenses, edits, deletes, restores and payments - in a
 * seeded random order. After every step it checks the rules that must hold
 * however the money moved:
 *
 *   - every group's balances sum to zero;
 *   - each person's balance is what they paid minus what they owe, recomputed
 *     here from the expense list rather than trusted from the server;
 *   - both the literal and the simplified debt lists produce those balances;
 *   - the group card, the dashboard total and the friend page agree;
 *   - two friends see the same debt from opposite sides.
 *
 * Usage: npx tsx scripts/audit-invariants.ts [base-url] [steps] [seed]
 */
import { resolveSplit, convertedBreakdown, type SplitMode, type SplitParticipant } from "../src/lib/split";

const BASE = process.argv[2] ?? "http://localhost:3000";
const STEPS = Number(process.argv[3] ?? 250);
let seed = Number(process.argv[4] ?? 20261015);

function rand(): number {
  // mulberry32: small, seeded, reproducible.
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const shuffle = <T>(xs: T[]) => [...xs].sort(() => rand() - 0.5);

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

let nextAddress = 10;
function client() {
  let cookie = "";
  const address = `198.51.100.${nextAddress++}`;
  return {
    id: "",
    name: "",
    async call(path: string, options: { method?: string; body?: unknown; allowError?: boolean } = {}) {
      const response = await fetch(`${BASE}${path}`, {
        method: options.method ?? "GET",
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          "X-Forwarded-For": address,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const set = response.headers.get("set-cookie");
      const m = set && /divvy_id=([^;]*)/.exec(set);
      if (m) cookie = `divvy_id=${m[1]}`;
      const text = await response.text();
      let body: any;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      if (!response.ok && !options.allowError) {
        throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${JSON.stringify(body)}`);
      }
      return { status: response.status, body };
    },
  };
}
type Client = ReturnType<typeof client>;

const decimalsOf: Record<string, number> = { EUR: 2, USD: 2, JPY: 0, KWD: 3 };

interface GroupState { id: string; currency: string; members: string[]; inviteCode: string }

async function main() {
  console.log(`Randomised money audit against ${BASE}: ${STEPS} steps, seed ${seed}`);
  const names = ["Asha", "Ben", "Chen", "Dev", "Eli"];
  const people: Client[] = [];
  for (const name of names) {
    const c = client();
    const r = await c.call("/api/identity", { method: "POST", body: { displayName: name, defaultCurrency: "EUR" } });
    c.id = r.body.me.id;
    c.name = name;
    people.push(c);
  }
  const [A, B, C, D, E] = people;
  const byId = new Map(people.map((p) => [p.id, p]));

  async function makeGroup(owner: Client, name: string, currency: string, joiners: Client[], ghosts: string[] = []) {
    const g = (await owner.call("/api/groups", { method: "POST", body: { name, currency, placeholderNames: ghosts } })).body.group;
    for (const j of joiners) await j.call(`/api/invite/${g.inviteCode}/join`, { method: "POST", body: {} });
    const detail = (await owner.call(`/api/groups/${g.id}`)).body.group;
    return { id: g.id, currency, inviteCode: g.inviteCode, members: detail.members.map((m: any) => m.id) };
  }
  const trip = await makeGroup(A, "Trip", "EUR", [B, C, D], ["Ghost"]);
  const tokyo = await makeGroup(A, "Tokyo", "JPY", [B, E]);
  const kuwait = await makeGroup(C, "Kuwait", "KWD", [A, D]);
  const groups = [trip, tokyo, kuwait];
  // A direct friendship, outside any group.
  const eMe = (await E.call("/api/identity")).body.me;
  await A.call(`/api/invite/${eMe.inviteCode}/join`, { method: "POST", body: {} });

  const realMembers = (g: GroupState) => g.members.filter((id) => byId.has(id));
  const live = new Map<string, { groupId: string | null; actor: Client }>();
  const deleted: { id: string; actor: Client }[] = [];
  const ops: Record<string, number> = {};
  const bump = (k: string) => (ops[k] = (ops[k] ?? 0) + 1);

  function buildSplit(mode: SplitMode, total: bigint, members: string[], payerIds: string[]) {
    const chosen = shuffle(members).slice(0, int(1, members.length));
    let participants: SplitParticipant[] = [];
    let items: { id: string; amount: bigint; participantIds: string[] }[] | undefined;
    if (mode === "EQUAL") participants = members.map((id) => ({ personId: id, included: chosen.includes(id) }));
    if (mode === "EXACT") {
      let left = total;
      participants = chosen.map((id, i) => {
        const amount = i === chosen.length - 1 ? left : BigInt(Math.floor(Number(left) * rand()));
        left -= amount;
        return { personId: id, amount };
      });
    }
    if (mode === "PERCENT") {
      let left = 10000;
      participants = chosen.map((id, i) => {
        const bp = i === chosen.length - 1 ? left : Math.floor(left * rand());
        left -= bp;
        return { personId: id, percent: bp / 100 };
      });
    }
    if (mode === "SHARES") participants = chosen.map((id) => ({ personId: id, weight: int(1, 3) }));
    if (mode === "ADJUSTMENT") {
      let room = total / 2n;
      participants = chosen.map((id) => {
        const adj = rand() < 0.5 ? 0n : BigInt(Math.floor(Number(room) * rand() * 0.5));
        room -= adj;
        return { personId: id, adjustment: adj };
      });
    }
    if (mode === "ITEMIZED") {
      participants = members.map((id) => ({ personId: id, included: chosen.includes(id) }));
      const n = int(1, 4);
      let room = total;
      items = Array.from({ length: n }, (_, i) => {
        const amount = BigInt(Math.floor(Number(room) * rand() * 0.6));
        room -= amount;
        return { id: `i${i}`, amount, participantIds: shuffle(chosen).slice(0, int(1, chosen.length)) };
      });
    }
    const result = resolveSplit({ mode, total, participants, payerIds, items });
    return { result, items };
  }

  function payersFor(total: bigint, members: string[]) {
    const ids = shuffle(members).slice(0, int(1, Math.min(3, members.length)));
    let left = total;
    return ids.map((id, i) => {
      const amount = i === ids.length - 1 ? left : BigInt(Math.floor(Number(left) * rand()));
      left -= amount;
      return { personId: id, amount: amount.toString() };
    });
  }

  async function postExpense(actor: Client, target: { groupId?: string; friendId?: string }, members: string[], currency: string, existing?: any) {
    const modes: SplitMode[] = ["EQUAL", "EXACT", "PERCENT", "SHARES", "ADJUSTMENT", "ITEMIZED"];
    const mode = pick(modes);
    const dec = decimalsOf[currency];
    const total = BigInt(int(1, 9000) * 10 ** Math.max(0, dec - 1) + int(0, 9));
    const payers = payersFor(total, members);
    const { result, items } = buildSplit(mode, total, members, payers.map((p) => p.personId));
    if (result.errors.length) return null;
    const groupCurrency = target.groupId ? groups.find((g) => g.id === target.groupId)!.currency : currency;
    let expenseCurrency = currency;
    let exchangeRate: string | undefined;
    if (groupCurrency === "EUR" && rand() < 0.2) {
      expenseCurrency = "USD";
      exchangeRate = (0.85 + rand() * 0.1).toFixed(4);
    }
    const body: any = {
      ...(existing ? { id: existing.id, expectedUpdatedAt: existing.updatedAt } : {}),
      ...target,
      description: `${mode.toLowerCase()} ${int(1, 999)}`,
      amount: total.toString(),
      currency: expenseCurrency,
      ...(exchangeRate ? { exchangeRate } : {}),
      splitMode: mode,
      payers,
      splits: result.splits.map((s) => ({
        personId: s.personId,
        amount: s.amount.toString(),
        included: s.included,
        weight: s.weight ?? null,
        percent: s.percent ?? null,
        adjustment: s.adjustment != null ? s.adjustment.toString() : null,
      })),
      ...(items ? { items: items.map((it, i) => ({ name: `item ${i}`, amount: it.amount.toString(), participantIds: it.participantIds })) } : {}),
    };
    const r = existing
      ? await actor.call(`/api/expenses/${existing.id}`, { method: "PATCH", body, allowError: true })
      : await actor.call("/api/expenses", { method: "POST", body, allowError: true });
    if (r.status >= 400) {
      // A refusal is only acceptable when it says something a person could act on.
      check(`${mode} expense accepted`, false, `${r.status} ${JSON.stringify(r.body).slice(0, 220)}`);
      return null;
    }
    return r.body.expense ?? r.body;
  }

  async function allItems(viewer: Client, groupId: string) {
    const out: any[] = [];
    let cursor: string | null = null;
    do {
      const r: any = (await viewer.call(`/api/groups/${groupId}/expenses${cursor ? `?before=${encodeURIComponent(cursor)}` : ""}`)).body;
      out.push(...r.items.map((x: any) => x.kind === "expense" ? x.expense : x.settlement));
      cursor = r.nextCursor;
    } while (cursor);
    return out;
  }

  async function checkGroup(g: GroupState, label: string) {
    const viewer = byId.get(realMembers(g)[0])!;
    const detail = (await viewer.call(`/api/groups/${g.id}`)).body.group;
    const net: Record<string, string> = detail.balances.net;
    const sumNet = Object.values(net).reduce((t, v) => t + BigInt(v), 0n);
    check(`${label}: balances sum to zero`, sumNet === 0n, `sum=${sumNet}`);

    // Recompute from the list.
    const items = await allItems(viewer, g.id);
    const mine = new Map<string, bigint>();
    const add = (id: string, v: bigint) => mine.set(id, (mine.get(id) ?? 0n) + v);
    let spend = 0n;
    for (const it of items) {
      const isSettlement = "fromPersonId" in it;
      if (isSettlement) {
        add(it.fromPersonId, BigInt(it.convertedAmount));
        add(it.toPersonId, -BigInt(it.convertedAmount));
        continue;
      }
      const sp = it.payers.reduce((t: bigint, p: any) => t + BigInt(p.amount), 0n);
      const ss = it.splits.reduce((t: bigint, s: any) => t + BigInt(s.amount), 0n);
      check(`${label}: payers add up to the amount (${it.splitMode})`, sp === BigInt(it.amount), `${sp} vs ${it.amount}`);
      check(`${label}: shares add up to the amount (${it.splitMode})`, ss === BigInt(it.amount), `${ss} vs ${it.amount}`);
      const conv = convertedBreakdown({
        amount: BigInt(it.amount),
        convertedAmount: BigInt(it.convertedAmount),
        payers: it.payers.map((p: any) => ({ personId: p.personId, amount: BigInt(p.amount) })),
        splits: it.splits.map((s: any) => ({ personId: s.personId, amount: BigInt(s.amount) })),
      } as any);
      for (const p of conv.paid) add(p.personId, p.amount);
      for (const s of conv.owed) add(s.personId, -s.amount);
      spend += BigInt(it.convertedAmount);
    }
    const ids = new Set([...Object.keys(net), ...mine.keys()]);
    let diffs = 0;
    for (const id of ids) if ((mine.get(id) ?? 0n) !== BigInt(net[id] ?? "0")) diffs++;
    check(`${label}: balances match the expense list`, diffs === 0, JSON.stringify({ server: net, recomputed: Object.fromEntries([...mine].map(([k, v]) => [k, v.toString()])) }).slice(0, 300));
    check(`${label}: total spend matches the list`, BigInt(detail.balances.totalSpend) === spend, `${detail.balances.totalSpend} vs ${spend}`);

    for (const kind of ["pairwise", "simplified"] as const) {
      const fromEdges = new Map<string, bigint>();
      for (const e of detail.balances[kind]) {
        check(`${label}: ${kind} edges are positive`, BigInt(e.amount) > 0n, e.amount);
        fromEdges.set(e.toPersonId, (fromEdges.get(e.toPersonId) ?? 0n) + BigInt(e.amount));
        fromEdges.set(e.fromPersonId, (fromEdges.get(e.fromPersonId) ?? 0n) - BigInt(e.amount));
      }
      let bad = 0;
      for (const id of ids) if ((fromEdges.get(id) ?? 0n) !== BigInt(net[id] ?? "0")) bad++;
      check(`${label}: ${kind} debts settle everyone exactly`, bad === 0);
    }
    const realCount = Object.values(net).filter((v) => v !== "0").length;
    check(`${label}: simplified uses at most n-1 payments`, detail.balances.simplified.length <= Math.max(0, realCount - 1), `${detail.balances.simplified.length} for ${realCount}`);

    for (const id of realMembers(g)) {
      const summary = (await byId.get(id)!.call("/api/dashboard")).body.groups.find((x: any) => x.id === g.id);
      check(`${label}: ${byId.get(id)!.name}'s group card matches the balance`, summary && summary.yourNet === (net[id] ?? "0"), `${summary?.yourNet} vs ${net[id]}`);
    }
    return detail;
  }

  async function checkPeople(label: string) {
    for (const me of people) {
      const dash = (await me.call("/api/dashboard")).body;
      const expected = new Map<string, bigint>();
      for (const g of dash.groups) expected.set(g.currency, (expected.get(g.currency) ?? 0n) + BigInt(g.yourNet));
      for (const f of dash.friends) for (const [cur, v] of Object.entries(f.directNet as Record<string, string>)) expected.set(cur, (expected.get(cur) ?? 0n) + BigInt(v));
      for (const cur of new Set([...expected.keys(), ...Object.keys(dash.totals)])) {
        check(`${label}: ${me.name}'s home total in ${cur} adds up`, (expected.get(cur) ?? 0n) === BigInt(dash.totals[cur] ?? "0"), `${expected.get(cur)} vs ${dash.totals[cur]}`);
      }
      for (const f of dash.friends) {
        const other = byId.get(f.person.id);
        if (!other) continue;
        const theirs = (await other.call("/api/dashboard")).body.friends.find((x: any) => x.person.id === me.id);
        for (const cur of new Set([...Object.keys(f.net), ...Object.keys(theirs?.net ?? {})])) {
          const a = BigInt(f.net[cur] ?? "0");
          const b = BigInt(theirs?.net?.[cur] ?? "0");
          check(`${label}: ${me.name} and ${other.name} agree on ${cur}`, a === -b, `${a} vs ${b}`);
        }
        const page = (await me.call(`/api/friends/${f.person.id}`)).body;
        for (const cur of new Set([...Object.keys(f.net), ...Object.keys(page.combined)])) {
          check(`${label}: ${me.name}'s friend page for ${other.name} matches the list (${cur})`, (f.net[cur] ?? "0") === (page.combined[cur] ?? "0"), `${f.net[cur]} vs ${page.combined[cur]}`);
        }
      }
    }
  }

  for (let step = 1; step <= STEPS; step++) {
    const r = rand();
    const g = pick(groups);
    const members = g.members;
    const actor = byId.get(pick(realMembers(g)))!;
    try {
      if (r < 0.45) {
        const e = await postExpense(actor, { groupId: g.id }, members, g.currency);
        if (e) { live.set(e.id, { groupId: g.id, actor }); bump("expense"); }
      } else if (r < 0.55 && live.size) {
        const [id, info] = pick([...live.entries()].filter(([, v]) => v.groupId));
        const grp = groups.find((x) => x.id === info.groupId)!;
        const current = (await info.actor.call(`/api/expenses/${id}`)).body.expense;
        const e = await postExpense(info.actor, { groupId: grp.id }, grp.members, grp.currency, current);
        if (e) bump("edit");
      } else if (r < 0.62 && live.size) {
        const [id, info] = pick([...live.entries()]);
        await info.actor.call(`/api/expenses/${id}`, { method: "DELETE" });
        live.delete(id);
        deleted.push({ id, actor: info.actor });
        bump("delete");
      } else if (r < 0.65 && deleted.length) {
        const d = deleted.splice(int(0, deleted.length - 1), 1)[0];
        const res = await d.actor.call(`/api/expenses/${d.id}/restore`, { method: "POST", allowError: true });
        if (res.status < 400) { live.set(d.id, { groupId: res.body.expense?.groupId ?? null, actor: d.actor }); bump("restore"); }
      } else if (r < 0.8) {
        const detail = (await actor.call(`/api/groups/${g.id}`)).body.group;
        const edges = detail.balances.pairwise.filter((e: any) => byId.has(e.fromPersonId) && byId.has(e.toPersonId));
        if (edges.length) {
          const e: any = pick(edges);
          const payer = byId.get(e.fromPersonId)!;
          const amount = rand() < 0.5 ? BigInt(e.amount) : BigInt(Math.max(1, Math.floor(Number(e.amount) * rand())));
          await payer.call("/api/settlements", { method: "POST", body: { groupId: g.id, fromPersonId: e.fromPersonId, toPersonId: e.toPersonId, amount: amount.toString(), currency: g.currency } });
          bump("payment");
        }
      } else if (r < 0.9) {
        const e = await postExpense(A, { friendId: E.id }, [A.id, E.id], "EUR");
        if (e) { live.set(e.id, { groupId: null, actor: A }); bump("direct"); }
      } else {
        const detail = (await actor.call(`/api/groups/${g.id}`)).body.group;
        for (const e of detail.balances.simplified) {
          const payer = byId.get(e.fromPersonId) ?? byId.get(e.toPersonId);
          if (!payer) continue;
          await payer.call("/api/settlements", { method: "POST", body: { groupId: g.id, fromPersonId: e.fromPersonId, toPersonId: e.toPersonId, amount: e.amount, currency: g.currency }, allowError: true });
        }
        bump("settle-all");
      }
    } catch (error) {
      check(`step ${step} did not crash`, false, String(error).slice(0, 300));
    }
    if (step % 10 === 0 || step === STEPS) {
      for (const grp of groups) await checkGroup(grp, `step ${step} ${grp.currency}`);
      await checkPeople(`step ${step}`);
      process.stdout.write(`  step ${step}: ${passed} checks passed, ${failures.length} failed\n`);
    }
  }

  // Settling everything has to land everyone on zero.
  for (const g of groups) {
    for (let round = 0; round < 3; round++) {
      const detail = (await A.call(`/api/groups/${g.id}`).catch(() => C.call(`/api/groups/${g.id}`))).body.group;
      for (const e of detail.balances.simplified) {
        const payer = byId.get(e.fromPersonId) ?? byId.get(e.toPersonId) ?? A;
        await payer.call("/api/settlements", { method: "POST", body: { groupId: g.id, fromPersonId: e.fromPersonId, toPersonId: e.toPersonId, amount: e.amount, currency: g.currency } });
      }
    }
    const after = await checkGroup(g, `settled ${g.currency}`);
    check(`settling up the ${g.currency} group leaves nobody owing`, Object.values(after.balances.net).every((v: any) => v === "0"), JSON.stringify(after.balances.net));
  }

  console.log(`\nOperations: ${JSON.stringify(ops)}`);
  console.log(`${passed} checks passed, ${failures.length} failed`);
  const unique = [...new Set(failures.map((f) => f.replace(/^step \d+ /, "").replace(/ — .*/, "")))];
  if (unique.length) console.log("Distinct failures:\n  " + unique.join("\n  "));
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
