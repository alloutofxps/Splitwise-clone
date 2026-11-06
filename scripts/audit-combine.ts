/**
 * Combining two accounts, tested as hard as the money itself (findings item 60).
 *
 * The one rule: nobody's balance changes. So every scenario here takes a picture
 * of every person's balance in every group and between every pair of friends,
 * combines the accounts, and checks that everyone else's numbers are exactly the
 * same and that the person's are the two old ones added together. It also checks
 * that a refused attempt changes nothing at all, and that the proof is real.
 *
 * Usage: npx tsx scripts/audit-combine.ts [base-url]
 */
export {};

const BASE = process.argv[2] ?? "http://localhost:3000";
let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

let n = 1;
interface Client {
  id: string;
  name: string;
  key: string;
  cookie: string;
  address: string;
  call(path: string, o?: { method?: string; body?: unknown; allowError?: boolean }): Promise<{ status: number; body: any }>;
}

function client(): Client {
  const self: Client = {
    id: "",
    name: "",
    key: "",
    cookie: "",
    address: `198.18.${Math.floor(n / 250)}.${(n++ % 250) + 1}`,
    async call(path, o = {}) {
      const r = await fetch(`${BASE}${path}`, {
        method: o.method ?? "GET",
        headers: {
          ...(o.body ? { "Content-Type": "application/json" } : {}),
          ...(self.cookie ? { Cookie: self.cookie } : {}),
          "X-Forwarded-For": self.address,
        },
        body: o.body ? JSON.stringify(o.body) : undefined,
      });
      const m = /divvy_id=([^;]*)/.exec(r.headers.get("set-cookie") ?? "");
      if (m) self.cookie = `divvy_id=${m[1]}`;
      const text = await r.text();
      let body: any = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        /* keep text */
      }
      if (!r.ok && !o.allowError) throw new Error(`${o.method ?? "GET"} ${path} -> ${r.status} ${text.slice(0, 300)}`);
      return { status: r.status, body };
    },
  };
  return self;
}

async function person(name: string): Promise<Client> {
  const c = client();
  const made = (await c.call("/api/identity", { method: "POST", body: { displayName: name, defaultCurrency: "EUR" } })).body;
  c.id = made.me.id;
  c.name = name;
  c.key = made.recoveryKey;
  return c;
}

const makeGroup = async (owner: Client, name: string, others: Client[], extra: Record<string, unknown> = {}) => {
  const group = (await owner.call("/api/groups", { method: "POST", body: { name, currency: "EUR", ...extra } })).body.group;
  const code = (await owner.call(`/api/groups/${group.id}`)).body.group.inviteCode;
  for (const other of others) await other.call(`/api/invite/${code}/join`, { method: "POST", body: {} });
  return { id: group.id as string, code: code as string };
};

/** An expense in a group or between friends, split equally unless told otherwise. */
const bill = (by: Client, payers: [Client, bigint][], splits: [Client, bigint][], where: string | Client, description = "Dinner") => {
  const amount = payers.reduce((total, [, paid]) => total + paid, 0n);
  return by.call("/api/expenses", {
    method: "POST",
    body: {
      ...(typeof where === "string" ? { groupId: where } : { friendId: where.id }),
      description,
      amount: amount.toString(),
      currency: "EUR",
      splitMode: "EXACT",
      payers: payers.map(([c, paid]) => ({ personId: c.id, amount: paid.toString() })),
      splits: splits.map(([c, owed]) => ({ personId: c.id, amount: owed.toString(), included: true })),
    },
  });
};

const pay = (by: Client, from: Client, to: Client, amount: bigint, groupId: string | null) =>
  by.call("/api/settlements", {
    method: "POST",
    allowError: true,
    body: { ...(groupId ? { groupId } : {}), fromPersonId: from.id, toPersonId: to.id, amount: amount.toString(), currency: "EUR" },
  });

const net = async (viewer: Client, groupId: string): Promise<Map<string, bigint>> => {
  const balances = (await viewer.call(`/api/groups/${groupId}`)).body.group.balances.net as Record<string, string>;
  return new Map(Object.entries(balances).map(([id, value]) => [id, BigInt(value)]));
};

const signInCodeFrom = async (c: Client): Promise<string> => (await c.call("/api/identity/link", { method: "POST" })).body.code;

