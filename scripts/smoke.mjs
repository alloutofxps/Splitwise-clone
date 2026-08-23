/**
 * End-to-end smoke test.
 *
 * Drives the real HTTP API the way the app does: three people set up, one
 * creates a group with a placeholder member, they file expenses using every
 * split mode, one of them joins by claiming the placeholder, and everybody
 * settles up.
 *
 * The assertions are about the properties that have to hold no matter what:
 *   - net balances across a group always sum to exactly zero;
 *   - every split conserves the total to the minor unit;
 *   - claiming a placeholder preserves the debts already filed against it;
 *   - settling the plan leaves everyone at zero.
 *
 * Run against a server started with `npm start` (or `npm run dev`):
 *   node scripts/smoke.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? "http://localhost:3000";

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** A person is just a cookie jar, which is the whole point of the auth model. */
function makeClient() {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    async call(path, options = {}) {
      const response = await fetch(`${BASE}${path}`, {
        method: options.method ?? "GET",
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(options.headers ?? {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        redirect: "manual",
      });

      const setCookie = response.headers.get("set-cookie");
      if (setCookie) {
        const match = /divvy_id=([^;]*)/.exec(setCookie);
        if (match) cookie = `divvy_id=${match[1]}`;
      }

      const text = await response.text();
      let json;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }

      if (!response.ok && !options.allowError) {
        throw new Error(
          `${options.method ?? "GET"} ${path} -> ${response.status}: ${
            typeof json === "object" ? JSON.stringify(json) : json
          }`,
        );
      }
      return { status: response.status, body: json };
    },
  };
}

const sum = (values) => values.reduce((total, value) => total + BigInt(value), 0n);

/** The group's whole-group spend, for comparing against a personal budget. */
const stats0 = (response) => response.body.stats.totalSpend;

