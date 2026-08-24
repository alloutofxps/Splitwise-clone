/**
 * Split algorithms.
 *
 * Every mode resolves to the same thing: a list of `{ personId, amount }` in
 * minor units that sums *exactly* to the expense total. Sub-unit remainders are
 * never dropped, because a group that adds a hundred three-way coffees would
 * otherwise drift by a euro and nobody would be able to explain where it went.
 *
 * Remainder policy: leftover minor units go to whoever paid, before anyone
 * else. The payer is already out of pocket, so absorbing a stray cent is both
 * the fairest option and the one that is easiest to explain in the UI ("you
 * covered the odd cent").
 */

import { abs, sum } from "./money";

export const SPLIT_MODES = [
  "EQUAL",
  "EXACT",
  "PERCENT",
  "SHARES",
  "ADJUSTMENT",
  "ITEMIZED",
] as const;

export type SplitMode = (typeof SPLIT_MODES)[number];

export interface SplitParticipant {
  personId: string;
  /** EQUAL / ITEMIZED: is this person in on the expense at all. */
  included?: boolean;
  /** EXACT: the literal amount this person owes, in minor units. */
  amount?: bigint;
  /** PERCENT: percentage points. The set must total 100. */
  percent?: number;
  /** SHARES: relative weight, e.g. 2 for a couple sharing one plate. */
  weight?: number;
  /** ADJUSTMENT: a fixed amount taken off the top before the equal split. */
  adjustment?: bigint;
}

export interface ItemLine {
  id: string;
  amount: bigint;
  /** Person ids sharing this line. Empty means "everyone in the expense". */
  participantIds: string[];
}

export interface SplitInput {
  mode: SplitMode;
  total: bigint;
  participants: SplitParticipant[];
  /** Who fronted the money — used to decide who absorbs rounding remainders. */
  payerIds?: string[];
  /** ITEMIZED only. */
  items?: ItemLine[];
}

export interface ResolvedSplit {
  personId: string;
  amount: bigint;
  included: boolean;
  weight?: number;
  percent?: number;
  adjustment?: bigint;
}

export interface SplitResult {
  splits: ResolvedSplit[];
  /** Empty when the split is valid and safe to save. */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Remainder allocation
// ---------------------------------------------------------------------------

/**
 * Largest-remainder apportionment.
 *
 * `weights` are arbitrary non-negative numbers. Each recipient gets
 * floor(total * w / Σw), and the minor units left over are handed out one at a
 * time in descending order of the fractional part that was truncated.
 *
 * Ties (which are the common case for an equal split) are broken by
 * `priority` — lower sorts first — so the caller can put payers at the front.
 */
/** `n` equal weights. Typed, unlike `new Array(n).fill(1)`, which is `any[]`. */
function evenWeights(n: number): number[] {
  return Array.from({ length: n }, () => 1);
}

export function apportion(
  total: bigint,
  weights: number[],
  priority: number[] = [],
): bigint[] {
  const n = weights.length;
  if (n === 0) return [];

  /*
   * Non-finite weights are flattened to zero before anything else touches them.
   *
   * `BigInt(NaN)` and `BigInt(Infinity)` both throw a `RangeError`, and this
   * runs inside the balance fold - so one bad weight does not fail a split, it
   * takes down every screen that reads the group. A `NaN` also defeats the
   * guard below on its own, since `NaN <= 0` is false.
   *
   * Zero is the right flattening because it is already how a negative weight is
   * treated: somebody contributing nothing to the split. And if every weight
   * flattens away, the fallbacks below hand out evenly rather than dividing by
   * zero, so the parts still sum to the total.
   *
   * The API rejects non-finite weights at the schema, and `MAX_MINOR_UNITS`
   * keeps converted amounts inside float range. This is the layer that holds
   * when neither applies - a stored row from an older build, or the client's
   * own optimistic fold.
   */
  weights = weights.map((w) => (Number.isFinite(w) ? w : 0));

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) {
    // Degenerate input (all weights zero): fall back to an even hand-out so we
    // still return something that sums to `total`.
    return apportion(total, evenWeights(n), priority);
  }

  const negative = total < 0n;
  const magnitude = negative ? -total : total;

  // Work in integer space: scale weights to integers to avoid float error in
  // the floor division.
  const SCALE = 1_000_000;
  const intWeights = weights.map((w) => BigInt(Math.round(Math.max(0, w) * SCALE)));
  const weightSum = sum(intWeights);
  if (weightSum === 0n) return apportion(total, evenWeights(n), priority);