const combine = (keep: Client, proof: string, confirm = true) =>
  keep.call("/api/identity/combine", { method: "POST", allowError: true, body: { proof, confirm } });

const sameNumbers = (a: Map<string, bigint>, b: Map<string, bigint>, skip: string[]) => {
  for (const [id, value] of a) {
    if (skip.includes(id)) continue;
    if ((b.get(id) ?? 0n) !== value) return false;
  }
  return true;
};

async function main() {
  console.log("\nBoth accounts in one group, sharing a bill");
  {
    const keep = await person("Sana New");
    const other = await person("Sana Old");
    const ana = await person("Ana");
    const ben = await person("Ben");
    const g = await makeGroup(ana, "Lisbon", [keep, other, ben]);
    // Both names are on the same bills, as payers and as shares.
    await bill(ana, [[keep, 3000n], [other, 1000n]], [[keep, 1000n], [other, 1000n], [ana, 1000n], [ben, 1000n]], g.id);
    await bill(ana, [[ana, 9001n]], [[keep, 3000n], [other, 3000n], [ben, 3001n]], g.id, "Hotel");
    await bill(ben, [[other, 2500n]], [[ana, 1250n], [ben, 1250n]], g.id, "Taxi");
    await pay(ben, ben, other, 100n, g.id);
    await pay(ana, other, ana, 200n, g.id);

    const before = await net(ana, g.id);
    const expected = (before.get(keep.id) ?? 0n) + (before.get(other.id) ?? 0n);
    const code = await signInCodeFrom(other);

    const preview = await combine(keep, code, false);
    check("asking first says who and how much", preview.status === 200 && preview.body.other.displayName === "Sana Old" && preview.body.groups === 1 && preview.body.expenses === 3, JSON.stringify(preview.body));
    check("and changes nothing", sameNumbers(before, await net(ana, g.id), []));

    const done = await combine(keep, code);
    check("the accounts combine", done.status === 200, JSON.stringify(done.body).slice(0, 200));
    const after = await net(ana, g.id);
    check("everyone else's balance is exactly the same", sameNumbers(before, after, [keep.id, other.id]), JSON.stringify([...after].map(([k, v]) => [k, String(v)])));
    check("yours is the two added together", (after.get(keep.id) ?? 0n) === expected, `${after.get(keep.id)} vs ${expected}`);
    check("the other name is gone from the group", !after.has(other.id));
    const total = [...after.values()].reduce((sum, value) => sum + value, 0n);
    check("and the group still adds up to zero", total === 0n, String(total));

    const detail = (await ana.call(`/api/groups/${g.id}`)).body.group;
    check("one member, not two", detail.members.filter((m: { id: string }) => m.id === other.id).length === 0 && detail.members.filter((m: { id: string }) => m.id === keep.id).length === 1);
    const items = (await ana.call(`/api/groups/${g.id}/expenses`)).body.items;
    const dinner = items.find((i: any) => i.expense?.description === "Dinner")?.expense;
    check("two shares of one bill become one of the sum", dinner?.splits?.find((s: any) => s.personId === keep.id)?.amount === "2000", JSON.stringify(dinner?.splits));
    check("two payers become one who put down the sum", dinner?.payers?.find((p: any) => p.personId === keep.id)?.amount === "4000", JSON.stringify(dinner?.payers));

    const again = await combine(keep, code);
    check("the same code can't be used again", again.status >= 400 && again.status < 500, String(again.status));

    console.log("\nThe other account's ways in");
    const stillOld = await other.call("/api/identity", { allowError: true });
    check("its phone stays signed in, as the account that stayed", stillOld.status === 200 && stillOld.body.me.id === keep.id, JSON.stringify(stillOld.body).slice(0, 120));
    const secondCall = await other.call("/api/dashboard", { allowError: true });
    check("and carries on working", secondCall.status === 200, String(secondCall.status));
    const fresh = client();
    const restored = await fresh.call("/api/identity/restore", { method: "POST", allowError: true, body: { recoveryKey: other.key } });
    check("its recovery key opens the account that stayed", restored.status === 200 && restored.body.me.id === keep.id, JSON.stringify(restored.body).slice(0, 120));
    const fresh2 = client();
    const ownKey = await fresh2.call("/api/identity/restore", { method: "POST", allowError: true, body: { recoveryKey: keep.key } });
    check("and so does its own", ownKey.status === 200 && ownKey.body.me.id === keep.id);
    const devices = (await keep.call("/api/identity/devices")).body;
    check("its devices are listed under the account that stayed", JSON.stringify(devices).length > 2 && (devices.sessions?.length ?? devices.devices?.length ?? 0) >= 2, JSON.stringify(devices).slice(0, 200));
    const code2 = await ana.call(`/api/invite/${(await keep.call("/api/identity")).body.me.inviteCode}`, { allowError: true });
    check("the invite code that stayed still works", code2.status === 200, String(code2.status));
  }

  console.log("\nBills between friends, in two groups, and things only an account has");
  {
    const keep = await person("Kim");
    const other = await person("Kimmy");
    const friend = await person("Fay");
    const pal = await person("Pal");

    const friendCode = (await friend.call("/api/identity")).body.me.inviteCode;
    const palCode = (await pal.call("/api/identity")).body.me.inviteCode;
    await keep.call(`/api/invite/${friendCode}/join`, { method: "POST", body: {} });
    await other.call(`/api/invite/${friendCode}/join`, { method: "POST", body: {} });
    await other.call(`/api/invite/${palCode}/join`, { method: "POST", body: {} });
    await bill(keep, [[keep, 2000n]], [[keep, 1000n], [friend, 1000n]], friend, "Keep and Fay");
    await bill(other, [[friend, 4000n]], [[other, 2000n], [friend, 2000n]], friend, "Other and Fay");
    await bill(other, [[other, 500n]], [[other, 250n], [pal, 250n]], pal, "Other and Pal");

    const g1 = await makeGroup(other, "Only the other is here", [friend]);
    const g2 = await makeGroup(keep, "Only the kept is here", [pal]);
    await bill(other, [[other, 1000n]], [[other, 500n], [friend, 500n]], g1.id);
    await bill(keep, [[keep, 800n]], [[keep, 400n], [pal, 400n]], g2.id);

    // Everything else that names a person. Only an owner can turn an invite back on.
    await other.call(`/api/groups/${g1.id}/invite`, { method: "POST", body: { action: "disable" } });
    const billOnG1 = (await other.call(`/api/groups/${g1.id}/expenses`)).body.items.find((i: any) => i.expense)?.expense.id as string;
    await other.call(`/api/expenses/${billOnG1}/comments`, { method: "POST", body: { body: "From the other account" } });
    await other.call("/api/budgets", { method: "PUT", body: { groupId: g1.id, amount: "100000", currency: "EUR", period: "YEARLY" } });
    const inAMonth = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const repeat = (where: Record<string, string>, friendSide: Client) => ({
      ...where,
      description: "Rent",
      amount: "1000",
      currency: "EUR",
      splitMode: "EQUAL",
      payers: [{ personId: other.id, amount: "1000" }],
      splits: [
        { personId: other.id, amount: "500", included: true },
        { personId: friendSide.id, amount: "500", included: true },
      ],
      frequency: "MONTHLY",
      interval: 1,
      startDate: inAMonth,
    });
    const groupRepeat = await other.call("/api/recurrences", { method: "POST", body: repeat({ groupId: g1.id }, friend) });
    const directRepeat = await other.call("/api/recurrences", { method: "POST", allowError: true, body: repeat({ friendId: pal.id }, pal) });

    const before1 = await net(friend, g1.id);
    const before2 = await net(pal, g2.id);
    const friendsOf = async (c: Client) => (await c.call("/api/dashboard")).body.friends as { person: { id: string }; net: Record<string, string> }[];
    const owed = (list: { person: { id: string }; net: Record<string, string> }[], id: string) => BigInt(list.find((row) => row.person.id === id)?.net.EUR ?? "0");
    const friendsBefore = await friendsOf(friend);
    const palBefore = await friendsOf(pal);
    const fayOwedInTotal = owed(friendsBefore, keep.id) + owed(friendsBefore, other.id);
    const palOwedByOther = owed(palBefore, other.id);

    const done = await combine(keep, other.key);
    check("a recovery key proves it too", done.status === 200, JSON.stringify(done.body).slice(0, 200));

    const after1 = await net(friend, g1.id);
    check("a group only the other was in comes across", after1.get(keep.id) === before1.get(other.id) && sameNumbers(before1, after1, [other.id, keep.id]));
    const enabled = await keep.call(`/api/groups/${g1.id}/invite`, { method: "POST", allowError: true, body: { action: "enable" } });
    check("and its owner still owns it", enabled.status === 200, `${enabled.status} ${JSON.stringify(enabled.body).slice(0, 120)}`);
    const comments = (await keep.call(`/api/expenses/${billOnG1}/comments`)).body.comments;
    check("its comments are the kept account's", comments.length === 1 && comments[0].personId === keep.id, JSON.stringify(comments).slice(0, 160));
    const budgets = (await keep.call("/api/budgets")).body.budgets;
    check("so are its budgets", budgets.length === 1 && budgets[0].groupId === g1.id, JSON.stringify(budgets).slice(0, 160));
    const repeating = (await keep.call(`/api/recurrences?groupId=${g1.id}`)).body.recurrences;
    const repeatJson = JSON.stringify(repeating);
    check("a repeating bill in a group now names the kept account", groupRepeat.status < 300 && repeatJson.includes(keep.id) && !repeatJson.includes(other.id), repeatJson.slice(0, 240));
    if (directRepeat.status < 300) {
      const direct = JSON.stringify((await keep.call("/api/recurrences")).body);
      check("so does one between friends", direct.includes(keep.id) && !direct.includes(other.id), direct.slice(0, 240));
    } else {
      console.log(`    repeating bills between friends can't be made here: ${directRepeat.status}`);
    }
    const feed = JSON.stringify((await friend.call("/api/activity")).body);
    check("the group's feed says what happened", feed.includes("member.merged") && feed.includes("Kimmy"), feed.slice(0, 200));
    check("a group only the kept account was in is untouched", sameNumbers(before2, await net(pal, g2.id), []));

    const friendsAfter = await friendsOf(friend);
    const palAfter = await friendsOf(pal);
    check("a friend who knew both now sees one", friendsAfter.length === friendsBefore.length - 1 && !friendsAfter.some((row) => row.person.id === other.id), JSON.stringify(friendsAfter).slice(0, 200));
    check("with the two friend balances added together", owed(friendsAfter, keep.id) === fayOwedInTotal && fayOwedInTotal !== 0n, `${owed(friendsAfter, keep.id)} vs ${fayOwedInTotal}`);
    check("and a friend of only the other account now has the one that stayed", palAfter.some((row) => row.person.id === keep.id) && owed(palAfter, keep.id) === palOwedByOther + owed(palBefore, keep.id), JSON.stringify(palAfter).slice(0, 200));
    const keptFriends = await friendsOf(keep);
    check("and nobody is listed as their own friend", !keptFriends.some((row) => row.person.id === keep.id));
    const me = (await keep.call("/api/identity")).body.me;
    check("the name that stays is the kept account's", me.displayName === "Kim");
  }

  console.log("\nA bin, and the other way round");
  {
    const keep = await person("Lee");
    const other = await person("Leo");
    const ana = await person("Ana");
    const g = await makeGroup(ana, "Bin", [keep, other]);
    await bill(ana, [[ana, 900n]], [[keep, 300n], [other, 300n], [ana, 300n]], g.id, "Binned");
    const items = (await ana.call(`/api/groups/${g.id}/expenses`)).body.items;
    const binned = items.find((i: any) => i.expense?.description === "Binned").expense;
    await ana.call(`/api/expenses/${binned.id}`, { method: "DELETE" });
    const payment = await pay(other, other, keep, 50n, g.id);
    const paymentId = payment.body.settlement?.id ?? payment.body.id;
    check("a payment between the two is made, to bin", payment.status === 201 && Boolean(paymentId), JSON.stringify(payment.body).slice(0, 160));
    await other.call(`/api/settlements/${paymentId}`, { method: "DELETE" });

    const done = await combine(keep, await signInCodeFrom(other));
    check("a binned payment between the two doesn't stop it", done.status === 200, JSON.stringify(done.body).slice(0, 200));
    const before = await net(ana, g.id);
    const restored = await ana.call(`/api/expenses/${binned.id}/restore`, { method: "POST", allowError: true });
    const after = await net(ana, g.id);
    check("a binned bill comes back as one share of the sum", restored.status === 200 && (after.get(keep.id) ?? 0n) === (before.get(keep.id) ?? 0n) - 600n, `${restored.status} ${after.get(keep.id)}`);
    const back = await ana.call(`/api/settlements/${paymentId}/restore`, { method: "POST", allowError: true });
    check("the binned payment can't come back as paying yourself", back.status >= 400 && back.status < 500, String(back.status));
    check("and the balance didn't move", (await net(ana, g.id)).get(keep.id) === after.get(keep.id));
  }

  console.log("\nRefused, and changing nothing");
  {
    const keep = await person("Rae");
    const other = await person("Ray");
    const ana = await person("Ana");
    const g = await makeGroup(ana, "Refused", [keep, other]);
    await bill(ana, [[ana, 600n]], [[keep, 200n], [other, 200n], [ana, 200n]], g.id);
    const before = await net(ana, g.id);

    const signedOut = client();
    const noSession = await signedOut.call("/api/identity/combine", { method: "POST", allowError: true, body: { proof: "aaaa-aaaa", confirm: true } });
    check("signed out, it's refused", noSession.status === 401, String(noSession.status));
    const wrong = await combine(keep, "aaaa-aaaa");
    check("a made-up code is refused", wrong.status === 404, String(wrong.status));
    const wrongKey = await combine(keep, "dvy_thisisnotarealkeyatallnotevenclose");
    check("a made-up key is refused", wrongKey.status === 404, String(wrongKey.status));
    const self = await combine(keep, keep.key);
    check("your own key is refused", self.status === 409, String(self.status));
    const selfCode = await combine(keep, await signInCodeFrom(keep));
    check("so is your own code", selfCode.status === 409, String(selfCode.status));
    const empty = await keep.call("/api/identity/combine", { method: "POST", allowError: true, body: { proof: "" } });
    check("an empty proof is refused", empty.status === 422, String(empty.status));

    const payment = await pay(other, other, keep, 75n, g.id);
    const paid = await net(ana, g.id);
    const code = await signInCodeFrom(other);
    const blockedPreview = await combine(keep, code, false);
    check("a live payment between the two is refused on asking", blockedPreview.status === 409, String(blockedPreview.status));
    const blocked = await combine(keep, code);
    check("and on doing it", blocked.status === 409 && /payment/.test(JSON.stringify(blocked.body)), JSON.stringify(blocked.body).slice(0, 160));
    check("leaving every balance as it was", sameNumbers(paid, await net(ana, g.id), []));
    check("and the other account in one piece", (await other.call("/api/identity")).body.me.id === other.id);
    const stillGood = await combine(keep, code, false);
    check("with the code not spent", stillGood.status === 409, String(stillGood.status));
    await other.call(`/api/settlements/${payment.body.settlement?.id ?? payment.body.id}`, { method: "DELETE" });
    check("removing the payment clears the way", (await combine(keep, code, false)).status === 200);
    check("nothing moved in the meantime", sameNumbers(before, await net(ana, g.id), []));

    const couple = await person("Dee");
    const partner = await person("Dee Two");
    const coupleCode = (await partner.call("/api/identity")).body.me.inviteCode;
    await couple.call(`/api/invite/${coupleCode}/join`, { method: "POST", body: {} });
    await bill(couple, [[couple, 400n]], [[couple, 200n], [partner, 200n]], partner, "Just us");
    const between = await combine(couple, await signInCodeFrom(partner));
    check("a bill between just the two is refused", between.status === 409 && /bill between/.test(JSON.stringify(between.body)), JSON.stringify(between.body).slice(0, 160));
  }

  console.log("\nTwo taps at once");
  {
    const keep = await person("Tia");
    const other = await person("Tia Two");
    const ana = await person("Ana");
    const g = await makeGroup(ana, "Twice", [keep, other]);
    await bill(ana, [[ana, 900n]], [[keep, 300n], [other, 300n], [ana, 300n]], g.id);
    const before = await net(ana, g.id);
    const expected = (before.get(keep.id) ?? 0n) + (before.get(other.id) ?? 0n);
    const code = await signInCodeFrom(other);
    const results = await Promise.all([combine(keep, code), combine(keep, code), combine(keep, code)]);
    const worked = results.filter((r) => r.status === 200).length;
    check("only one of them does anything", worked === 1, results.map((r) => r.status).join(","));
    check("and no answer is a crash", results.every((r) => r.status < 500), results.map((r) => r.status).join(","));
    check("the sum counts once", (await net(ana, g.id)).get(keep.id) === expected);
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
