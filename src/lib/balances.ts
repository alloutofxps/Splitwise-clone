/**
 * Balance computation.
 *
 * Two different answers matter to users and they are not the same number:
 *
 *   1. The **pairwise ledger** - "you owe Priya 40, Priya owes Tom 40". This is
 *      the literal history: every expense creates debts from the people who ate
 *      to the people who paid, and settlements pay them down. Nothing is
 *      invented, so anyone can audit it against the expense list.
 *
 *   2. The **simplified plan** - "you owe Tom 40, Priya is square". Same net
 *      position, fewer transfers. Great for a holiday wrap-up, mildly alarming
 *      if you have never lent Tom anything, which is why it is a per-group
 *      toggle rather than the only view.
 *
 * All amounts are minor units of a single currency; callers bucket by currency
 * before calling in.
 */

import { abs, sum } from "./money";
import { apportion } from "./split";

export interface PersonAmount {
  personId: string;
  amount: bigint;
}

export type BalanceEvent =
  | {
      kind: "expense";
      id: string;
      /** Who fronted money. Amounts sum to the expense total. */
      paid: PersonAmount[];
      /** Who consumed it. Amounts sum to the expense total. */
      owed: PersonAmount[];
    }
  | {
      kind: "settlement";
      id: string;
      fromPersonId: string;
      toPersonId: string;
      amount: bigint;
    };

export interface DebtEdge {
  fromPersonId: string;
  toPersonId: string;
  amount: bigint;
}

export interface BalanceSheet {
  /** Net position per person: positive means the group owes them. */
  net: Map<string, bigint>;
  /** Literal who-owes-whom, netted per pair. */
  pairwise: DebtEdge[];
  /** Fewest transfers that reach the same net position. */
  simplified: DebtEdge[];
  /** Total value of every expense seen. */
  totalSpend: bigint;
}

// ---------------------------------------------------------------------------

// The separator is written as an escape rather than a literal NUL: the byte
// itself is what we want (no person id can contain it), but a raw control
// character in the source makes grep call this file binary and hides it from
// every search that would otherwise find it.
const pairKey = (a: string, b: string) => `${a}\u0000${b}`;

/**
 * Turns one expense into debt edges.
 *
 * With a single payer this is simply "everyone owes the payer their share".
 * With several payers there is no single right answer, so each debtor's
 * shortfall is apportioned across the creditors in proportion to how much each
 * creditor is still out of pocket.
 *
 * "Still" is doing real work in that sentence. Weighting by each creditor's
 * *original* surplus balances every row and no column: apportionment rounds in
 * the creditors' favour independently for each debtor, and those roundings do
 * not cancel. A ten-pound dinner where Ana puts in 7 and Ben 3, split evenly
 * between two other people, produced a ledger reading "Ana is owed 8, Ben is
 * owed 2" - both wrong by a unit, against a net map that correctly said 7 and
 * 3. Two screens, two answers, from the same expense.
 *
 * Weighting by what is *left* to allocate fixes it structurally rather than by
 * patching up the total afterwards. Largest-remainder never hands anybody more
 * than the ceiling of their ideal share, and once the weights are the remaining
 * capacities that ceiling is the capacity itself, so no creditor can be
 * over-paid; the debts and the credits sum to the same figure, so the last
 * debtor drains what is left to exactly zero. Rows and columns both balance,
 * for every input, with no rounding drift.
 */
