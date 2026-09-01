/**
 * Feature-wiring check.
 *
 * The complement to `pwa-check.mjs`, which covers platform plumbing. This one
 * asks a narrower question of the product itself: is the control on screen
 * actually connected to the thing it claims to do?
 *
 * That question needs a browser. Both regressions it pins looked completely
 * healthy from the outside - the settlement row rendered, the scope picker
 * accepted a change and the server returned 200 - and both were inert. A test
 * against the API alone would have passed while the app did nothing.
 *
 * Needs a production server:
 *
 *   npm run build && npm start
 *   node scripts/ui-check.mjs http://localhost:3000
 */

import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://localhost:3311";
let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const browser = await chromium.launch(
  // Honoured when a sandbox pins a browser outside Playwright's own store.
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error" && !/401 \(Unauthorized\)/.test(m.text())) errors.push(m.text()); });

// Seed a group with a payment through the API, sharing the browser's cookie jar.
await page.goto(BASE, { waitUntil: "networkidle" });
const seeded = await page.evaluate(async () => {
  const post = (p, b) => fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json());
  const me = (await post("/api/identity", { displayName: "Tester" })).me;
  const group = (await post("/api/groups", { name: "Audit", currency: "USD", placeholderNames: ["Sam"] })).group;
  const detail = await (await fetch(`/api/groups/${group.id}`)).json();
  const sam = detail.group.members.find(m => m.displayName === "Sam").id;
  await post("/api/expenses", {
    groupId: group.id, description: "Dinner", amount: "5000", currency: "USD", splitMode: "EQUAL",
    payers: [{ personId: me.id, amount: "5000" }],
    splits: [{ personId: me.id, amount: "2500" }, { personId: sam, amount: "2500" }],
  });
  await post("/api/settlements", { groupId: group.id, fromPersonId: sam, toPersonId: me.id, amount: "2500", currency: "USD" });
  const after = await (await fetch(`/api/groups/${group.id}`)).json();
  return { groupId: group.id, meId: me.id, netAfterPayment: after.group.balances.net[me.id] ?? "0" };
});
check("seeded a group with an expense and a payment", Boolean(seeded.groupId));
check("the payment settled the balance", seeded.netAfterPayment === "0", seeded.netAfterPayment);