  const base: bigint[] = [];
  const remainders: bigint[] = [];
  for (let i = 0; i < n; i++) {
    const numerator = magnitude * intWeights[i];
    base.push(numerator / weightSum);
    remainders.push(numerator % weightSum);
  }

  let leftover = magnitude - sum(base);

  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    if (remainders[a] !== remainders[b]) return remainders[a] > remainders[b] ? -1 : 1;
    const pa = priority[a] ?? Number.MAX_SAFE_INTEGER;
    const pb = priority[b] ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a - b;
  });

  for (let i = 0; leftover > 0n && i < order.length; i++, leftover--) {
    base[order[i]] += 1n;
  }
  // With more leftover units than recipients (impossible for a well-formed
  // apportionment, but cheap to guard) keep cycling.
  let cursor = 0;
  while (leftover > 0n) {
    base[order[cursor % order.length]] += 1n;
    cursor++;
    leftover--;
  }

  return negative ? base.map((v) => -v) : base;
}

/** Priority ranks: payers first (0), everyone else after (1). */
function priorityFor(participants: SplitParticipant[], payerIds: string[] = []): number[] {
  const payers = new Set(payerIds);
  return participants.map((p) => (payers.has(p.personId) ? 0 : 1));
}

// ---------------------------------------------------------------------------
// The modes
// ---------------------------------------------------------------------------

export function resolveSplit(input: SplitInput): SplitResult {
  const { mode, total, participants, payerIds = [] } = input;
  const errors: string[] = [];

  if (participants.length === 0) {
    return { splits: [], errors: ["Pick at least one person to split with."] };
  }
  const ids = new Set<string>();
  for (const p of participants) {
    if (ids.has(p.personId)) errors.push("The same person appears twice in the split.");
    ids.add(p.personId);
  }

  switch (mode) {
    case "EQUAL":
      return withErrors(equalSplit(total, participants, payerIds), errors);
    case "EXACT":
      return withErrors(exactSplit(total, participants), errors);
    case "PERCENT":
      return withErrors(percentSplit(total, participants, payerIds), errors);
    case "SHARES":
      return withErrors(sharesSplit(total, participants, payerIds), errors);
    case "ADJUSTMENT":
      return withErrors(adjustmentSplit(total, participants, payerIds), errors);
    case "ITEMIZED":
      return withErrors(itemizedSplit(total, participants, input.items ?? [], payerIds), errors);
    default:
      // Unreachable while `mode` is a SplitMode, but the API takes this value
      // from a request body: a client sending a mode this build does not know
      // must get an error rather than an empty split that silently balances.
      return {
        splits: [],
        errors: [`Unknown split mode "${String(mode)}".`],
      };
  }
}

function withErrors(result: SplitResult, extra: string[]): SplitResult {
  return { splits: result.splits, errors: [...extra, ...result.errors] };
}

function equalSplit(
  total: bigint,
  participants: SplitParticipant[],
  payerIds: string[],
): SplitResult {
  const included = participants.filter((p) => p.included !== false);
  if (included.length === 0) {
    return { splits: [], errors: ["Everyone has been switched off — nobody would owe anything."] };
  }

  const amounts = apportion(
    total,
    included.map(() => 1),
    priorityFor(included, payerIds),
  );

  const byId = new Map(included.map((p, i) => [p.personId, amounts[i]]));
  return {
    splits: participants.map((p) => ({
      personId: p.personId,
      amount: byId.get(p.personId) ?? 0n,
      included: byId.has(p.personId),
    })),
    errors: [],
  };
}

function exactSplit(total: bigint, participants: SplitParticipant[]): SplitResult {
  const errors: string[] = [];
  const splits = participants.map((p) => ({
    personId: p.personId,
    amount: p.amount ?? 0n,
    included: (p.amount ?? 0n) !== 0n,
  }));

  const assigned = sum(splits.map((s) => s.amount));
  if (assigned !== total) {
    const diff = total - assigned;
    errors.push(
      diff > 0n
        ? `${formatGap(diff)} still needs to be assigned.`
        : `${formatGap(-diff)} more has been assigned than the expense total.`,
    );
  }
  return { splits, errors };
}

