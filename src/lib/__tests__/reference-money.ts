/**
 * A deliberately simple money calculator, written apart from Divvy's own code
 * so the two can be checked against each other (RULES.md M1 to M7).
 *
 * Nothing here is clever or fast. Every answer is worked out with exact
 * fractions (a numerator and a denominator, both whole numbers), and nothing is
 * imported from the app. Where Divvy has to round, this file states what any
 * correct rounding must satisfy instead of copying Divvy's way of doing it.
 */

/** An exact fraction n/d with d > 0. */
export interface Fraction {
  n: bigint;
  d: bigint;
}

export const frac = (n: bigint, d: bigint): Fraction => (d < 0n ? { n: -n, d: -d } : { n, d });

/** Whole minor units below and above an exact value. */
export function floorCeil(x: Fraction): [bigint, bigint] {
  const q = x.n / x.d;
  const floor = x.n % x.d !== 0n && x.n < 0n ? q - 1n : q;
  return [floor, x.n % x.d === 0n ? floor : floor + 1n];
}

/** True when `amount` is the exact value rounded down or up. */
export function isRoundingOf(amount: bigint, exact: Fraction): boolean {
  const [floor, ceil] = floorCeil(exact);
  return amount === floor || amount === ceil;
}

/** A share's exact value: total * weight / sum of weights. */
export function exactShare(total: bigint, weight: bigint, weightSum: bigint): Fraction {
  return frac(total * weight, weightSum);
}

/** "12.345" to the fraction 12345/1000. */
export function decimalFraction(text: string): Fraction {
  const [whole, part = ""] = text.split(".");
  return frac(BigInt(whole + part), 10n ** BigInt(part.length));
}

/** Rounds half up (away from zero for a positive value). */
export function roundHalfUp(x: Fraction): bigint {
  const [floor] = floorCeil(x);
  // x - floor >= 1/2  <=>  2 * (x.n - floor * x.d) >= x.d
  return 2n * (x.n - floor * x.d) >= x.d ? floor + 1n : floor;
}

/**
 * The amount in `toDecimals` minor units that `minor` (in `fromDecimals`) is
 * worth at `rate`, rounded half up.
 */
export function convertExact(minor: bigint, fromDecimals: number, toDecimals: number, rate: string): bigint {
  const r = decimalFraction(rate);
  const negative = minor < 0n;
  const size = negative ? -minor : minor;
  const value = frac(size * r.n * 10n ** BigInt(toDecimals), r.d * 10n ** BigInt(fromDecimals));
  const rounded = roundHalfUp(value);
  return negative ? -rounded : rounded;
}

export interface SimpleExpense {
  kind: "expense";
  paid: { personId: string; amount: bigint }[];
  owed: { personId: string; amount: bigint }[];
}

export interface SimplePayment {
  kind: "payment";
  from: string;
  to: string;
  amount: bigint;
}

/**
 * Each person's balance, the plain way: what they paid, minus their share,
 * plus what they paid back to others, minus what others paid back to them.
 * Positive means the group owes them.
 */
export function netBalances(events: (SimpleExpense | SimplePayment)[]): Map<string, bigint> {
  const net = new Map<string, bigint>();
  const add = (id: string, amount: bigint) => net.set(id, (net.get(id) ?? 0n) + amount);
  for (const event of events) {
    if (event.kind === "expense") {
      for (const p of event.paid) add(p.personId, p.amount);
      for (const o of event.owed) add(o.personId, -o.amount);
    } else {
      add(event.from, event.amount);
      add(event.to, -event.amount);
    }
  }
  return net;
}

/** What a list of debts does to each person's balance once all are paid. */
export function afterPaying(
  net: Map<string, bigint>,
  debts: { fromPersonId: string; toPersonId: string; amount: bigint }[],
): Map<string, bigint> {
  const left = new Map(net);
  for (const debt of debts) {
    left.set(debt.fromPersonId, (left.get(debt.fromPersonId) ?? 0n) + debt.amount);
    left.set(debt.toPersonId, (left.get(debt.toPersonId) ?? 0n) - debt.amount);
  }
  return left;
}