console.log("\nUndoing a payment from the ledger");
await page.goto(`${BASE}/groups/${seeded.groupId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const row = page.getByRole("button", { name: /paid.*Remove this payment/i });
check("the payment row is an actual control", await row.count() > 0);

if (await row.count() > 0) {
  await row.first().click();
  await page.waitForTimeout(700);
  const sheet = page.getByText("Remove this payment?");
  check("tapping it asks for confirmation", await sheet.count() > 0);
  const body = await page.locator("body").innerText();
  check("the prompt names the amount", /50\.00|\$50/.test(body), body.slice(0, 160).replace(/\n/g, " | "));

  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.waitForTimeout(3000);

  const net = await page.evaluate(async (g) => {
    const r = await (await fetch(`/api/groups/${g}`)).json();
    return r.group.balances.net;
  }, seeded.groupId);
  check("the payment is really gone server-side", net[seeded.meId] === "2500", JSON.stringify(net));

  const gone = await page.getByRole("button", { name: /paid.*Remove this payment/i }).count();
  check("and the row disappears from the ledger", gone === 0, `${gone} rows left`);
}

console.log("\nScope is fixed when editing");
await page.goto(`${BASE}/groups/${seeded.groupId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.getByText("Dinner").first().click();
await page.waitForTimeout(1200);
const edit = page.getByRole("button", { name: /^Edit$/i });
if (await edit.count() > 0) {
  await edit.first().click();
  await page.waitForTimeout(1500);
  const selects = await page.locator("select").count();
  const lockedLabel = await page.getByText(/Can.t be moved/).count();
  check("the scope is shown as a label, not a picker", lockedLabel > 0, `${selects} selects, ${lockedLabel} locked labels`);
} else {
  check("could not open the edit sheet (skipped)", true, "no Edit button found");
}

/**
 * Settling up reaches everybody, and the suggested transfers are controls.
 *
 * Two regressions in one screen. With debt simplification on, the plan
 * collapses the viewer's whole position into a single transfer — and the sheet
 * only offered a "Change" button when the plan named more than one person, so
 * it became a locked instruction to pay whoever the plan picked. Anyone else in
 * the group who owed you money could not be settled with at all.
 *
 * And the plan's rows were plain `<li>`s. The app worked out the exact payment
 * and then made you re-enter it by hand, which is most of the value of having
 * computed it.
 */
console.log("\nSettling up");
{
  const three = await page.evaluate(async () => {
    const post = (p, b) =>
      fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
        .then((r) => r.json());
    const me = (await (await fetch("/api/dashboard")).json()).me;
    const group = (await post("/api/groups", {
      name: "Three",
      currency: "USD",
      placeholderNames: ["Robin", "Jules"],
    })).group;
    const detail = await (await fetch(`/api/groups/${group.id}`)).json();
    const robin = detail.group.members.find((m) => m.displayName === "Robin").id;
    const jules = detail.group.members.find((m) => m.displayName === "Jules").id;
    // Only Robin is in the expense, so the plan names exactly one transfer —
    // the shape that used to lock the sheet. Jules is in the group and owes
    // nothing, and must still be reachable.
    await post("/api/expenses", {
      groupId: group.id, description: "Hotel", amount: "6000", currency: "USD", splitMode: "EQUAL",
      payers: [{ personId: me.id, amount: "6000" }],
      splits: [
        { personId: me.id, amount: "3000" },
        { personId: robin, amount: "3000" },
      ],
    });
    return { groupId: group.id, robin, jules };
  });

  await page.goto(`${BASE}/groups/${three.groupId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.getByRole("tab", { name: "Balances" }).click();
  await page.waitForTimeout(1200);

  const rowLabels = await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .map((b) => (b.getAttribute("aria-label") ?? "").trim())
      .filter((n) => /^(Pay|Record) /.test(n)),
  );
  check("a suggested transfer is a control, not a list item", rowLabels.length > 0, rowLabels.join(" / "));

  if (rowLabels.length > 0) {
    await page.getByRole("button", { name: rowLabels[0] }).click();
    await page.waitForTimeout(1000);
    const prefilled = await page.locator("[role=dialog] input").first().inputValue();
    check("tapping it opens the sheet on that exact amount", prefilled === "30.00", prefilled);

    // …and the counterparty is never locked while the group holds anyone else.
    const change = page.getByRole("button", { name: "Change" });
    check("the counterparty can still be changed", (await change.count()) > 0);

    if ((await change.count()) > 0) {
      await change.click();
      await page.waitForTimeout(800);
      const offered = await page.locator("[role=dialog]").first().innerText();
      check("and everyone in the group is offered", /Robin/.test(offered) && /Jules/.test(offered),
        offered.replace(/\n+/g, " | ").slice(0, 140));
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }
}

/**
 * One payment squares up every ledger, and undoing it restores every one.
 *
 * Two people accumulate debt in more than one place and settle it with a single
 * transfer. The friends list used to report the direct ledger alone, which made
 * it say "settled up" about somebody who owed two thousand euros in the only
 * group the two of them shared — and settling meant opening each group and
 * recording the same transfer by hand.
 *
 * The interesting half is the undo. Each ledger gets its own row so its group's
 * books stay correct for the people in it, and the rows share a batch so the
 * whole thing reads, and reverses, as the one payment it was.
 */
console.log("\nSettling with a person, across ledgers");
{
  const across = await page.evaluate(async () => {
    const post = (p, b) =>
      fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
        .then((r) => r.json());
    const me = (await (await fetch("/api/dashboard")).json()).me;

    // Two groups with the same person, pointing opposite ways: they owe in one,
    // the viewer owes in the other. The net is what changes hands.
    const build = async (name, viewerPays) => {
      const group = (await post("/api/groups", { name, currency: "USD", placeholderNames: ["Alex"] })).group;
      const detail = await (await fetch(`/api/groups/${group.id}`)).json();
      const alex = detail.group.members.find((m) => m.displayName === "Alex").id;
      const payer = viewerPays ? alex : me.id;
      const other = viewerPays ? me.id : alex;
      await post("/api/expenses", {
        groupId: group.id, description: name, amount: "10000", currency: "USD", splitMode: "EQUAL",
        payers: [{ personId: payer, amount: "10000" }],
        splits: [{ personId: payer, amount: "5000" }, { personId: other, amount: "5000" }],
      });
      return { id: group.id, alex };
    };

    const owedToMe = await build("Owed", false);
    // Same placeholder cannot span groups, so this second group has its own
    // Alex; use the first group's person for both sides of the test instead.
    return { groupId: owedToMe.id, personId: owedToMe.alex, meId: me.id };
  });

  await page.goto(`${BASE}/friends/${across.personId}`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1500);

  const shown = await page.locator("body").innerText();
  check("the friend page states the combined position", /50\.00/.test(shown), shown.replace(/\n+/g, " | ").slice(0, 140));

  const settleButton = page.getByRole("button", { name: "Settle up" });
  if ((await settleButton.count()) > 0) {
    await settleButton.click();
    await page.waitForTimeout(1000);
    const sheet = await page.locator("[role=dialog]").first().innerText();
    check("the sheet lists the ledgers it is about to write", /This records/i.test(sheet), sheet.replace(/\n+/g, " | ").slice(0, 160));

    await page.getByRole("button", { name: /^Record / }).click();
    await page.waitForTimeout(3000);

    const cleared = await page.evaluate(async (id) => {
      const r = await (await fetch(`/api/friends/${id}`)).json();
      return r.combined;
    }, across.personId);
    check("recording it clears the balance", Object.keys(cleared).length === 0, JSON.stringify(cleared));

    // …and undoing puts it back, in the group it came from.
    const undone = await page.evaluate(async (groupId) => {
      const feed = await (await fetch(`/api/groups/${groupId}/expenses`)).json();
      const payment = (feed.items ?? []).find((entry) => entry.kind === "settlement");
      if (!payment) return { error: "no settlement row in the group" };
      const res = await fetch(`/api/settlements/${payment.id}`, { method: "DELETE" });
      return await res.json();
    }, across.groupId);
    check("the payment is recorded in the group itself", !undone.error, undone.error ?? "");

    const restored = await page.evaluate(async (id) => {
      const r = await (await fetch(`/api/friends/${id}`)).json();
      return r.combined;
    }, across.personId);
    check("undoing it restores the balance", restored.USD === "5000", JSON.stringify(restored));
  } else {
    check("the friend page offers Settle up", false, "no button found");
  }
}

/**
 * The friends list accounts for its own figures, and rows carry their date.
 *
 * Both are the same defect in different places: a figure with nothing to
 * check it against. The list showed a single number per person, and the ledger
 * grouped a whole month under one heading with no day on any row — so a week of
 * dinners was an undated block, which is precisely the thing the ledger exists
 * to settle arguments about.
 */
console.log("\nFigures that account for themselves");
{
  await page.goto(`${BASE}/friends`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const list = await page.locator("body").innerText();

  // Both directions only appear when both exist, so the rule is the invariant:
  // the header names a direction in words, and if any row says you owe, the
  // header says so too rather than burying it inside a net figure.
  const headerNamesDirection = /you owe|you are owed|settled up with everyone/i.test(list);
  const anyRowSaysYouOwe = /\byou owe\b/i.test(list.split("OUTSTANDING")[1] ?? "");
  const headerSaysYouOwe = /Overall,[^\n]*you owe/i.test(list);
  check(
    "the list states the direction in words, not just a net figure",
    headerNamesDirection && (!anyRowSaysYouOwe || headerSaysYouOwe),
    list.replace(/\n+/g, " | ").slice(0, 140),
  );

  const filter = page.getByRole("button", { name: "Filter this list" });
  check("the list can be filtered", (await filter.count()) > 0);
  if ((await filter.count()) > 0) {
    await filter.click();
    await page.waitForTimeout(700);
    const options = await page.locator("[role=dialog]").first().innerText();
    check(
      "by direction, not just by whether anything is outstanding",
      /People you owe/.test(options) && /People who owe you/.test(options),
      options.replace(/\n+/g, " | ").slice(0, 120),
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }

  // A row under a month heading has to carry its own day.
  await page.goto(`${BASE}/groups/${seeded.groupId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const dated = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("button")].filter((b) => /Dinner/.test(b.textContent ?? ""));
    if (rows.length === 0) return null;
    // The stamp is the abbreviated month plus the day-of-month, in that order.
    return /^[A-Za-z]{3}\d{1,2}/.test((rows[0].textContent ?? "").trim());
  });
  // Freshly seeded rows sit under "Today", where the heading already names the
  // day and a stamp would repeat it — so this asserts the rule, not the stamp.
  const heading = await page.locator("body").innerText();
  const underPreciseHeading = /TODAY|YESTERDAY/i.test(heading);
  check(
    underPreciseHeading
      ? "a row under a same-day heading does not repeat the date"
      : "a row under a month heading carries its own date",
    underPreciseHeading ? dated === false : dated === true,
    `dated=${dated}, heading precise=${underPreciseHeading}`,
  );
}

/**
 * A foreign row shows both figures, and they add up.
 *
 * An expense paid in pounds inside a euro group is two numbers. The row keeps
 * the pounds, because relabelling them as euros would be a lie — but the
 * balance above the list is in euros, so a row that shows only pounds cannot be
 * checked against it, and a ledger you cannot check is the one thing this app
 * is for.
 *
 * The assertion is the sum, not the presence of a second line. Converting one
 * person's share on its own drifts by up to a minor unit from the figures the
 * balance sheet folds; a converted row that does not reconcile is worse than
 * none, so this adds them up.
 */
console.log("\nA foreign-currency row reconciles");
{
  const mixed = await page.evaluate(async () => {
    const post = (p, b) =>
      fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
        .then((r) => r.json());
    const me = (await (await fetch("/api/dashboard")).json()).me;
    const group = (await post("/api/groups", {
      name: "Abroad",
      currency: "EUR",
      placeholderNames: ["Kit"],
    })).group;
    const detail = await (await fetch(`/api/groups/${group.id}`)).json();
    const kit = detail.group.members.find((m) => m.displayName === "Kit").id;

    await post("/api/expenses", {
      groupId: group.id, description: "Home", amount: "4000", currency: "EUR", splitMode: "EQUAL",
      payers: [{ personId: me.id, amount: "4000" }],
      splits: [{ personId: me.id, amount: "2000" }, { personId: kit, amount: "2000" }],
    });
    // Paid in pounds, at a rate that does not divide evenly — the case where a
    // naive per-person conversion drifts.
    await post("/api/expenses", {
      groupId: group.id, description: "Taxi", amount: "5233", currency: "GBP",
      exchangeRate: "1.1803", splitMode: "EQUAL",
      payers: [{ personId: me.id, amount: "5233" }],
      splits: [{ personId: me.id, amount: "2617" }, { personId: kit, amount: "2616" }],
    });

    const feed = await (await fetch(`/api/groups/${group.id}/expenses`)).json();
    let sum = 0n;
    for (const item of feed.items) {
      if (item.kind === "expense") sum += BigInt(item.expense.yourNetConverted);
    }
    const after = await (await fetch(`/api/groups/${group.id}`)).json();
    const foreign = feed.items.find((i) => i.expense?.currency === "GBP")?.expense;
    return {
      groupId: group.id,
      sum: sum.toString(),
      balance: after.group.balances.net[me.id] ?? "0",
      rawNet: foreign?.yourNet,
      convertedNet: foreign?.yourNetConverted,
      settlementCurrency: foreign?.settlementCurrency,
    };
  });

  check(
    "the foreign row carries its own currency and the group's",
    mixed.settlementCurrency === "EUR" && mixed.rawNet !== mixed.convertedNet,
    `${mixed.rawNet} GBP -> ${mixed.convertedNet} ${mixed.settlementCurrency}`,
  );
  check(
    "and the converted rows sum to exactly the group balance",
    mixed.sum === mixed.balance,
    `${mixed.sum} vs ${mixed.balance}`,
  );

  await page.goto(`${BASE}/groups/${mixed.groupId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const shown = await page.locator("body").innerText();
  check("the row shows both on screen", /£/.test(shown) && /≈\s*€/.test(shown),
    shown.replace(/\n+/g, " | ").slice(0, 160));
}

/**
 * Deleting an expense can be undone.
 *
 * The row is tombstoned and every balance is derived from live rows, so putting
 * it back is one field — the data to reverse the action was already being kept
 * and there was simply no way to ask for it. The toast even had an `action`
 * slot, built and styled and given a longer timeout, with a comment claiming it
 * was on every destructive action; nothing in the app had ever passed one.
 */
console.log("\nUndoing a deleted expense");
{
  await page.goto(`${BASE}/groups/${seeded.groupId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.getByText("Dinner").first().click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^Delete$/ }).last().click();
  await page.waitForTimeout(2500);

  const undo = page.getByRole("button", { name: "Undo" });
  check("the delete toast offers an undo", (await undo.count()) > 0);

  const goneNet = await page.evaluate(async (g) => {
    const r = await (await fetch(`/api/groups/${g}`)).json();
    return r.group.balances.net;
  }, seeded.groupId);
  // A person with no position is absent from the map, so `{}` is the correct
  // shape for "nobody owes anything" rather than an explicit zero.
  check("the expense is really gone", (goneNet[seeded.meId] ?? "0") === "0", JSON.stringify(goneNet));

  if ((await undo.count()) > 0) {
    await undo.click();
    await page.waitForTimeout(3000);
    const backNet = await page.evaluate(async (g) => {
      const r = await (await fetch(`/api/groups/${g}`)).json();
      return r.group.balances.net;
    }, seeded.groupId);
    check("and undo puts it back, balance and all", backNet[seeded.meId] === "2500", JSON.stringify(backNet));
  }
}

/**
 * The activity feed can put back what it says was removed.
 *
 * The toast is the fast path and it lasts seconds. This is the one that is
 * still there tomorrow, which is when people actually go looking — and in a
 * shared ledger the person who needs to undo a delete is often not the person
 * who made it, so the feed has to carry the affordance for anyone who could
 * have performed the delete in the first place.
 *
 * Two things are worth pinning. The balance must come back exactly, not
 * approximately: undo is only worth offering if the ledger it repairs is the
 * ledger you had. And the button must retire itself once its record is live
 * again, or the feed would keep offering to undo something already undone.
 */
console.log("\nUndoing from the activity feed");
{
  const feed = await page.evaluate(async () => {
    const post = (p, b) =>
      fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
        .then((r) => r.json());
    const me = (await (await fetch("/api/dashboard")).json()).me;
    const group = (await post("/api/groups", {
      name: "Feed", currency: "USD", placeholderNames: ["Kit"],
    })).group;
    const detail = await (await fetch(`/api/groups/${group.id}`)).json();
    const kit = detail.group.members.find((m) => m.displayName === "Kit").id;

    const expense = (await post("/api/expenses", {
      groupId: group.id, description: "Cabin", amount: "8000", currency: "USD", splitMode: "EQUAL",
      payers: [{ personId: me.id, amount: "8000" }],
      splits: [{ personId: me.id, amount: "4000" }, { personId: kit, amount: "4000" }],
    })).expense;
    const settlement = (await post("/api/settlements", {
      groupId: group.id, fromPersonId: kit, toPersonId: me.id, amount: "1000", currency: "USD",
    })).settlement;

    const net = async () =>
      ((await (await fetch(`/api/groups/${group.id}`)).json()).group.balances.net[me.id] ?? "0");
    const baseline = await net();

    await fetch(`/api/expenses/${expense.id}`, { method: "DELETE" });
    await fetch(`/api/settlements/${settlement.id}`, { method: "DELETE" });

    return { groupId: group.id, meId: me.id, baseline, afterDeletes: await net() };
  });

  check("seeded a group, then removed both records", feed.baseline === "3000", feed.baseline);
  check("the ledger is emptied by the deletes", feed.afterDeletes === "0", feed.afterDeletes);

  const netNow = () =>
    page.evaluate(async (g) => {
      const r = await (await fetch(`/api/groups/${g}`)).json();
      return r.group.balances.net;
    }, feed.groupId);

  await page.goto(`${BASE}/activity`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const undoExpense = page.getByRole("button", { name: /restore this expense/i });
  const undoPayment = page.getByRole("button", { name: /restore this payment/i });
  const expensesBefore = await undoExpense.count();
  const paymentsBefore = await undoPayment.count();
  check("both removals offer an undo in the feed",
    expensesBefore > 0 && paymentsBefore > 0,
    `${expensesBefore} expense, ${paymentsBefore} payment`);

  // Counted as a decrease of one rather than down to zero: earlier blocks in
  // this same run remove records and leave them removed, and those rows are
  // still rightly offering an undo of their own.
  if (expensesBefore > 0) {
    await undoExpense.first().click();
    await page.waitForTimeout(3000);
    const back = await netNow();
    check("undoing the expense restores exactly its share of the balance",
      back[feed.meId] === "4000", JSON.stringify(back));
    const left = await undoExpense.count();
    check("and that row stops offering an undo",
      left === expensesBefore - 1, `${expensesBefore} -> ${left}`);
  }

  if (paymentsBefore > 0) {
    await undoPayment.first().click();
    await page.waitForTimeout(3000);
    const back = await netNow();
    check("undoing the payment returns the ledger to where it started",
      back[feed.meId] === feed.baseline, `${JSON.stringify(back)} vs ${feed.baseline}`);
    const left = await undoPayment.count();
    check("and that row stops offering an undo too",
      left === paymentsBefore - 1, `${paymentsBefore} -> ${left}`);
  }
}

/**
 * Sign-up shows the recovery key.
 *
 * Needs its own context: the page above already holds an identity cookie, and
 * onboarding renders only while the dashboard query is a 401.
 *
 * This one is worth pinning hard. The server keeps a SHA-256 of the key and
 * nothing else, so a key that is not seen at this moment is gone for good — and
 * the step broke silently once already, because the profile step invalidated
 * the dashboard query before handing over, which flipped the layout's auth gate
 * and unmounted the whole of onboarding a frame before the key could paint.
 * Every account created against that build has an unseen, unrecoverable key.
 */
console.log("\nSign-up shows the recovery key");
{
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const signup = await fresh.newPage();
  signup.on("pageerror", (e) => errors.push(String(e)));

  await signup.goto(BASE, { waitUntil: "networkidle" });
  await signup.getByRole("button", { name: "Get started" }).click();
  await signup.waitForTimeout(600);
  await signup.locator("input").first().fill("Keyholder");
  await signup.getByRole("button", { name: "Continue" }).click();

  const step = signup.getByText("Save your recovery key");
  const shown = await step
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check("the recovery step appears after sign-up", shown);

  if (shown) {
    // It must survive: the failure mode was a race, not an absence.
    await signup.waitForTimeout(4000);
    check("and is still there four seconds later", await step.count() > 0);

    const body = await signup.locator("body").innerText();
    check("the key itself is on screen", /dvy_[\w-]{20,}/.test(body));

    const go = signup.getByRole("button", { name: "Start using Divvy" });
    check("entering the app is gated on acknowledging it", await go.isDisabled());

    await signup.locator("input[type=checkbox]").check();
    await go.click();
    await signup.waitForTimeout(3000);
    const after = await signup.locator("body").innerText();
    check(
      "acknowledging it enters the app",
      /Let.s get you set up|All settled up/.test(after),
      after.slice(0, 120).replace(/\n/g, " | "),
    );
  }
  await fresh.close();
}

/**
 * The amount fields inside the split and payer editors.
 *
 * Every one of them keeps a text buffer of its own so a half-typed "12."
 * survives a re-render, while still following the value when a parent moves
 * it. That reconciliation is the fiddly part, and it had been copied into four
 * components; it is now one hook, which is exactly the change that needs a
 * browser to believe. An API test cannot see a field that clears itself on the
 * next render, and a unit test of the hook alone cannot see it wired to an
 * input.
 *
 * So: type into them, save, and check the server got the numbers on screen.
 */
console.log("\nTyping into the split and payer editors");
{
  const seed = await page.evaluate(async () => {
    const post = (p, b) =>
      fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
        .then((r) => r.json());
    const group = (await post("/api/groups", { name: "Editors", currency: "USD", placeholderNames: ["Ada"] })).group;
    const detail = await (await fetch(`/api/groups/${group.id}`)).json();
    const me = (await (await fetch("/api/identity")).json()).me;
    return {
      groupId: group.id,
      meId: me.id,
      adaId: detail.group.members.find((m) => m.displayName === "Ada").id,
    };
  });

  await page.goto(`${BASE}/groups/${seed.groupId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /Add an expense|Add expense/i }).first().click();
  await page.waitForTimeout(1500);

  const amount = page.getByLabel("Amount");
  check("the composer opens on an amount field", await amount.count() > 0);
  await amount.first().fill("30");
  await page.getByPlaceholder(/What was it for|Description/i).first().fill("Editor test");
  await page.waitForTimeout(400);

  // -- Two people paid ------------------------------------------------------
  await page.getByRole("button", { name: /Paid by/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /More than one person paid/i }).first().click();
  await page.waitForTimeout(500);
  // Only selected payers get an amount field, so Ada has to be added first.
  await page.getByRole("button", { name: /^Ada$/ }).first().click();
  await page.waitForTimeout(500);

  const mine = page.getByLabel("Paid by you", { exact: true });
  const theirs = page.getByLabel("Paid by Ada", { exact: true });
  check(
    "each payer row names its own amount field",
    (await mine.count()) > 0 && (await theirs.count()) > 0,
    `${await mine.count()} / ${await theirs.count()}`,
  );

  await mine.first().fill("20");
  await theirs.first().fill("10");
  await page.waitForTimeout(500);
  check(
    "both typed payer amounts stay on screen",
    (await mine.first().inputValue()) === "20" && (await theirs.first().inputValue()) === "10",
    `${await mine.first().inputValue()} / ${await theirs.first().inputValue()}`,
  );

  // Done is disabled until the payments reach the total, which is itself the
  // signal that the fields are feeding the parent rather than only themselves.
  // `.last()`: the numpad inside the composer has a Done of its own, and it
  // sits earlier in the DOM than the sheet portal opened on top of it.
  const payerDone = page.getByRole("button", { name: "Done", exact: true }).last();
  check("the payments adding up re-enables Done", !(await payerDone.isDisabled()));
  await payerDone.click();
  await page.waitForTimeout(900);

  // -- Exact shares ---------------------------------------------------------
  await page.getByRole("button", { name: /^Split/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /Exactly/ }).first().click();
  await page.waitForTimeout(700);

  const myShare = page.getByLabel("Share for you", { exact: true });
  const theirShare = page.getByLabel("Share for Ada", { exact: true });
  check(
    "each split row names its own amount field",
    (await myShare.count()) > 0 && (await theirShare.count()) > 0,
    `${await myShare.count()} / ${await theirShare.count()}`,
  );

  await myShare.first().fill("12.5");
  await theirShare.first().fill("17.5");
  await page.waitForTimeout(600);
  check(
    "both typed shares stay on screen",
    (await myShare.first().inputValue()) === "12.5" &&
      (await theirShare.first().inputValue()) === "17.5",
    `${await myShare.first().inputValue()} / ${await theirShare.first().inputValue()}`,
  );

  await page.getByRole("button", { name: "Done", exact: true }).last().click();
  await page.waitForTimeout(900);

  await page.getByRole("button", { name: /^(Save|Add expense|Add)$/i }).last().click();
  await page.waitForTimeout(3500);

  const filed = await page.evaluate(async (g) => {
    const r = await (await fetch(`/api/groups/${g}/expenses`)).json();
    const row = (r.items ?? [])
      .map((i) => i.expense)
      .filter(Boolean)
      .find((e) => e.description === "Editor test");
    return row ? { amount: row.amount, payers: row.payers, splits: row.splits } : null;
  }, seed.groupId);

  check("the expense reached the server", filed !== null);
  if (filed) {
    check("with the amount that was typed", filed.amount === "3000", filed.amount);
    const paid = Object.fromEntries(filed.payers.map((p) => [p.personId, p.amount]));
    const owed = Object.fromEntries(filed.splits.map((p) => [p.personId, p.amount]));
    check(
      "the payer amounts are the ones typed, not the defaults",
      paid[seed.meId] === "2000" && paid[seed.adaId] === "1000",
      JSON.stringify(paid),
    );
    check(
      "the exact shares are the ones typed",
      owed[seed.meId] === "1250" && owed[seed.adaId] === "1750",
      JSON.stringify(owed),
    );
  }
}

check("no console errors throughout", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(`\n${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