function percentSplit(
  total: bigint,
  participants: SplitParticipant[],
  payerIds: string[],
): SplitResult {
  const errors: string[] = [];
  const percents = participants.map((p) => p.percent ?? 0);
  const totalPercent = percents.reduce((a, b) => a + b, 0);

  // Percentages come from a UI with one decimal place, so compare with a small
  // epsilon rather than exact equality.
  if (Math.abs(totalPercent - 100) > 0.01) {
    errors.push(
      totalPercent < 100
        ? `${round1(100 - totalPercent)}% left to assign.`
        : `${round1(totalPercent - 100)}% over 100%.`,
    );
  }

  const amounts = apportion(total, percents, priorityFor(participants, payerIds));
  return {
    splits: participants.map((p, i) => ({
      personId: p.personId,
      amount: amounts[i],
      included: (p.percent ?? 0) > 0,
      percent: p.percent ?? 0,
    })),
    errors,
  };
}

function sharesSplit(
  total: bigint,
  participants: SplitParticipant[],
  payerIds: string[],
): SplitResult {
  const errors: string[] = [];
  const weights = participants.map((p) => Math.max(0, p.weight ?? 0));
  if (weights.reduce((a, b) => a + b, 0) <= 0) {
    errors.push("Give at least one person a share.");
    return { splits: participants.map((p) => ({ personId: p.personId, amount: 0n, included: false, weight: 0 })), errors };
  }

  const amounts = apportion(total, weights, priorityFor(participants, payerIds));
  return {
    splits: participants.map((p, i) => ({
      personId: p.personId,
      amount: amounts[i],
      included: weights[i] > 0,
      weight: weights[i],
    })),
    errors,
  };
}

/**
 * "Everyone splits the base evenly, but Sam also had the £6 cocktail."
 *
 * Adjustments come off the top; whatever is left is divided equally between the
 * included participants. A negative remainder (adjustments exceeding the total)
 * is reported rather than silently producing negative shares.
 */
function adjustmentSplit(
  total: bigint,
  participants: SplitParticipant[],
  payerIds: string[],
): SplitResult {
  const errors: string[] = [];
  const included = participants.filter((p) => p.included !== false);
  if (included.length === 0) {
    return { splits: [], errors: ["Pick at least one person to split the remainder."] };
  }

  const adjustments = participants.map((p) => p.adjustment ?? 0n);
  const adjustmentTotal = sum(adjustments);
  const remainder = total - adjustmentTotal;

  if (remainder < 0n) {
    errors.push(`Extras add up to ${formatGap(-remainder)} more than the expense total.`);
  }

  const shared = apportion(
    remainder,
    included.map(() => 1),
    priorityFor(included, payerIds),
  );
  const sharedById = new Map(included.map((p, i) => [p.personId, shared[i]]));

  return {
    splits: participants.map((p, i) => ({
      personId: p.personId,
      amount: (sharedById.get(p.personId) ?? 0n) + adjustments[i],
      included: sharedById.has(p.personId) || adjustments[i] !== 0n,
      adjustment: adjustments[i],
    })),
    errors,
  };
}

/**
 * Receipt-level splitting.
 *
 * Each line is apportioned across the people who ordered it. Whatever the lines
 * do not account for — tax, tip, service charge, or a line nobody claimed — is
 * shared across the whole party *in proportion to what they already owe*, which
 * is how a tip actually works: the person who ordered the lobster pays more of
 * it than the person who had tap water.
 */
function itemizedSplit(
  total: bigint,
  participants: SplitParticipant[],
  items: ItemLine[],
  payerIds: string[],
): SplitResult {
  const errors: string[] = [];
  const included = participants.filter((p) => p.included !== false);
  if (included.length === 0) {
    return { splits: [], errors: ["Pick at least one person to split with."] };
  }

  const includedIds = new Set(included.map((p) => p.personId));
  const running = new Map<string, bigint>(included.map((p) => [p.personId, 0n]));

  let itemisedTotal = 0n;
  for (const item of items) {
    const claimants = item.participantIds.filter((id) => includedIds.has(id));
    const sharers = claimants.length > 0 ? claimants : included.map((p) => p.personId);
    const amounts = apportion(
      item.amount,
      sharers.map(() => 1),
      sharers.map((id) => (payerIds.includes(id) ? 0 : 1)),
    );
    sharers.forEach((id, i) => running.set(id, (running.get(id) ?? 0n) + amounts[i]));
    itemisedTotal += item.amount;
  }

  const extras = total - itemisedTotal;
  if (extras < 0n) {
    errors.push(`Items add up to ${formatGap(-extras)} more than the expense total.`);
  }

  if (extras !== 0n) {
    // Weight the shared portion by each person's item subtotal, falling back to
    // an even split when nothing has been itemised yet.
    const subtotals = included.map((p) => Number(running.get(p.personId) ?? 0n));
    const anySubtotal = subtotals.some((v) => v > 0);
    const weights = anySubtotal ? subtotals : included.map(() => 1);
    const extraShares = apportion(extras, weights, priorityFor(included, payerIds));
    included.forEach((p, i) => running.set(p.personId, (running.get(p.personId) ?? 0n) + extraShares[i]));
  }

  return {
    splits: participants.map((p) => ({
      personId: p.personId,
      amount: running.get(p.personId) ?? 0n,
      included: includedIds.has(p.personId),
    })),
    errors,
  };
}

