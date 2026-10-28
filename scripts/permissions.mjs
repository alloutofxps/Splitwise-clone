/**
 * The permission table (RULES.md P1, P2, V1): every action, tried as every
 * kind of person, against a real server.
 *
 *   owner     made the group
 *   member    joined it by invite
 *   left      joined, then left
 *   stranger  on Divvy, but not in the group and not a friend
 *   friend    a direct friend of the owner, not in the group
 *   anon      no sign-in at all
 *
 * Each action lists who may do it. Everyone else must be refused (401 when
 * signed out, 403 or 404 otherwise), and a refusal must not contain any of
 * the group's private words. Actions that change or remove something get a
 * fresh copy of their target for every person, so one person's try never
 * decides another's.
 *
 *   node scripts/permissions.mjs http://localhost:3000
 */

const BASE = process.argv[2] ?? "http://localhost:3000";
const SECRET = `zq${Date.now().toString(36)}`; // a word only the group's own data contains

// Each person signs up from their own address, as smoke.mjs does, so the
// table never spends the sign-up allowance the browser checks after it need.
let people = 0;
function person() {
  let cookie = "";
  const address = `198.18.20.${++people}`;
  const call = async (path, method = "GET", body) => {
    const response = await fetch(BASE + path, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), origin: BASE, "X-Forwarded-For": address },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const set = response.headers.getSetCookie?.() ?? [];
    for (const line of set) if (line.startsWith("divvy_id=")) cookie = line.split(";")[0];
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: response.status, text, json };
  };
  return { call };
}

async function must(promise, what) {
  const r = await promise;
  if (r.status >= 300) throw new Error(`${what}: ${r.status} ${r.text.slice(0, 200)}`);
  return r.json;
}

// ---------------------------------------------------------------------------
// The cast
// ---------------------------------------------------------------------------

const cast = { owner: person(), member: person(), left: person(), stranger: person(), friend: person(), anon: person() };
const ids = {};
for (const name of ["owner", "member", "left", "stranger", "friend"]) {
  const r = await must(cast[name].call("/api/identity", "POST", { displayName: `${name} ${SECRET}`.slice(0, 40), avatarColor: "teal" }), `sign up ${name}`);
  ids[name] = r.me.id;
  ids[`${name}Code`] = r.me.inviteCode;
}

const group = (await must(cast.owner.call("/api/groups", "POST", { name: `Trip ${SECRET}`, kind: "trip", emoji: "🧪", currency: "EUR", placeholderNames: ["Gina"] }), "make group")).group;
const G = group.id;
const invite = (await must(cast.owner.call(`/api/groups/${G}`), "read group")).group.inviteCode;
await must(cast.member.call(`/api/invite/${invite}/join`, "POST", {}), "member joins");
await must(cast.left.call(`/api/invite/${invite}/join`, "POST", {}), "left joins");
await must(cast.left.call(`/api/groups/${G}/members/${ids.left}`, "DELETE"), "left leaves");
// Friend: the owner adds them by their personal code.
await must(cast.owner.call(`/api/invite/${ids.friendCode}/join`, "POST", {}), "owner adds friend");

const detail = async () => (await must(cast.owner.call(`/api/groups/${G}`), "read group")).group;
const gina = (await detail()).members.find((m) => m.displayName === "Gina").id;