function expenseEdges(paid: PersonAmount[], owed: PersonAmount[]): DebtEdge[] {
  const net = new Map<string, bigint>();
  for (const p of paid) net.set(p.personId, (net.get(p.personId) ?? 0n) + p.amount);
  for (const o of owed) net.set(o.personId, (net.get(o.personId) ?? 0n) - o.amount);

  const creditors: PersonAmount[] = [];
  const debtors: PersonAmount[] = [];
  for (const [personId, amount] of net) {
    if (amount > 0n) creditors.push({ personId, amount });
    else if (amount < 0n) debtors.push({ personId, amount: -amount });
  }
  if (creditors.length === 0 || debtors.length === 0) return [];

  // Deterministic ordering keeps output stable across runs and machines.
  creditors.sort((a, b) => (a.personId < b.personId ? -1 : 1));
  debtors.sort((a, b) => (a.personId < b.personId ? -1 : 1));

  if (creditors.length === 1) {
    const to = creditors[0].personId;
    return debtors.map((d) => ({
      fromPersonId: d.personId,
      toPersonId: to,
      amount: d.amount,
    }));
  }

  const remaining = creditors.map((c) => c.amount);
  const edges: DebtEdge[] = [];
  for (const debtor of debtors) {
    // Defensive: reachable only if the paid and owed sides disagree, which the
    // API refuses to store. Stopping leaves the surplus unattributed rather
    // than inventing a creditor to hang it on.
    if (sum(remaining) <= 0n) break;

    const shares = apportion(debtor.amount, remaining.map(Number));
    creditors.forEach((creditor, i) => {
      if (shares[i] <= 0n) return;
      remaining[i] -= shares[i];
      edges.push({
        fromPersonId: debtor.personId,
        toPersonId: creditor.personId,
        amount: shares[i],
      });
    });
  }
  return edges;
}

/**
 * Minimum cash flow.
 *
 * Repeatedly match the biggest debtor with the biggest creditor. Finding the
 * true minimum number of transfers is NP-hard, but this greedy pass always
 * produces at most n-1 transfers and hits the optimum for the group sizes a
 * bill-splitting app actually sees.
 *
 * The input map is not mutated.
 */
export function simplifyDebts(net: Map<string, bigint>): DebtEdge[] {
  const debtors: PersonAmount[] = [];
  const creditors: PersonAmount[] = [];
  for (const [personId, amount] of net) {
    if (amount < 0n) debtors.push({ personId, amount: -amount });
    else if (amount > 0n) creditors.push({ personId, amount });
  }

  // Descending by amount, then by id, so the plan is reproducible.
  const byAmountDesc = (a: PersonAmount, b: PersonAmount) =>
    a.amount !== b.amount ? (a.amount > b.amount ? -1 : 1) : a.personId < b.personId ? -1 : 1;
  debtors.sort(byAmountDesc);
  creditors.sort(byAmountDesc);

  const edges: DebtEdge[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = debtor.amount < creditor.amount ? debtor.amount : creditor.amount;

    if (amount > 0n) {
      edges.push({
        fromPersonId: debtor.personId,
        toPersonId: creditor.personId,
        amount,
      });
    }

    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount === 0n) i++;
    if (creditor.amount === 0n) j++;
  }
  return edges;
}

/**
 * The accumulator behind a balance sheet.
 *
 * Separate from `BalanceSheet` because the pair map is the form that can absorb
 * another event; `pairwise` is the presentation of it, with cancelled pairs
 * dropped and the signs already resolved.
 */
interface Ledger {
  net: Map<string, bigint>;
  /** Canonical (lower id, higher id) key to a signed amount. */
  pairs: Map<string, bigint>;
  totalSpend: bigint;
}

/** Folds one event into a ledger, in place. */
function accumulate(ledger: Ledger, event: BalanceEvent): void {
  const bump = (personId: string, delta: bigint) =>
    ledger.net.set(personId, (ledger.net.get(personId) ?? 0n) + delta);

  const addEdge = (from: string, to: string, amount: bigint) => {
    if (from === to || amount === 0n) return;
    // Both directions share one canonical key so A->B and B->A cancel out.
    const [x, y] = from < to ? [from, to] : [to, from];
    const signed = from < to ? amount : -amount;
    const key = pairKey(x, y);
    ledger.pairs.set(key, (ledger.pairs.get(key) ?? 0n) + signed);
  };

  if (event.kind === "expense") {
    for (const p of event.paid) bump(p.personId, p.amount);
    for (const o of event.owed) bump(o.personId, -o.amount);
    ledger.totalSpend += sum(event.paid.map((p) => p.amount));
    for (const edge of expenseEdges(event.paid, event.owed)) {
      addEdge(edge.fromPersonId, edge.toPersonId, edge.amount);
    }
  } else {
    // Paying someone back moves you toward zero and them away from it.
    bump(event.fromPersonId, event.amount);
    bump(event.toPersonId, -event.amount);
    addEdge(event.toPersonId, event.fromPersonId, event.amount);
  }
}

