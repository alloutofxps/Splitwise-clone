/**
 * Divvy's money code against a separate, simple calculator
 * (`reference-money.ts`), on random cases that fast-check shrinks to the
 * smallest failing example. RULES.md M1 to M7 and M10.
 *
 * `RUNS` sets the cases per rule. CI uses the default; a deeper run is
 * `MONEY_RUNS=50000 npx vitest run money-reference`.
 */
import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { computeBalances, type BalanceEvent } from "@/lib/balances";
import { convert, decimalsFor, exactRate, parseAmount } from "@/lib/money";
import { convertedBreakdown, resolveSplit } from "@/lib/split";
import { MAX_MINOR_UNITS } from "@/lib/api";
import {
  afterPaying,
  convertExact,
  exactShare,
  frac,
  isRoundingOf,
  netBalances,
  type SimpleExpense,
  type SimplePayment,
} from "./reference-money";

const RUNS = Number(process.env.MONEY_RUNS ?? 20000);
const settings = { numRuns: RUNS };
// A deep run takes minutes per rule; the default limit is 5 seconds.
vi.setConfig({ testTimeout: 30 * 60 * 1000 });

const PEOPLE = ["ana", "ben", "cai", "dev", "eli", "fay", "gus", "hal"];
const people = fc.uniqueArray(fc.constantFrom(...PEOPLE), { minLength: 1, maxLength: 8 });
const total = fc.bigInt({ min: 1n, max: 10n ** 12n });
const anyTotal = fc.bigInt({ min: 1n, max: MAX_MINOR_UNITS });
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

describe("splits against the simple calculator", () => {
  it("equal: everyone gets the total divided evenly, odd units to payers first", () => {
    fc.assert(
      fc.property(total, people, fc.nat(), (t, ids, payerIndex) => {
        const payer = ids[payerIndex % ids.length];
        const { splits, errors } = resolveSplit({
          mode: "EQUAL",
          total: t,
          participants: ids.map((personId) => ({ personId })),
          payerIds: [payer],
        });
        expect(errors).toEqual([]);
        const n = BigInt(ids.length);
        expect(sum(splits.map((s) => s.amount))).toBe(t);
        for (const s of splits) expect(isRoundingOf(s.amount, frac(t, n))).toBe(true);
        // The payer never gets the smaller share while someone else gets the larger.
        const payerShare = splits.find((s) => s.personId === payer)!.amount;
        if (t % n !== 0n) expect(payerShare).toBe(t / n + 1n);
      }),
      settings,
    );
  });

  it("shares: each share is the exact share rounded down or up", () => {
    fc.assert(
      fc.property(total, people, fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 8, maxLength: 8 }), (t, ids, rawWeights) => {
        const weights = ids.map((_, i) => rawWeights[i]);
        fc.pre(weights.some((w) => w > 0));
        const { splits, errors } = resolveSplit({
          mode: "SHARES",
          total: t,
          participants: ids.map((personId, i) => ({ personId, weight: weights[i] })),
          payerIds: [ids[0]],
        });
        expect(errors).toEqual([]);
        const weightSum = BigInt(weights.reduce((a, b) => a + b, 0));
        expect(sum(splits.map((s) => s.amount))).toBe(t);
        splits.forEach((s, i) => expect(isRoundingOf(s.amount, exactShare(t, BigInt(weights[i]), weightSum))).toBe(true));
      }),
      settings,
    );
  });

  it("percent: shares that total 100% give each person their percentage, rounded down or up", () => {
    fc.assert(
      fc.property(total, people, fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 8, maxLength: 8 }), (t, ids, raw) => {
        // Tenths of a percent that add up to exactly 100.0%.
        const tenths = ids.map((_, i) => raw[i]);
        const rawSum = tenths.reduce((a, b) => a + b, 0);
        fc.pre(rawSum > 0);
        const scaled = tenths.map((v) => Math.floor((v * 1000) / rawSum));
        scaled[0] += 1000 - scaled.reduce((a, b) => a + b, 0);
        const { splits, errors } = resolveSplit({
          mode: "PERCENT",
          total: t,
          participants: ids.map((personId, i) => ({ personId, percent: scaled[i] / 10 })),
          payerIds: [ids[0]],
        });
        expect(errors).toEqual([]);
        expect(sum(splits.map((s) => s.amount))).toBe(t);
        splits.forEach((s, i) => expect(isRoundingOf(s.amount, exactShare(t, BigInt(scaled[i]), 1000n))).toBe(true));
      }),
      settings,
    );
  });

  it("exact: shares are exactly what was typed", () => {
    fc.assert(
      fc.property(people, fc.array(fc.bigInt({ min: 0n, max: 10n ** 9n }), { minLength: 8, maxLength: 8 }), (ids, raw) => {
        const amounts = ids.map((_, i) => raw[i]);
        const t = sum(amounts);
        fc.pre(t > 0n);
        const { splits, errors } = resolveSplit({
          mode: "EXACT",
          total: t,
          participants: ids.map((personId, i) => ({ personId, amount: amounts[i] })),
        });
        expect(errors).toEqual([]);
        splits.forEach((s, i) => expect(s.amount).toBe(amounts[i]));
      }),
      settings,
    );
  });

  it("adjustment: each share is its extra plus an even part of what is left", () => {
    fc.assert(
      fc.property(total, people, fc.array(fc.bigInt({ min: 0n, max: 10n ** 6n }), { minLength: 8, maxLength: 8 }), (t, ids, raw) => {
        const extras = ids.map((_, i) => raw[i]);
        fc.pre(sum(extras) <= t);
        const { splits, errors } = resolveSplit({
          mode: "ADJUSTMENT",
          total: t,
          participants: ids.map((personId, i) => ({ personId, adjustment: extras[i] })),
          payerIds: [ids[0]],
        });
        expect(errors).toEqual([]);
        expect(sum(splits.map((s) => s.amount))).toBe(t);
        const rest = frac(t - sum(extras), BigInt(ids.length));
        splits.forEach((s, i) => expect(isRoundingOf(s.amount - extras[i], rest)).toBe(true));
      }),
      settings,
    );
  });

  it("itemised: shares add up, nobody pays less than their own items, and nothing is negative", () => {
    const item = fc.record({ amount: fc.bigInt({ min: 1n, max: 10n ** 7n }), who: fc.uniqueArray(fc.nat({ max: 7 }), { maxLength: 8 }) });
    fc.assert(
      fc.property(people, fc.array(item, { maxLength: 6 }), fc.bigInt({ min: 0n, max: 10n ** 6n }), (ids, items, extra) => {
        const lines = items.map((it, i) => ({ id: `i${i}`, amount: it.amount, participantIds: it.who.filter((w) => w < ids.length).map((w) => ids[w]) }));
        const t = sum(lines.map((l) => l.amount)) + extra;
        fc.pre(t > 0n);
        const { splits, errors } = resolveSplit({
          mode: "ITEMIZED",
          total: t,
          participants: ids.map((personId) => ({ personId })),
          items: lines,
          payerIds: [ids[0]],
        });
        expect(errors).toEqual([]);
        expect(sum(splits.map((s) => s.amount))).toBe(t);
        for (const s of splits) {
          expect(s.amount >= 0n).toBe(true);
          // Their own items, each rounded down, is the least they can owe.
          let floor = 0n;
          for (const line of lines) {
            const sharers = line.participantIds.length ? line.participantIds : ids;
            if (sharers.includes(s.personId)) floor += line.amount / BigInt(sharers.length);
          }
          expect(s.amount >= floor).toBe(true);
        }
      }),
      settings,
    );
  });
});

