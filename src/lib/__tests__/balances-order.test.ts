import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeBalances, simplifyDebts, type BalanceEvent, type DebtEdge } from "../balances";

/**
 * The exact debts Divvy shows, not just that they add up (RULES.md M5, M12).
 *
 * Two phones showing the same group must list the same payments in the same
 * order, so the plan can't depend on the order rows came out of the database.
 * Mutation testing found that nothing pinned this down.
 */

const RUNS = Number(process.env.MONEY_RUNS ?? 2000);

const edge = (fromPersonId: string, toPersonId: string, amount: bigint): DebtEdge => ({
  fromPersonId,
  toPersonId,
  amount,
});
const expense = (id: string, paid: [string, bigint][], owed: [string, bigint][]): BalanceEvent => ({
  kind: "expense",
  id,
  paid: paid.map(([personId, amount]) => ({ personId, amount })),
  owed: owed.map(([personId, amount]) => ({ personId, amount })),
});
const settle = (id: string, from: string, to: string, amount: bigint): BalanceEvent => ({
  kind: "settlement",
  id,
  fromPersonId: from,
  toPersonId: to,
  amount,
});

describe("the simplified plan", () => {
  it("pays the biggest debt to the biggest creditor first", () => {
    const net = new Map([["a", -500n], ["b", -300n], ["c", 600n], ["d", 200n]]);
    expect(simplifyDebts(net)).toEqual([edge("a", "c", 500n), edge("b", "c", 100n), edge("b", "d", 200n)]);
  });

  it("orders by amount, not by name", () => {
    const net = new Map([["a", -300n], ["b", -500n], ["c", 200n], ["d", 600n]]);
    expect(simplifyDebts(net)).toEqual([edge("b", "d", 500n), edge("a", "d", 100n), edge("a", "c", 200n)]);
  });

  it("breaks ties by person, whatever order they arrive in", () => {
    expect(simplifyDebts(new Map([["z", -100n], ["y", -100n], ["x", 200n]]))).toEqual([
      edge("y", "x", 100n),
      edge("z", "x", 100n),
    ]);
    expect(simplifyDebts(new Map([["a", -200n], ["q", 100n], ["p", 100n]]))).toEqual([
      edge("a", "p", 100n),
      edge("a", "q", 100n),
    ]);
  });

  it("leaves out people who are square", () => {
    expect(simplifyDebts(new Map([["a", 0n], ["b", -100n], ["c", 100n]]))).toEqual([edge("b", "c", 100n)]);
    expect(simplifyDebts(new Map([["a", 0n], ["b", 0n]]))).toEqual([]);
    expect(simplifyDebts(new Map())).toEqual([]);
  });

  it("stops when one side runs out, if the balances don't add up", () => {
    // Can't happen with saved data, which always balances, but a plan built
    // from a half-loaded group must not crash.
    expect(simplifyDebts(new Map([["a", -100n], ["b", 50n]]))).toEqual([edge("a", "b", 50n)]);
    expect(simplifyDebts(new Map([["a", -50n], ["b", 100n]]))).toEqual([edge("a", "b", 50n)]);
  });

  it("is the same plan whatever order the balances are read in", () => {
    const people = ["ana", "ben", "cy", "dee", "eli", "fay"];
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -5000, max: 5000 }), { minLength: people.length - 1, maxLength: people.length - 1 }),
        fc.array(fc.nat(), { minLength: people.length, maxLength: people.length }),
        (amounts, keys) => {
          const values = [...amounts.map(BigInt)];
          values.push(-values.reduce((a, b) => a + b, 0n));
          const entries = people.map((p, i) => [p, values[i]] as [string, bigint]);
          const shuffled = entries.map((e, i) => [keys[i], e] as const).sort((a, b) => a[0] - b[0]).map(([, e]) => e);
          const plan = simplifyDebts(new Map(entries));
          expect(simplifyDebts(new Map(shuffled))).toEqual(plan);
          for (const step of plan) {
            expect(step.amount).toBeGreaterThan(0n);
            expect(step.fromPersonId).not.toBe(step.toPersonId);
          }
          // Each person either only pays or only receives.
          const payers = new Set(plan.map((s) => s.fromPersonId));
          expect(plan.some((s) => payers.has(s.toPersonId))).toBe(false);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe("who owes whom, pair by pair", () => {
  it("splits each debt across several payers in proportion, largest first", () => {
    const sheet = computeBalances([expense("e1", [["a", 700n], ["b", 300n]], [["c", 500n], ["d", 500n]])]);
    expect(sheet.pairwise).toEqual([
      edge("c", "a", 350n),
      edge("d", "a", 350n),
      edge("c", "b", 150n),
      edge("d", "b", 150n),
    ]);
  });

  it("gives an odd unit to the payer owed the most", () => {
    const sheet = computeBalances([expense("e1", [["a", 2n], ["b", 1n]], [["c", 1n], ["d", 2n]])]);
    expect(sheet.pairwise).toEqual([edge("c", "a", 1n), edge("d", "a", 1n), edge("d", "b", 1n)]);
  });

  it("settles a tie between payers the same way whatever order the rows are in", () => {
    // Two payers owed exactly the same: the odd unit goes to the first by id,
    // and the first debtor by id is the one who pays it.
    const expected = [edge("c", "a", 1n), edge("d", "b", 1n)];
    expect(computeBalances([expense("e1", [["a", 1n], ["b", 1n]], [["c", 1n], ["d", 1n]])]).pairwise).toEqual(expected);
    expect(computeBalances([expense("e1", [["b", 1n], ["a", 1n]], [["d", 1n], ["c", 1n]])]).pairwise).toEqual(expected);
  });

  it("lists the biggest debt first", () => {
    const sheet = computeBalances([
      expense("e1", [["a", 100n]], [["b", 100n]]),
      expense("e2", [["a", 300n]], [["c", 300n]]),
      expense("e3", [["a", 200n]], [["d", 200n]]),
    ]);
    expect(sheet.pairwise).toEqual([edge("c", "a", 300n), edge("d", "a", 200n), edge("b", "a", 100n)]);
  });

  it("ignores a payment from someone to themselves, or of nothing", () => {
    const sheet = computeBalances([settle("s1", "a", "a", 100n), settle("s2", "a", "b", 0n)]);
    expect(sheet.pairwise).toEqual([]);
    expect(sheet.simplified).toEqual([]);
  });

  it("never records a payer owing themselves", () => {
    const sheet = computeBalances([expense("e1", [["a", 900n]], [["a", 300n], ["b", 300n], ["c", 300n]])]);
    expect(sheet.pairwise).toEqual([edge("b", "a", 300n), edge("c", "a", 300n)]);
  });

  it("drops a pair once it is paid off, and turns it round when overpaid", () => {
    const owed = expense("e1", [["a", 200n]], [["a", 100n], ["b", 100n]]);
    expect(computeBalances([owed, settle("s1", "b", "a", 100n)]).pairwise).toEqual([]);
    expect(computeBalances([owed, settle("s1", "b", "a", 150n)]).pairwise).toEqual([edge("a", "b", 50n)]);
  });

  it("is the same whatever order the events and their rows arrive in", () => {
    const people = ["ana", "ben", "cy", "dee"];
    const row = fc.tuple(fc.constantFrom(...people), fc.bigInt({ min: 1n, max: 10_000n }));
    const event = fc.oneof(
      fc.tuple(fc.array(row, { minLength: 1, maxLength: 3 }), fc.array(row, { minLength: 1, maxLength: 4 })).map(
        ([paid, owedRaw]) => {
          // Scale the owed side so it adds up to what was paid.
          const total = paid.reduce((a, [, v]) => a + v, 0n);
          const weights = owedRaw.reduce((a, [, v]) => a + v, 0n);
          const owed = owedRaw.map(([p, v]) => [p, (v * total) / weights] as [string, bigint]);
          owed[0][1] += total - owed.reduce((a, [, v]) => a + v, 0n);
          return { paid, owed };
        },
      ),
      fc.tuple(fc.constantFrom(...people), fc.constantFrom(...people), fc.bigInt({ min: 1n, max: 5_000n })),
    );
    fc.assert(
      fc.property(fc.array(event, { minLength: 1, maxLength: 6 }), fc.nat(), (raw, seed) => {
        const events = raw.map((e, i): BalanceEvent =>
          Array.isArray(e) ? settle(`s${i}`, e[0], e[1], e[2]) : expense(`e${i}`, e.paid, e.owed),
        );
        const reordered = [...events]
          .map((e, i) => ({ e, k: (i * 7919 + seed) % 101 }))
          .sort((a, b) => a.k - b.k)
          .map(({ e }) =>
            e.kind === "expense" ? { ...e, paid: [...e.paid].reverse(), owed: [...e.owed].reverse() } : e,
          );
        const a = computeBalances(events);
        const b = computeBalances(reordered);
        expect(b.simplified).toEqual(a.simplified);
        const key = (x: DebtEdge) => `${x.fromPersonId}>${x.toPersonId}:${x.amount}`;
        expect(b.pairwise.map(key).sort()).toEqual(a.pairwise.map(key).sort());
        for (let i = 1; i < a.pairwise.length; i++) {
          expect(a.pairwise[i - 1].amount >= a.pairwise[i].amount).toBe(true);
        }
        for (const step of a.pairwise) {
          expect(step.amount).toBeGreaterThan(0n);
          expect(step.fromPersonId).not.toBe(step.toPersonId);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