async function main() {
  console.log(`\nDivvy smoke test against ${BASE}\n`);

  // -- Identities -----------------------------------------------------------
  console.log("Identity");
  const priya = makeClient();
  const ravi = makeClient();
  const tom = makeClient();

  const priyaSetup = await priya.call("/api/identity", {
    method: "POST",
    body: { displayName: "Priya", defaultCurrency: "EUR" },
  });
  check("creates an identity with no signup", priyaSetup.status === 201);
  check("returns a recovery key exactly once", Boolean(priyaSetup.body.recoveryKey));
  const priyaKey = priyaSetup.body.recoveryKey;
  const priyaId = priyaSetup.body.me.id;

  await ravi.call("/api/identity", { method: "POST", body: { displayName: "Ravi" } });
  await tom.call("/api/identity", { method: "POST", body: { displayName: "Tom" } });
  const raviId = (await ravi.call("/api/identity")).body.me.id;
  const tomId = (await tom.call("/api/identity")).body.me.id;

  const anonymous = makeClient();
  const unauthorised = await anonymous.call("/api/dashboard", { allowError: true });
  check("rejects an unknown device with 401", unauthorised.status === 401);

  // Restoring on a "new device" must land on the same person.
  const restored = makeClient();
  const restore = await restored.call("/api/identity/restore", {
    method: "POST",
    body: { recoveryKey: priyaKey },
  });
  check("restores the same identity from a recovery key", restore.body.me.id === priyaId);

  // -- Group with a placeholder --------------------------------------------
  console.log("\nGroups");
  const created = await priya.call("/api/groups", {
    method: "POST",
    body: {
      name: "Lisbon 2026",
      kind: "trip",
      emoji: "🏝️",
      currency: "EUR",
      simplifyDebts: true,
      // Sam has not installed anything yet, and should not need to.
      placeholderNames: ["Sam"],
    },
  });
  check("creates a group", created.status === 201);
  const groupId = created.body.group.id;
  const inviteCode = created.body.group.inviteCode;
  check("issues a readable invite code", /^[a-z]+-[a-z]+-\d+$/.test(inviteCode), inviteCode);

  await priya.call(`/api/groups/${groupId}/members`, {
    method: "POST",
    body: { inviteCode: (await ravi.call("/api/identity")).body.me.inviteCode },
  });

  let group = (await priya.call(`/api/groups/${groupId}`)).body.group;
  const samId = group.members.find((m) => m.displayName === "Sam").id;
  check("group has three members", group.members.length === 3, String(group.members.length));
  check("placeholder is flagged as a ghost", group.members.find((m) => m.id === samId).isGhost);

  // -- Expenses, one per split mode ----------------------------------------
  console.log("\nSplit modes");

  // EQUAL: 100.00 three ways -> 33.34 / 33.33 / 33.33, payer absorbs the cent.
  const equal = await priya.call("/api/expenses", {
    method: "POST",
    body: {
      groupId,
      description: "Dinner",
      amount: "10000",
      currency: "EUR",
      splitMode: "EQUAL",
      payers: [{ personId: priyaId, amount: "10000" }],
      splits: [
        { personId: priyaId, amount: "3334", included: true },
        { personId: raviId, amount: "3333", included: true },
        { personId: samId, amount: "3333", included: true },
      ],
    },
  });
  check("files an equal split", equal.status === 201);
  check(
    "equal split conserves the total",
    sum(equal.body.expense.splits.map((s) => s.amount)) === 10000n,
  );

  // Server must reject a split that does not add up — the one invariant that
  // would silently corrupt every balance downstream.
  const broken = await priya.call("/api/expenses", {
    method: "POST",
    allowError: true,
    body: {
      groupId,
      description: "Broken",
      amount: "10000",
      currency: "EUR",
      splitMode: "EXACT",
      payers: [{ personId: priyaId, amount: "10000" }],
      splits: [{ personId: priyaId, amount: "4000" }, { personId: raviId, amount: "4000" }],
    },
  });
  check("rejects a split that does not add up", broken.status === 422, String(broken.status));

  const brokenPayer = await priya.call("/api/expenses", {
    method: "POST",
    allowError: true,
    body: {
      groupId,
      description: "Broken payer",
      amount: "10000",
      currency: "EUR",
      splitMode: "EQUAL",
      payers: [{ personId: priyaId, amount: "9000" }],
      splits: [{ personId: priyaId, amount: "10000" }],
    },
  });
  check("rejects payers that do not add up", brokenPayer.status === 422);

  // SHARES: Ravi counts double.
  await ravi.call("/api/expenses", {
    method: "POST",
    body: {
      groupId,
      description: "Taxi",
      amount: "4000",
      currency: "EUR",
      splitMode: "SHARES",
      payers: [{ personId: raviId, amount: "4000" }],
      splits: [
        { personId: priyaId, amount: "1000", included: true, weight: 1 },
        { personId: raviId, amount: "2000", included: true, weight: 2 },
        { personId: samId, amount: "1000", included: true, weight: 1 },
      ],
    },
  });

  // ITEMIZED: a receipt, with tax shared by consumption.
  await priya.call("/api/expenses", {
    method: "POST",
    body: {
      groupId,
      description: "Lunch receipt",
      amount: "5000",
      currency: "EUR",
      splitMode: "ITEMIZED",
      payers: [{ personId: priyaId, amount: "5000" }],
      splits: [
        { personId: priyaId, amount: "3750", included: true },
        { personId: samId, amount: "1250", included: true },
      ],
      items: [
        { name: "Steak", amount: "3000", participantIds: [priyaId] },
        { name: "Soup", amount: "1000", participantIds: [samId] },
      ],
    },
  });

  // Multi-currency: a GBP expense inside a EUR group.
  const fx = await priya.call("/api/expenses", {
    method: "POST",
    body: {
      groupId,
      description: "Airport transfer",
      amount: "6000",
      currency: "GBP",
      exchangeRate: "1.18",
      splitMode: "EQUAL",
      payers: [{ personId: priyaId, amount: "6000" }],
      splits: [
        { personId: priyaId, amount: "2000", included: true },
        { personId: raviId, amount: "2000", included: true },
        { personId: samId, amount: "2000", included: true },
      ],
    },
  });
  check(
    "converts a foreign-currency expense into the group currency",
    fx.body.expense.convertedAmount === "7080",
    `got ${fx.body.expense.convertedAmount}, expected 7080`,
  );

  const missingRate = await priya.call("/api/expenses", {
    method: "POST",
    allowError: true,
    body: {
      groupId,
      description: "No rate",
      amount: "1000",
      currency: "JPY",
      splitMode: "EQUAL",
      payers: [{ personId: priyaId, amount: "1000" }],
      splits: [{ personId: priyaId, amount: "1000", included: true }],
    },
  });
  check("requires a rate for a foreign currency", missingRate.status === 422);

  // -- Balances -------------------------------------------------------------
  console.log("\nBalances");
  group = (await priya.call(`/api/groups/${groupId}`)).body.group;
  const nets = Object.values(group.balances.net);
  check("net balances sum to exactly zero", sum(nets) === 0n, `sum=${sum(nets)}`);
  check(
    "simplified plan needs at most n-1 transfers",
    group.balances.simplified.length <= group.members.length - 1,
  );

  // The simplified plan must reproduce the same net position for everyone.
  const replay = new Map();
  for (const edge of group.balances.simplified) {
    replay.set(edge.fromPersonId, (replay.get(edge.fromPersonId) ?? 0n) - BigInt(edge.amount));
    replay.set(edge.toPersonId, (replay.get(edge.toPersonId) ?? 0n) + BigInt(edge.amount));
  }
  const replayMatches = Object.entries(group.balances.net).every(
    ([personId, value]) => (replay.get(personId) ?? 0n) === BigInt(value),
  );
  check("simplified plan reproduces every net position", replayMatches);

  const samNetBefore = BigInt(group.balances.net[samId] ?? "0");
  check("the placeholder has accrued real debt", samNetBefore !== 0n, `net=${samNetBefore}`);

  // -- Claiming the placeholder --------------------------------------------
  console.log("\nClaiming a placeholder");
  const preview = await tom.call(`/api/invite/${inviteCode}`);
  check(
    "invite preview lists unclaimed names",
    preview.body.group.unclaimedMembers.some((m) => m.id === samId),
  );

  await tom.call(`/api/invite/${inviteCode}/join`, {
    method: "POST",
    body: { claimPersonId: samId },
  });

  group = (await priya.call(`/api/groups/${groupId}`)).body.group;
  check("group still has three members after the merge", group.members.length === 3);
  check("the ghost is gone", !group.members.some((m) => m.id === samId));
  check(
    "the claimer inherited the ghost's exact balance",
    BigInt(group.balances.net[tomId] ?? "0") === samNetBefore,
    `${group.balances.net[tomId]} vs ${samNetBefore}`,
  );
  check("balances still sum to zero after the merge", sum(Object.values(group.balances.net)) === 0n);

  // -- Idempotent replay ----------------------------------------------------
  console.log("\nOffline replay");
  const payload = {
    id: "exp_smoke_replay_test",
    groupId,
    description: "Replayed coffee",
    amount: "600",
    currency: "EUR",
    splitMode: "EQUAL",
    payers: [{ personId: priyaId, amount: "600" }],
    splits: [
      { personId: priyaId, amount: "300", included: true },
      { personId: raviId, amount: "300", included: true },
    ],
  };
  const first = await priya.call("/api/expenses", { method: "POST", body: payload });
  const second = await priya.call("/api/expenses", { method: "POST", body: payload });
  check("a replayed mutation returns the same row", first.body.expense.id === second.body.expense.id);

  const ledger = (await priya.call(`/api/groups/${groupId}/expenses`)).body;
  const replayCount = ledger.items.filter(
    (item) => item.expense?.description === "Replayed coffee",
  ).length;
  check("a replayed mutation is not filed twice", replayCount === 1, `found ${replayCount}`);

  // -- Settling up ----------------------------------------------------------
  console.log("\nSettling up");
  group = (await priya.call(`/api/groups/${groupId}`)).body.group;
  const clients = { [priyaId]: priya, [raviId]: ravi, [tomId]: tom };

  for (const edge of group.balances.simplified) {
    const payer = clients[edge.fromPersonId] ?? priya;
    await payer.call("/api/settlements", {
      method: "POST",
      body: {
        groupId,
        fromPersonId: edge.fromPersonId,
        toPersonId: edge.toPersonId,
        amount: edge.amount,
        currency: "EUR",
        method: "Bank transfer",
      },
    });
  }

  group = (await priya.call(`/api/groups/${groupId}`)).body.group;
  const allZero = Object.values(group.balances.net).every((value) => BigInt(value) === 0n);
  check("settling the plan leaves everyone at zero", allZero, JSON.stringify(group.balances.net));
  check("nothing outstanding remains", group.balances.simplified.length === 0);

  // -- Access control -------------------------------------------------------
  console.log("\nAccess control");
  const outsider = makeClient();
  const outsiderSetup = await outsider.call("/api/identity", {
    method: "POST",
    body: { displayName: "Stranger" },
  });
  const outsiderId = outsiderSetup.body.me.id;
  const denied = await outsider.call(`/api/groups/${groupId}`, { allowError: true });
  check("a non-member cannot read the group", denied.status === 403, String(denied.status));

  const deniedExpense = await outsider.call("/api/expenses", {
    method: "POST",
    allowError: true,
    body: {
      groupId,
      description: "Sneaky",
      amount: "1000",
      currency: "EUR",
      splitMode: "EQUAL",
      payers: [{ personId: priyaId, amount: "1000" }],
      splits: [{ personId: priyaId, amount: "1000", included: true }],
    },
  });
  check("a non-member cannot file into the group", deniedExpense.status === 403);

  // A direct expense used to create the friendship *before* checking whether
  // the caller was entitled to involve that person, which made the check
  // self-satisfying: a person id was enough to attach a debt to a stranger.
  const deniedDirect = await outsider.call("/api/expenses", {
    method: "POST",
    allowError: true,
    body: {
      friendId: priyaId,
      description: "Unsolicited",
      amount: "5000",
      currency: "EUR",
      splitMode: "EQUAL",
      payers: [{ personId: outsiderId, amount: "5000" }],
      splits: [
        { personId: outsiderId, amount: "2500", included: true },
        { personId: priyaId, amount: "2500", included: true },
      ],
    },
  });
  check(
    "a stranger cannot file a direct expense against someone",
    deniedDirect.status === 403,
    String(deniedDirect.status),
  );

  const strangerFriends = (await outsider.call("/api/friends")).body.friends;
  check(
    "the refused expense left no friendship behind",
    !strangerFriends.some((friend) => friend.id === priyaId),
    JSON.stringify(strangerFriends.map((f) => f.name)),
  );

  const deniedSettlement = await outsider.call("/api/settlements", {
    method: "POST",
    allowError: true,
    body: {
      fromPersonId: priyaId,
      toPersonId: outsiderId,
      amount: "5000",
      currency: "EUR",
    },
  });
  check(
    "a stranger cannot record a payment from someone",
    deniedSettlement.status >= 400,
    String(deniedSettlement.status),
  );

  // -- Pagination -----------------------------------------------------------
  //
  // The regression this guards: the ledger merges two tables and used to page
  // on `date` alone with a strict `<`. Rows sharing the boundary timestamp were
  // trimmed off page one and then filtered out of page two, so they vanished
  // from history entirely while still counting towards every balance.
  console.log("\nPagination");

  const paging = await priya.call("/api/groups", {
    method: "POST",
    body: {
      name: "Same Day",
      kind: "event",
      emoji: "📅",
      currency: "EUR",
      simplifyDebts: false,
      placeholderNames: [],
    },
  });
  const pagingGroupId = paging.body.group.id;
  await priya.call(`/api/groups/${pagingGroupId}/members`, {
    method: "POST",
    body: { inviteCode: (await ravi.call("/api/identity")).body.me.inviteCode },
  });

  // Every row on the same instant, which is what makes the tiebreak load-bearing.
  const sameInstant = "2026-05-01T12:00:00.000Z";
  const PAGE_SIZE = 40;
  const rowCount = PAGE_SIZE + 5;

  for (let index = 0; index < rowCount; index++) {
    await priya.call("/api/expenses", {
      method: "POST",
      body: {
        groupId: pagingGroupId,
        description: `Round ${index}`,
        amount: "1000",
        currency: "EUR",
        splitMode: "EQUAL",
        date: sameInstant,
        payers: [{ personId: priyaId, amount: "1000" }],
        splits: [
          { personId: priyaId, amount: "500", included: true },
          { personId: raviId, amount: "500", included: true },
        ],
      },
    });
  }

  // A settlement on the same instant too: it is the row type most likely to be
  // swallowed, because it comes from the other table.
  await priya.call("/api/settlements", {
    method: "POST",
    body: {
      groupId: pagingGroupId,
      fromPersonId: raviId,
      toPersonId: priyaId,
      amount: "2500",
      currency: "EUR",
      date: sameInstant,
    },
  });

  const expected = rowCount + 1;

  const firstPage = (await priya.call(`/api/groups/${pagingGroupId}/expenses`)).body;
  check("first page is full", firstPage.items.length === PAGE_SIZE, String(firstPage.items.length));
  check("first page offers a cursor", Boolean(firstPage.nextCursor), String(firstPage.nextCursor));

  const seen = new Map();
  let cursor = null;
  let pages = 0;
  do {
    const suffix = cursor ? `?before=${encodeURIComponent(cursor)}` : "";
    const body = (await priya.call(`/api/groups/${pagingGroupId}/expenses${suffix}`)).body;
    for (const item of body.items) seen.set(item.id, (seen.get(item.id) ?? 0) + 1);
    cursor = body.nextCursor;
    pages++;
  } while (cursor && pages < 10);

  check("paging terminates", cursor === null, `stopped after ${pages} pages`);
  check(
    "every row on the same timestamp is reachable",
    seen.size === expected,
    `saw ${seen.size} of ${expected}`,
  );
  check(
    "no row is served twice across pages",
    [...seen.values()].every((count) => count === 1),
  );
  check(
    "the settlement survives the merge",
    [...seen.keys()].some((id) => id.startsWith("stl")),
  );

  // A mangled cursor is a client mistake, not a server error: it should fall
  // back to the first page rather than 500.
  const junk = await priya.call(
    `/api/groups/${pagingGroupId}/expenses?before=not-a-date`,
    { allowError: true },
  );
  check("a junk cursor falls back to the first page", junk.status === 200, String(junk.status));

  // -- A group for the sections below ---------------------------------------
  //
  // Everything from here on files expenses that leave a balance outstanding,
  // and the Lisbon group has just been settled to zero for the lifecycle
  // assertion at the end. Keeping them apart means neither test has to know
  // about the other.
  const extras = await priya.call("/api/groups", {
    method: "POST",
    body: {
      name: "Household",
      kind: "home",
      emoji: "🏠",
      currency: "EUR",
      simplifyDebts: false,
      placeholderNames: [],
    },
  });
  const homeId = extras.body.group.id;
  await priya.call(`/api/groups/${homeId}/members`, {
    method: "POST",
    body: { inviteCode: (await ravi.call("/api/identity")).body.me.inviteCode },
  });

  // -- Attachments ----------------------------------------------------------
  //
  // Receipts routinely carry card digits and home addresses, so both halves
  // matter: who may fetch one, and that there is a way to take it back off.
  console.log("\nAttachments");

  // A 1x1 PNG. Small enough to inline, real enough to survive decoding.
  const pixel =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  const withReceipt = await priya.call("/api/expenses", {
    method: "POST",
    body: {
      groupId: homeId,
      description: "Taxi with receipt",
      amount: "2000",
      currency: "EUR",
      splitMode: "EQUAL",
      payers: [{ personId: priyaId, amount: "2000" }],
      splits: [
        { personId: priyaId, amount: "1000", included: true },
        { personId: raviId, amount: "1000", included: true },
      ],
      attachments: [{ filename: "receipt.png", mimeType: "image/png", dataUrl: pixel }],
    },
  });
  const receipt = withReceipt.body.expense.attachments[0];
  check("an expense stores its receipt", Boolean(receipt), JSON.stringify(receipt));

  const receiptFetch = await fetch(`${BASE}${receipt.url}`, {
    headers: { Cookie: priya.cookie },
  });
  check("a member can fetch the receipt", receiptFetch.status === 200);
  check(
    "the receipt is served as an image",
    (receiptFetch.headers.get("content-type") ?? "").startsWith("image/"),
  );

  const receiptDenied = await fetch(`${BASE}${receipt.url}`, {
    headers: { Cookie: outsider.cookie },
  });
  check("a non-member cannot fetch the receipt", receiptDenied.status === 403);

  const receiptDeleteDenied = await outsider.call(receipt.url, {
    method: "DELETE",
    allowError: true,
  });
  check("a non-member cannot delete the receipt", receiptDeleteDenied.status === 403);

  const receiptDeleted = await priya.call(receipt.url, { method: "DELETE" });
  check("a member can delete the receipt", receiptDeleted.status === 200);

  // Deleting twice is what the offline outbox does on replay.
  const receiptDeletedAgain = await priya.call(receipt.url, {
    method: "DELETE",
    allowError: true,
  });
  check("deleting a receipt twice is not an error", receiptDeletedAgain.status === 200);

  const afterDelete = (await priya.call(`/api/expenses/${withReceipt.body.expense.id}`)).body;
  check("the expense survives its receipt being removed", afterDelete.expense.id === withReceipt.body.expense.id);
  check("the receipt is gone from the expense", afterDelete.expense.attachments.length === 0);

  // -- Comments -------------------------------------------------------------
  console.log("\nComments");
  const expenseForComments = withReceipt.body.expense.id;
  await priya.call(`/api/expenses/${expenseForComments}/comments`, {
    method: "POST",
    body: { body: "Was this the airport one?" },
  });
  const comments = (await ravi.call(`/api/expenses/${expenseForComments}/comments`)).body;
  check("a comment is stored and readable by another member", comments.comments.length === 1);
  check("the comment keeps its author", comments.comments[0].personId === priyaId);

  const commentDenied = await outsider.call(`/api/expenses/${expenseForComments}/comments`, {
    method: "POST",
    allowError: true,
    body: { body: "I should not be here" },
  });
  check("a non-member cannot comment", commentDenied.status >= 400, String(commentDenied.status));

  // -- Recurring expenses ---------------------------------------------------
  //
  // The engine posts each occurrence dated when it was *due*, not when someone
  // opened the app, and catches up on months nobody looked. Both are asserted
  // by backdating the start.
  console.log("\nRecurring expenses");

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  threeMonthsAgo.setDate(1);
  threeMonthsAgo.setHours(9, 0, 0, 0);

  const recurrence = await priya.call("/api/recurrences", {
    method: "POST",
    body: {
      groupId: homeId,
      description: "Rent",
      amount: "120000",
      currency: "EUR",
      splitMode: "EQUAL",
      payers: [{ personId: priyaId, amount: "120000" }],
      splits: [
        { personId: priyaId, amount: "60000", included: true },
        { personId: raviId, amount: "60000", included: true },
      ],
      frequency: "MONTHLY",
      interval: 1,
      startDate: threeMonthsAgo.toISOString(),
    },
  });
  check("a recurrence is created", recurrence.status === 201, String(recurrence.status));

  const listed = (await priya.call(`/api/recurrences?groupId=${homeId}`)).body;
  check("the recurrence is listed for its group", listed.recurrences.length === 1);

  const outsiderRecurrences = (await outsider.call(`/api/recurrences?groupId=${homeId}`)).body;
  check(
    "a non-member sees none of the group's recurrences",
    outsiderRecurrences.recurrences.length === 0,
  );

  const fired = (await priya.call("/api/recurrences/run", { method: "POST" })).body;
  check("catching up posts every missed occurrence", fired.posted >= 3, `posted=${fired.posted}`);

  // Running again must post nothing: the occurrence id is derived from the
  // recurrence and the due date, so a replay collides on the primary key.
  const firedAgain = (await priya.call("/api/recurrences/run", { method: "POST" })).body;
  check("running again posts nothing", firedAgain.posted === 0, `posted=${firedAgain.posted}`);

  const rentRows = (await priya.call(`/api/groups/${homeId}/expenses?q=Rent`)).body.items;
  check("each occurrence is filed once", rentRows.length === fired.posted, `${rentRows.length} rows`);
  const rentDates = new Set(rentRows.map((row) => row.date.slice(0, 10)));
  check("occurrences are dated when they were due, not today", rentDates.size === rentRows.length);

  // -- Budgets --------------------------------------------------------------
  //
  // A budget tracks *your share*, not the group's spend: fronting a 1200 rent
  // you are half of must count 600.
  console.log("\nBudgets");
  // PUT, not POST: setting a budget replaces whatever was there for the same
  // scope, and an amount of zero removes it.
  const budget = await priya.call("/api/budgets", {
    method: "PUT",
    body: { groupId: homeId, amount: "1000000", currency: "EUR", period: "YEARLY" },
  });
  check("a budget is set", budget.status === 200, String(budget.status));

  const budgets = (await priya.call("/api/budgets")).body.budgets;
  check("the budget reports spending", budgets.length === 1 && BigInt(budgets[0].spent) > 0n,
    JSON.stringify(budgets[0]));
  check(
    "the budget counts only the viewer's share",
    BigInt(budgets[0].spent) < BigInt(stats0(await priya.call(`/api/groups/${homeId}/stats`))),
  );

  // Setting the same scope again replaces rather than duplicating - the scope
  // columns are nullable, so a unique constraint could not enforce this.
  await priya.call("/api/budgets", {
    method: "PUT",
    body: { groupId: homeId, amount: "900000", currency: "EUR", period: "YEARLY" },
  });
  const replaced = (await priya.call("/api/budgets")).body.budgets;
  check("setting the same scope replaces the budget", replaced.length === 1, `${replaced.length} budgets`);
  check("the replacement took the new amount", replaced[0].amount === "900000", replaced[0].amount);

  await priya.call("/api/budgets", {
    method: "PUT",
    body: { groupId: homeId, amount: "0", currency: "EUR", period: "YEARLY" },
  });
  const cleared = (await priya.call("/api/budgets")).body.budgets;
  check("a zero amount removes the budget", cleared.length === 0, `${cleared.length} budgets`);

  // -- People and rates -----------------------------------------------------
  console.log("\nPeople and rates");
  const people = (await priya.call("/api/people")).body.people;
  check("visible people include every group member", people.length >= 3, `${people.length} people`);
  check(
    "a stranger is not in the visible set",
    !people.some((person) => person.id === outsiderId),
  );

  const rate = await priya.call("/api/rates?base=EUR&quote=USD", { allowError: true });
  check("the rates endpoint answers", rate.status === 200, String(rate.status));

  // -- Rate limiting --------------------------------------------------------
  //
  // Invite codes are three short words, so a cap on attempts is what protects
  // them rather than entropy. Asserted here because the limiter is invisible
  // until it is the only thing standing between a guesser and every group.
  console.log("\nRate limiting");

  // The burst runs from its own source address, for two reasons: it proves the
  // limiter keys on the address rather than throttling the whole server, and it
  // keeps the allowance for every other section - and for the next run of this
  // suite - untouched. Without it, one pass would leave the real invite flow
  // rate-limited for ten minutes.
  const guesser = { "X-Forwarded-For": `203.0.113.${1 + Math.floor(Math.random() * 250)}` };

  let limited = null;
  for (let attempt = 0; attempt < 40 && !limited; attempt++) {
    const guess = await outsider.call(`/api/invite/wrong-guess-${attempt}`, {
      allowError: true,
      headers: guesser,
    });
    if (guess.status === 429) limited = guess;
  }
  check("guessing invite codes is eventually refused", Boolean(limited), "never hit 429");
  if (limited) {
    check("the refusal explains itself", typeof limited.body.error === "string");
  }

  // A different address must still be served: a limiter that throttles everyone
  // once one person guesses is a denial of service with extra steps.
  const bystander = await outsider.call(`/api/invite/${inviteCode}`, {
    allowError: true,
    headers: { "X-Forwarded-For": "198.51.100.7" },
  });
  check(
    "another address is unaffected",
    bystander.status !== 429,
    String(bystander.status),
  );

  // -- Ledger filters -------------------------------------------------------
  //
  // The endpoint has accepted `category` and `person` since it was written, but
  // nothing in the UI reached them until now. Asserted here because a filter
  // that silently returns everything looks exactly like a filter that works.
  console.log("\nLedger filters");

  // An expense deliberately excluding Ravi, so a person filter has something to
  // exclude - a group where every split includes everybody cannot tell a
  // working filter from a no-op.
  await priya.call("/api/expenses", {
    method: "POST",
    body: {
      groupId: homeId,
      description: "Solo laundry",
      amount: "500",
      currency: "EUR",
      splitMode: "EXACT",
      categoryId: "household",
      payers: [{ personId: priyaId, amount: "500" }],
      splits: [{ personId: priyaId, amount: "500", included: true }],
    },
  });

  const everything = (await priya.call(`/api/groups/${homeId}/expenses`)).body.items;
  const forRavi = (await priya.call(`/api/groups/${homeId}/expenses?person=${raviId}`)).body.items;
  const forPriya = (await priya.call(`/api/groups/${homeId}/expenses?person=${priyaId}`)).body.items;

  check(
    "a person filter excludes what they are not part of",
    forRavi.length < everything.length,
    `${forRavi.length} of ${everything.length}`,
  );
  check(
    "the excluded expense is the one left out",
    !forRavi.some((row) => row.expense?.description === "Solo laundry"),
  );
  check(
    "the payer still sees their own expense",
    forPriya.some((row) => row.expense?.description === "Solo laundry"),
  );

  const byCategory = (await priya.call(`/api/groups/${homeId}/expenses?category=household`)).body.items;
  check(
    "a category filter narrows to that category",
    byCategory.length > 0 && byCategory.length < everything.length,
    `${byCategory.length} of ${everything.length}`,
  );
  check(
    "every row in a category filter belongs to it",
    byCategory.every((row) => row.expense?.categoryId === "household"),
  );

  // Both filters and a search term at once. These used to collide: two of them
  // wanted an `OR` key on the same object literal, so the text filter was
  // silently dropped whenever a person filter was also set.
  const combined = (
    await priya.call(
      `/api/groups/${homeId}/expenses?person=${priyaId}&category=household&q=laundry`,
    )
  ).body.items;
  check(
    "person, category and search combine rather than overwrite",
    combined.length === 1 && combined[0].expense?.description === "Solo laundry",
    `${combined.length} rows`,
  );

  // -- Reporting ------------------------------------------------------------
  console.log("\nReporting");
  const stats = (await priya.call(`/api/groups/${groupId}/stats`)).body.stats;
  check("stats report every expense", stats.expenseCount >= 5, `count=${stats.expenseCount}`);
  check("category totals are present", stats.byCategory.length > 0);
  check(
    "category totals reconcile with the group total",
    sum(stats.byCategory.map((row) => row.total)) === BigInt(stats.totalSpend),
  );

  const csv = await fetch(`${BASE}/api/groups/${groupId}/export`, {
    headers: { Cookie: priya.cookie },
  });
  const csvText = await csv.text();
  check("CSV export is served", csv.status === 200);
  check("CSV has a header row", csvText.includes("Date,Type,Description"));
  check("CSV includes the payments", csvText.includes("Payment"));

  const search = (await priya.call("/api/search?q=Dinner")).body;
  check("search finds an expense", search.items.length > 0);

  const activity = (await priya.call("/api/activity")).body;
  check("activity feed is populated", activity.items.length > 0);
  check(
    "activity records the settlements",
    activity.items.some((item) => item.type === "settlement.created"),
  );

  // -- Deleting a settled group --------------------------------------------
  console.log("\nLifecycle");
  const deleted = await priya.call(`/api/groups/${groupId}`, {
    method: "DELETE",
    allowError: true,
  });
  check("a settled group can be deleted", deleted.status === 200, String(deleted.status));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nSmoke test crashed:", error.message);
  process.exit(1);
});