let n = 0;
// A one-pixel picture, for receipts.
const RECEIPT = { filename: "receipt.png", mimeType: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" };

const groupExpense = async (extra = {}) => {
  const r = await must(cast.owner.call("/api/expenses", "POST", {
    groupId: G, description: `Dinner ${SECRET} ${n++}`, amount: "3000", currency: "EUR", splitMode: "EQUAL",
    payers: [{ personId: ids.owner, amount: "3000" }],
    splits: [{ personId: ids.owner, amount: "1000" }, { personId: ids.member, amount: "1000" }, { personId: gina, amount: "1000" }],
    ...extra,
  }), "add group expense");
  return extra.attachments ? r.expense : r.expense.id;
};
const receipt = async () => (await groupExpense({ attachments: [RECEIPT] })).attachments[0].id;
const directExpense = async (extra = {}) => {
  const r = await must(cast.owner.call("/api/expenses", "POST", {
    groupId: null, friendId: ids.friend, description: `Taxi ${SECRET} ${n++}`, amount: "2000", currency: "EUR", splitMode: "EQUAL",
    payers: [{ personId: ids.owner, amount: "2000" }],
    splits: [{ personId: ids.owner, amount: "1000" }, { personId: ids.friend, amount: "1000" }],
    ...extra,
  }), "add direct expense");
  return extra.attachments ? r.expense : r.expense.id;
};
const settlement = async () => {
  const r = await must(cast.member.call("/api/settlements", "POST", { groupId: G, fromPersonId: ids.member, toPersonId: ids.owner, amount: "100", currency: "EUR", note: SECRET }), "add payment");
  return (r.settlement ?? r).id;
};
const placeholder = async () => {
  const r = await must(cast.owner.call(`/api/groups/${G}/members`, "POST", { name: `Pat ${n++}` }), "add placeholder");
  const m = (await detail()).members.find((x) => x.displayName.startsWith("Pat ") && !x.taken);
  return r.person?.id ?? r.member?.id ?? m.id;
};
const removedPayment = async () => {
  const id = await settlement();
  await must(cast.member.call(`/api/settlements/${id}`, "DELETE"), "remove payment");
  return id;
};
const recurring = async () => (await must(cast.owner.call("/api/recurrences", "POST", {
  groupId: G, description: `Rent ${SECRET}`, amount: "900", currency: "EUR", splitMode: "EQUAL",
  payers: [{ personId: ids.owner, amount: "900" }], splits: [{ personId: ids.owner, amount: "450" }, { personId: ids.member, amount: "450" }],
  frequency: "MONTHLY", startDate: new Date(Date.now() + 86400000).toISOString(),
}), "add recurring expense")).recurrence.id;
const deleted = async () => {
  const id = await groupExpense();
  await must(cast.owner.call(`/api/expenses/${id}`, "DELETE"), "delete expense");
  return id;
};
const freshGroup = async () => (await must(cast.owner.call("/api/groups", "POST", { name: `Spare ${SECRET}`, kind: "other", emoji: "🧪", currency: "EUR" }), "spare group")).group.id;

const E = await groupExpense();
const DE = await directExpense();
const R = await recurring();
const A = await receipt();
const DA = (await directExpense({ attachments: [RECEIPT] })).attachments[0].id;
await must(cast.owner.call("/api/identity/payment-methods", "POST", { kind: "paypal", value: `owner${SECRET}` }), "add payment details");
const ownerMethods = async () => (await must(cast.owner.call(`/api/people/${ids.owner}/payment-methods`), "read payment details")).paymentMethods ?? [];
const PM = (await ownerMethods())[0]?.id;
if (!PM) throw new Error("the owner's payment details were not saved");
await must(cast.member.call(`/api/expenses/${E}/comments`, "POST", { body: `note ${SECRET}` }), "comment");

const valid = (extra = {}) => ({
  groupId: G, description: "Lunch", amount: "600", currency: "EUR", splitMode: "EQUAL",
  payers: [{ personId: ids.owner, amount: "600" }],
  splits: [{ personId: ids.owner, amount: "300" }, { personId: ids.member, amount: "300" }],
  ...extra,
});

// ---------------------------------------------------------------------------
// The table: [action, who may, request]
// ---------------------------------------------------------------------------

const IN_GROUP = ["owner", "member"];
const OWNER = ["owner"];
const DIRECT = ["owner", "friend"];
const NOBODY = [];
// Asked about a group they are not in, these routes answer with an empty
// list rather than a refusal. That is fine as long as the list is empty.
const SIGNED_IN = ["owner", "member", "left", "stranger", "friend"];
const EMPTY_FOR_OUTSIDERS = { outsidersSeeNothing: true };

const table = [
  // Reading a group
  ["read the group", IN_GROUP, () => [`/api/groups/${G}`]],
  ["list its expenses", IN_GROUP, () => [`/api/groups/${G}/expenses`]],
  ["read its insights", IN_GROUP, () => [`/api/groups/${G}/stats`]],
  ["export it", IN_GROUP, () => [`/api/groups/${G}/export`]],
  ["read an expense", IN_GROUP, () => [`/api/expenses/${E}`]],
  ["read its comments", IN_GROUP, () => [`/api/expenses/${E}/comments`]],
  ["read its recurring expenses", SIGNED_IN, () => [`/api/recurrences?groupId=${G}`], EMPTY_FOR_OUTSIDERS],
  // Joining a group makes you friends with its members, so someone who left
  // keeps seeing how the owner likes to be paid.
  ["read the owner's payment details", [...IN_GROUP, "left", "friend"], () => [`/api/people/${ids.owner}/payment-methods`]],

  // Changing a group's money
  ["add an expense", IN_GROUP, () => ["/api/expenses", "POST", valid()]],
  ["edit an expense", IN_GROUP, async () => {
    const id = await groupExpense();
    const current = (await must(cast.owner.call(`/api/expenses/${id}`), "read")).expense;
    return [`/api/expenses/${id}`, "PATCH", { ...valid(), expectedUpdatedAt: current.updatedAt }];
  }],
  ["delete an expense", IN_GROUP, async () => [`/api/expenses/${await groupExpense()}`, "DELETE"]],
  ["restore a deleted expense", IN_GROUP, async () => [`/api/expenses/${await deleted()}/restore`, "POST"]],
  ["comment", IN_GROUP, () => [`/api/expenses/${E}/comments`, "POST", { body: "hello" }]],
  ["record a payment", IN_GROUP, () => ["/api/settlements", "POST", { groupId: G, fromPersonId: ids.member, toPersonId: ids.owner, amount: "50", currency: "EUR" }]],
  ["remove a payment", IN_GROUP, async () => [`/api/settlements/${await settlement()}`, "DELETE"]],
  // Only the person owed may remind; the member owes the owner.
  ["remind the member", OWNER, () => ["/api/nudges", "POST", { groupId: G, personId: ids.member }]],
  ["add a recurring expense", IN_GROUP, () => ["/api/recurrences", "POST", { ...valid(), frequency: "MONTHLY", startDate: new Date().toISOString() }]],
  ["pause a recurring expense", IN_GROUP, () => [`/api/recurrences/${R}`, "PATCH", { active: false }]],
  ["delete a recurring expense", IN_GROUP, async () => [`/api/recurrences/${await recurring()}`, "DELETE"]],
  ["restore a removed payment", IN_GROUP, async () => [`/api/settlements/${await removedPayment()}/restore`, "POST"]],
  // Paying the owner everything in one go. The owner can't pay themselves.
  ["pay the owner in one go", ["member"], () => ["/api/settlements/batch", "POST", {
    personId: ids.owner, currency: "EUR", rows: [{ id: `perm${SECRET}${n++}`, groupId: G, amount: "10" }],
  }]],
  ["set a budget for the group", IN_GROUP, () => ["/api/budgets", "PUT", { groupId: G, amount: "10000", currency: "EUR", period: "MONTHLY" }]],

  // Receipts
  ["see a receipt", IN_GROUP, () => [`/api/attachments/${A}`]],
  ["delete a receipt", IN_GROUP, async () => [`/api/attachments/${await receipt()}`, "DELETE"]],
  ["see a direct receipt", DIRECT, () => [`/api/attachments/${DA}`]],

  // Changing the group itself
  ["rename the group", IN_GROUP, () => [`/api/groups/${G}`, "PATCH", { name: "Renamed" }]],
  ["delete the group", OWNER, async () => [`/api/groups/${await freshGroup()}`, "DELETE"]],
  ["replace the invite link", IN_GROUP, () => [`/api/groups/${G}/invite`, "POST", { action: "rotate" }]],
  ["add a placeholder", IN_GROUP, () => [`/api/groups/${G}/members`, "POST", { name: `Quinn ${n++}` }]],
  ["remove a placeholder", IN_GROUP, async () => [`/api/groups/${G}/members/${await placeholder()}`, "DELETE"]],
  ["remove the member", OWNER, () => [`/api/groups/${G}/members/${ids.member}`, "DELETE", undefined, { dryStatusOnly: true }]],
  ["mark the group read", IN_GROUP, () => [`/api/groups/${G}/read`, "POST"]],

  // Direct (no group) money between the owner and their friend
  ["read a direct expense", DIRECT, () => [`/api/expenses/${DE}`]],
  ["read the owner and friend's page", DIRECT, (who) => [`/api/friends/${who === "friend" ? ids.owner : ids.friend}`]],
  ["add a direct expense between the two", DIRECT, () => ["/api/expenses", "POST", {
    groupId: null, friendId: ids.friend, description: "x", amount: "200", currency: "EUR", splitMode: "EQUAL",
    payers: [{ personId: ids.owner, amount: "200" }], splits: [{ personId: ids.owner, amount: "100" }, { personId: ids.friend, amount: "100" }],
  }]],

  // Other people's accounts
  ["merge the owner into someone", NOBODY, () => [`/api/people/${ids.owner}/merge`, "POST", { intoPersonId: ids.member }]],
  // The owner doing this would sign themselves out for every row after it.
  ["sign out the owner's device", NOBODY, async () => {
    const sessions = (await must(cast.owner.call("/api/identity/devices"), "devices")).sessions ?? [];
    if (sessions.length === 0) throw new Error("the owner has no signed-in device to aim at");
    return [`/api/identity/devices/${sessions[0].id}`, "DELETE"];
  }, { skipOwner: true }],
];

// Signed out, everything that needs a person is refused; signed in, nobody
// outside sees the group's words in search or activity.
const leakChecks = [
  ["search", (who) => cast[who].call(`/api/search?q=${SECRET}`)],
  ["activity", (who) => cast[who].call("/api/activity")],
  ["home", (who) => cast[who].call("/api/dashboard")],
  ["export everything", (who) => cast[who].call("/api/export")],
  ["budgets", (who) => cast[who].call("/api/budgets")],
];

// ---------------------------------------------------------------------------

const ACTORS = ["owner", "member", "left", "stranger", "friend", "anon"];
const rows = [];
let failures = 0;

for (const [action, allowed, make, options = {}] of table) {
  const row = { action, results: {} };
  for (const who of ACTORS) {
    // "remove the member" is checked for refusals only; the owner removing
    // the member would change the cast for every row after it.
    if ((action === "remove the member" || options.skipOwner) && who === "owner") { row.results[who] = "skip"; continue; }
    const [path, method = "GET", body] = await make(who);
    const r = await cast[who].call(path, method, body);
    const may = allowed.includes(who);
    // A refusal is 401 signed out; signed in, 403, 404, or 422 where the
    // request makes no sense for that person ("you can't remind yourself").
    const refused = who === "anon" ? r.status === 401 : [403, 404, 422].includes(r.status);
    const outsider = !IN_GROUP.includes(who);
    const ok = may
      ? r.status >= 200 && r.status < 300 && !(options.outsidersSeeNothing && outsider && r.text.includes(SECRET))
      : refused && !r.text.includes(SECRET);
    row.results[who] = `${ok ? "ok" : "WRONG"} ${r.status}`;
    if (!ok) {
      failures++;
      console.log(`WRONG  ${action} as ${who}: expected ${may ? "allowed" : "refused"}, got ${r.status} ${r.text.slice(0, 160)}`);
    }
  }
  rows.push(row);
}

for (const [name, run] of leakChecks) {
  for (const who of ["left", "stranger", "friend"]) {
    const r = await run(who);
    // The friend legitimately sees the direct expense; only the group's words matter here.
    const leaked = r.text.includes(`Trip ${SECRET}`) || r.text.includes(`Dinner ${SECRET}`) || r.text.includes(`note ${SECRET}`);
    if (leaked || r.status >= 500) {
      failures++;
      console.log(`WRONG  ${name} as ${who} shows the group's data (${r.status})`);
    }
  }
  const r = await run("anon");
  if (r.status !== 401) { failures++; console.log(`WRONG  ${name} signed out: ${r.status}`); }
}

// Some routes answer "done" to anyone because they only ever touch the
// caller's own rows. For those, what matters is that nothing else changed.
for (const who of ["member", "left", "stranger", "friend"]) {
  await cast[who].call(`/api/identity/payment-methods/${PM}`, "DELETE");
}
if (!(await ownerMethods()).some((m) => m.id === PM)) {
  failures++;
  console.log("WRONG  someone else removed the owner's payment details");
}
// Posting everyone's repeating expenses needs the server's own key.
for (const [label, headers] of [["signed out", {}], ["with a wrong key", { authorization: "Bearer not-the-key-at-all-0000" }]]) {
  const r = await fetch(`${BASE}/api/recurrences/run`, { method: "POST", headers: { ...headers, origin: BASE } });
  if (r.status !== 401) { failures++; console.log(`WRONG  running everyone's repeating expenses ${label}: ${r.status}`); }
}
const mine = await cast.stranger.call("/api/recurrences/run", "POST");
if (mine.json?.scope !== "mine") { failures++; console.log(`WRONG  a signed-in run is not limited to their own: ${mine.text.slice(0, 120)}`); }

const pad = (s, w) => String(s).padEnd(w);
console.log(`\n${pad("action", 44)}${ACTORS.map((a) => pad(a, 12)).join("")}`);
for (const row of rows) console.log(`${pad(row.action, 44)}${ACTORS.map((a) => pad(row.results[a], 12)).join("")}`);
console.log(`\n${table.length} actions x ${ACTORS.length} people, plus ${leakChecks.length} leak checks and 4 checks that nothing else changed: ${failures === 0 ? "all as expected" : `${failures} wrong`}`);
process.exit(failures === 0 ? 0 : 1);