// ---------------------------------------------------------------------------
// Validation used on both sides of the wire
// ---------------------------------------------------------------------------

export interface PayerInput {
  personId: string;
  amount: bigint;
}

/**
 * The one invariant the API must never persist a violation of: payers and
 * splits both sum to the expense total. Everything else is a warning; this is
 * an error.
 */
export function validateExpenseBalance(
  total: bigint,
  payers: PayerInput[],
  splits: { personId: string; amount: bigint }[],
): string[] {
  const errors: string[] = [];
  if (total <= 0n) errors.push("An expense needs an amount greater than zero.");

  const paid = sum(payers.map((p) => p.amount));
  if (paid !== total) {
    errors.push(
      `Payments add up to ${paid} but the expense is ${total}. They have to match.`,
    );
  }

  const owed = sum(splits.map((s) => s.amount));
  if (owed !== total) {
    errors.push(`Shares add up to ${owed} but the expense is ${total}. They have to match.`);
  }

  if (payers.some((p) => p.amount < 0n)) errors.push("A payer cannot pay a negative amount.");

  /*
   * A negative share passes both conservation checks above - pair a +2000 with
   * a -1000 on a 1000 total and the columns still add up - so it has to be
   * refused on its own terms.
   *
   * It does not corrupt a balance: `convertedBreakdown` re-apportions the
   * stored shares as weights, and `apportion` clamps a negative weight to zero,
   * so the fold treats the row as though that person owed nothing. What it does
   * corrupt is everything that reads the shares directly. The CSV export and
   * the JSON backup print them verbatim, so an exported ledger states a share
   * of -10.00 for somebody the app itself shows as owing nothing - two answers
   * to the same question, from the same row.
   */
  if (splits.some((s) => s.amount < 0n)) {
    errors.push("A share cannot be negative.");
  }

  return errors;
}

// ---------------------------------------------------------------------------

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Minor units are formatted by the caller; here we only need a rough figure. */
function formatGap(minor: bigint): string {
  return abs(minor).toString();
}

// ---------------------------------------------------------------------------
// Currency-safe breakdown
// ---------------------------------------------------------------------------

export interface ConvertedBreakdown {
  paid: { personId: string; amount: bigint }[];
  owed: { personId: string; amount: bigint }[];
}

/**
 * Converts an expense's payers and splits into the settlement currency such
 * that each side sums to exactly `convertedAmount`.
 *
 * For a same-currency expense this is the identity, because the weights already
 * sum to the total.
 *
 * Lives here rather than beside the read layer because the client needs it too:
 * showing a new expense's effect on a balance before the server answers means
 * doing this conversion locally, and doing it a second way would put the
 * optimistic number and the real one on different arithmetic.
 */
export function convertedBreakdown(expense: {
  convertedAmount: bigint;
  payers: { personId: string; amount: bigint }[];
  splits: { personId: string; amount: bigint }[];
}): ConvertedBreakdown {
  const activeSplits = expense.splits.filter((s) => s.amount !== 0n);

  const paidAmounts = apportion(
    expense.convertedAmount,
    expense.payers.map((p) => Number(p.amount)),
  );
  const owedAmounts = apportion(
    expense.convertedAmount,
    activeSplits.map((s) => Number(s.amount)),
  );

  return {
    paid: expense.payers.map((p, i) => ({ personId: p.personId, amount: paidAmounts[i] })),
    owed: activeSplits.map((s, i) => ({ personId: s.personId, amount: owedAmounts[i] })),
  };
}