/** Turns an accumulator into the sheet callers read. */
function present(ledger: Ledger): BalanceSheet {
  const pairwise: DebtEdge[] = [];
  for (const [key, signed] of ledger.pairs) {
    if (signed === 0n) continue;
    const [x, y] = key.split("\u0000");
    pairwise.push(
      signed > 0n
        ? { fromPersonId: x, toPersonId: y, amount: signed }
        : { fromPersonId: y, toPersonId: x, amount: -signed },
    );
  }
  pairwise.sort((a, b) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0));

  return {
    net: ledger.net,
    pairwise,
    simplified: simplifyDebts(ledger.net),
    totalSpend: ledger.totalSpend,
  };
}

export function computeBalances(events: BalanceEvent[]): BalanceSheet {
  const ledger: Ledger = { net: new Map(), pairs: new Map(), totalSpend: 0n };
  for (const event of events) accumulate(ledger, event);
  return present(ledger);
}

/**
 * Adds one event to an already-computed sheet.
 *
 * This exists so the client can show what a new expense does to every balance
 * the moment it is typed, without waiting for the server and without a second,
 * approximate copy of these rules drifting out of step with this one. The
 * property test states what makes that safe: applying an event to a sheet gives
 * the same answer as recomputing the whole history with that event appended.
 *
 * `pairwise` is why this cannot work from the net map alone - it accumulates
 * over events rather than being a function of the final positions - so the
 * sheet is decomposed back into its accumulator, folded, and presented again.
 * Neither the input sheet nor its maps are mutated.
 */
export function applyEvent(sheet: BalanceSheet, event: BalanceEvent): BalanceSheet {
  const ledger: Ledger = {
    net: new Map(sheet.net),
    pairs: new Map(),
    totalSpend: sheet.totalSpend,
  };

  // Rebuilding the pair map from the presented edges is lossless: every edge in
  // `pairwise` is already netted per pair, so re-signing it recovers exactly
  // the entry it came from. Pairs that cancelled to zero are absent from both.
  for (const edge of sheet.pairwise) {
    const forward = edge.fromPersonId < edge.toPersonId;
    const [x, y] = forward
      ? [edge.fromPersonId, edge.toPersonId]
      : [edge.toPersonId, edge.fromPersonId];
    ledger.pairs.set(pairKey(x, y), forward ? edge.amount : -edge.amount);
  }

  accumulate(ledger, event);
  return present(ledger);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** What one person sees: who they owe, who owes them, and the net. */
export interface PersonalBalance {
  net: bigint;
  owes: DebtEdge[];
  owed: DebtEdge[];
}

export function personalBalance(
  sheet: BalanceSheet,
  personId: string,
  simplified: boolean,
): PersonalBalance {
  const edges = simplified ? sheet.simplified : sheet.pairwise;
  return {
    net: sheet.net.get(personId) ?? 0n,
    owes: edges.filter((e) => e.fromPersonId === personId),
    owed: edges.filter((e) => e.toPersonId === personId),
  };
}

/**
 * Rolls several groups' sheets into the number that belongs at the top of the
 * home screen. Returns per-currency totals, because "you are owed 40" means
 * nothing if the 40 is a mix of euros and rupees.
 */
export function aggregateNet(
  sheets: { currency: string; sheet: BalanceSheet }[],
  personId: string,
): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const { currency, sheet } of sheets) {
    const value = sheet.net.get(personId) ?? 0n;
    if (value === 0n) continue;
    totals.set(currency, (totals.get(currency) ?? 0n) + value);
  }
  for (const [code, value] of [...totals]) if (value === 0n) totals.delete(code);
  return totals;
}

export const magnitude = abs;