describe("currency conversion against the simple calculator", () => {
  const codes = fc.constantFrom("EUR", "USD", "JPY", "KWD", "INR", "VND", "BHD", "CLP");
  // Rates with up to 12 decimal places, as the API accepts them.
  const rate = fc
    .tuple(fc.integer({ min: 0, max: 100000 }), fc.integer({ min: 0, max: 12 }), fc.bigInt({ min: 0n, max: 10n ** 12n - 1n }))
    .map(([whole, places, part]) => (places === 0 ? String(whole || 1) : `${whole}.${(part % 10n ** BigInt(places)).toString().padStart(places, "0")}`))
    .filter((r) => !/^0(\.0*)?$/.test(r));

  it("converts an amount to the exact value, rounded half up", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), codes, codes, rate, (minor, from, to, r) => {
        fc.pre(from !== to);
        expect(convert(minor, from, to, r)).toBe(convertExact(minor, decimalsFor(from), decimalsFor(to), r));
      }),
      settings,
    );
  });

  it("splits a converted expense so each share is its exact part, rounded down or up", () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: 0n, max: 10n ** 9n }), { minLength: 1, maxLength: 8 }), fc.bigInt({ min: 1n, max: 10n ** 12n }), (shares, converted) => {
        const t = sum(shares);
        fc.pre(t > 0n);
        const result = convertedBreakdown({
          convertedAmount: converted,
          payers: [{ personId: "ana", amount: t }],
          splits: shares.map((amount, i) => ({ personId: `p${i}`, amount })),
        });
        expect(sum(result.owed.map((o) => o.amount))).toBe(converted);
        for (const o of result.owed) {
          const original = shares[Number(o.personId.slice(1))];
          expect(isRoundingOf(o.amount, exactShare(converted, original, t))).toBe(true);
        }
      }),
      settings,
    );
  });

  it("uses a same-currency expense's shares exactly as stored, up to the largest amount accepted", () => {
    fc.assert(
      fc.property(fc.array(anyTotal, { minLength: 1, maxLength: 8 }), (raw) => {
        // Shares that add up to no more than the limit.
        const shares = raw.map((v) => v / BigInt(raw.length));
        const t = sum(shares);
        fc.pre(t > 0n);
        const result = convertedBreakdown({
          convertedAmount: t,
          payers: [{ personId: "ana", amount: t }],
          splits: shares.map((amount, i) => ({ personId: `p${i}`, amount })),
        });
        const stored = shares.filter((s) => s !== 0n);
        expect(result.owed.map((o) => o.amount)).toEqual(stored);
      }),
      settings,
    );
  });

  it("paying the whole debt in another currency leaves nothing owing", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 10n }), codes, fc.bigInt({ min: 1n, max: 10n ** 10n }), codes, (owed, owedCode, paid, paidCode) => {
        fc.pre(owedCode !== paidCode);
        const r = exactRate(owed, owedCode, paid, paidCode);
        fc.pre(r !== "0");
        expect(convert(paid, paidCode, owedCode, r)).toBe(owed);
      }),
      settings,
    );
  });
});

describe("balances against the simple calculator", () => {
  const expense = fc
    .tuple(people, people, fc.array(fc.bigInt({ min: 0n, max: 10n ** 8n }), { minLength: 8, maxLength: 8 }), fc.array(fc.bigInt({ min: 0n, max: 10n ** 8n }), { minLength: 8, maxLength: 8 }))
    .map(([payers, eaters, paidRaw, owedRaw]): SimpleExpense | null => {
      const owed = eaters.map((personId, i) => ({ personId, amount: owedRaw[i] }));
      const t = sum(owed.map((o) => o.amount));
      if (t === 0n) return null;
      // Payers' amounts scaled to add up to the same total.
      const weights = payers.map((_, i) => paidRaw[i] + 1n);
      const weightSum = sum(weights);
      const paid = payers.map((personId, i) => ({ personId, amount: (t * weights[i]) / weightSum }));
      paid[0].amount += t - sum(paid.map((p) => p.amount));
      return { kind: "expense", paid, owed };
    });
  const payment = fc
    .tuple(fc.constantFrom(...PEOPLE), fc.constantFrom(...PEOPLE), fc.bigInt({ min: 1n, max: 10n ** 8n }))
    .filter(([a, b]) => a !== b)
    .map(([from, to, amount]): SimplePayment => ({ kind: "payment", from, to, amount }));
  const history = fc.array(fc.oneof(expense, payment), { maxLength: 30 }).map((xs) => xs.filter((x): x is SimpleExpense | SimplePayment => x !== null));

  const toEvents = (xs: (SimpleExpense | SimplePayment)[]): BalanceEvent[] =>
    xs.map((x, i) =>
      x.kind === "expense"
        ? { kind: "expense", id: `e${i}`, paid: x.paid, owed: x.owed }
        : { kind: "settlement", id: `s${i}`, fromPersonId: x.from, toPersonId: x.to, amount: x.amount },
    );
  const nonZero = (m: Map<string, bigint>) => new Map([...m].filter(([, v]) => v !== 0n));

  it("every balance is what that person paid minus their share, and they add up to zero", () => {
    fc.assert(
      fc.property(history, (xs) => {
        const sheet = computeBalances(toEvents(xs));
        const expected = netBalances(xs);
        expect(nonZero(sheet.net)).toEqual(nonZero(expected));
        expect(sum([...sheet.net.values()])).toBe(0n);
      }),
      settings,
    );
  });

  it("the literal debts and the simplified plan both settle everyone exactly", () => {
    fc.assert(
      fc.property(history, (xs) => {
        const sheet = computeBalances(toEvents(xs));
        const expected = netBalances(xs);
        for (const debts of [sheet.pairwise, sheet.simplified]) {
          for (const d of debts) expect(d.amount > 0n).toBe(true);
          expect([...afterPaying(expected, debts).values()].every((v) => v === 0n)).toBe(true);
        }
        const owing = [...expected.values()].filter((v) => v !== 0n).length;
        expect(sheet.simplified.length).toBeLessThanOrEqual(Math.max(0, owing - 1));
      }),
      settings,
    );
  });
});

describe("reading typed and pasted amounts", () => {
  it("reads back any amount written the English or the German way", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 13n }), fc.constantFrom("EUR", "JPY", "KWD"), fc.constantFrom("en-US", "de-DE"), (minor, code, locale) => {
        const decimals = decimalsFor(code);
        const text = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(
          Number(minor) / 10 ** decimals,
        );
        fc.pre(Number.isSafeInteger(Number(minor)));
        // A whole number written the German way with no decimals ("1.234") is
        // read as a decimal on purpose (money.ts, findDecimalSeparator).
        fc.pre(!(decimals === 0 && locale === "de-DE" && minor >= 1000n));
        expect(parseAmount(text, code)).toBe(minor);
      }),
      settings,
    );
  });
});
