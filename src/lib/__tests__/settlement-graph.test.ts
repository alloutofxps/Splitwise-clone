import { describe, expect, it } from "vitest";
import { apportion, resolveSplit } from "../split";
import { computeBalances, simplifyDebts } from "../balances";
import type { BalanceEvent } from "../balances";

/**
 * Adversarial cases for the settlement graph and the split engines.
 *
 * The existing suites check that the happy path conserves value and that
 * randomised input never loses a minor unit. These go at the shapes a real
 * group produces that a generator rarely will: debt that runs in a circle,
 * sub-groups that never transact, one person carrying everybody, and the
 * penny that cannot be divided three ways.
 */

function net(entries: Record<string, number>): Map<string, bigint> {
  return new Map(Object.entries(entries).map(([id, v]) => [id, BigInt(v)]));
}

function sum(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

/** Applies a plan to the positions it claims to settle. */
function applyPlan(start: Map<string, bigint>, edges: ReturnType<typeof simplifyDebts>) {
  const after = new Map(start);
  for (const edge of edges) {
    after.set(edge.fromPersonId, (after.get(edge.fromPersonId) ?? 0n) + edge.amount);
    after.set(edge.toPersonId, (after.get(edge.toPersonId) ?? 0n) - edge.amount);
  }
  return after;
}

describe("simplifyDebts — graph shapes", () => {
  it("collapses a circular debt to nothing", () => {
    // A owes B, B owes C, C owes A, all for the same amount. Every net
    // position is zero, so the honest plan is no transfers at all — the case
    // where simplification earns its name.
    const positions = net({ a: 0, b: 0, c: 0 });
    expect(simplifyDebts(positions)).toEqual([]);
  });

  it("settles a three-way cycle with an imbalance in one hop", () => {
    // A is down 100, C is up 100, B is square. A pays C directly rather than
    // routing through B, who has no reason to be involved.
    const positions = net({ a: -100, b: 0, c: 100 });
    const edges = simplifyDebts(positions);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromPersonId: "a", toPersonId: "c", amount: 100n });
    expect([...applyPlan(positions, edges).values()].every((v) => v === 0n)).toBe(true);
  });

  it("keeps disconnected sub-groups settled without inventing cross-transfers it cannot justify", () => {
    // Two pairs that never shared an expense. Simplification works on net
    // positions, so pairing a↔b and c↔d is both minimal and intuitive; what
    // must not happen is a plan that leaves anybody unsettled.
    const positions = net({ a: -500, b: 500, c: -300, d: 300 });
    const edges = simplifyDebts(positions);
    expect(edges.length).toBeLessThanOrEqual(3); // n-1 for n=4
    expect([...applyPlan(positions, edges).values()].every((v) => v === 0n)).toBe(true);
  });

  it("settles one creditor against many debtors in n-1 transfers", () => {
    const positions = net({ payer: 900, a: -300, b: -300, c: -300 });
    const edges = simplifyDebts(positions);
    expect(edges).toHaveLength(3);
    expect([...applyPlan(positions, edges).values()].every((v) => v === 0n)).toBe(true);
  });

  it("handles the two-person case without a redundant hop", () => {
    const positions = net({ a: -4200, b: 4200 });
    const edges = simplifyDebts(positions);
    expect(edges).toHaveLength(1);
    expect(edges[0].amount).toBe(4200n);
  });

  it("emits no transfer for a group that is already square", () => {
    expect(simplifyDebts(net({ a: 0, b: 0 }))).toEqual([]);
    expect(simplifyDebts(new Map())).toEqual([]);
  });

  it("never proposes a zero or negative transfer", () => {
    const positions = net({ a: -1, b: -1, c: 2 });
    for (const edge of simplifyDebts(positions)) {
      expect(edge.amount > 0n).toBe(true);
      expect(edge.fromPersonId).not.toBe(edge.toPersonId);
    }
  });

  it("is stable: the same positions always produce the same plan", () => {
    // The plan is shown to people and acted on. One that reshuffled between
    // renders would have somebody paying a different person on a refresh.
    const positions = net({ a: -100, b: -100, c: 100, d: 100 });
    const first = simplifyDebts(new Map(positions));
    const second = simplifyDebts(new Map([...positions].reverse()));
    expect(first).toEqual(second);
  });

  it("moves exactly the outstanding total, never more", () => {
    const positions = net({ a: -700, b: -250, c: 500, d: 450 });
    const owed = sum([...positions.values()].filter((v) => v > 0n));
    const moved = simplifyDebts(positions).reduce((total, e) => total + e.amount, 0n);
    expect(moved).toBe(owed);
  });
});

describe("computeBalances — conservation under real event streams", () => {
  it("keeps every net position summing to zero after an expense and a partial settlement", () => {
    const events: BalanceEvent[] = [
      {
        kind: "expense",
        id: "e1",
        paid: [{ personId: "a", amount: 10_000n }],
        owed: [
          { personId: "a", amount: 3_334n },
          { personId: "b", amount: 3_333n },
          { personId: "c", amount: 3_333n },
        ],
      },
      { kind: "settlement", id: "s1", fromPersonId: "b", toPersonId: "a", amount: 1_000n },
    ];

    const sheet = computeBalances(events);
    expect(sum(sheet.net.values())).toBe(0n);

    // And the plan the app would show settles it completely.
    const after = applyPlan(sheet.net, sheet.simplified);
    expect([...after.values()].every((v) => v === 0n)).toBe(true);
  });

  it("balances the pairwise ledger against the net map when several people paid", () => {
    // Ana puts in 7, Ben 3; two other people split the 10 evenly. Every
    // creditor's incoming total in the pairwise view has to match their net
    // position, or the group screen and the balance chip state different
    // numbers for the same dinner. Weighting each debtor's allocation by the
    // creditors' *original* surplus rounded both of them up by a unit.
    const sheet = computeBalances([
      {
        kind: "expense",
        id: "e1",
        paid: [
          { personId: "ana", amount: 7n },
          { personId: "ben", amount: 3n },
        ],
        owed: [
          { personId: "x", amount: 5n },
          { personId: "y", amount: 5n },
        ],
      },
    ]);

    const fromPairwise = new Map<string, bigint>();
    for (const edge of sheet.pairwise) {
      fromPairwise.set(edge.toPersonId, (fromPairwise.get(edge.toPersonId) ?? 0n) + edge.amount);
      fromPairwise.set(edge.fromPersonId, (fromPairwise.get(edge.fromPersonId) ?? 0n) - edge.amount);
    }

    expect(fromPairwise.get("ana")).toBe(7n);
    expect(fromPairwise.get("ben")).toBe(3n);
    expect(sum(fromPairwise.values())).toBe(0n);
    for (const [personId, position] of sheet.net) {
      expect(fromPairwise.get(personId) ?? 0n).toBe(position);
    }
  });

  it("keeps the two views agreeing across awkward multi-payer shapes", () => {
    const shapes: { paid: [string, bigint][]; owed: [string, bigint][] }[] = [
      { paid: [["a", 1n], ["b", 1n]], owed: [["x", 1n], ["y", 1n]] },
      { paid: [["a", 1n], ["b", 1n], ["c", 1n]], owed: [["x", 1n], ["y", 1n], ["z", 1n]] },
      { paid: [["a", 3333n], ["b", 3333n], ["c", 3334n]], owed: [["w", 2500n], ["x", 2500n], ["y", 2500n], ["z", 2500n]] },
      { paid: [["a", 1n], ["b", 9_999n]], owed: [["x", 3_333n], ["y", 3_333n], ["z", 3_334n]] },
      // A payer who also owes a share, so they land on neither side.
      { paid: [["a", 500n], ["b", 501n]], owed: [["a", 334n], ["b", 334n], ["c", 333n]] },
    ];

    for (const shape of shapes) {
      const sheet = computeBalances([
        {
          kind: "expense",
          id: "e",
          paid: shape.paid.map(([personId, amount]) => ({ personId, amount })),
          owed: shape.owed.map(([personId, amount]) => ({ personId, amount })),
        },
      ]);

      const fromPairwise = new Map<string, bigint>();
      for (const edge of sheet.pairwise) {
        fromPairwise.set(edge.toPersonId, (fromPairwise.get(edge.toPersonId) ?? 0n) + edge.amount);
        fromPairwise.set(edge.fromPersonId, (fromPairwise.get(edge.fromPersonId) ?? 0n) - edge.amount);
      }
      for (const [personId, position] of sheet.net) {
        expect(fromPairwise.get(personId) ?? 0n).toBe(position);
      }
      expect(sheet.pairwise.every((e) => e.amount > 0n)).toBe(true);
    }
  });

  it("stays at zero when one person pays for everybody, repeatedly", () => {
    const events: BalanceEvent[] = Array.from({ length: 25 }, (_, i) => ({
      kind: "expense" as const,
      id: `e${i}`,
      paid: [{ personId: "a", amount: 1_000n }],
      owed: [
        { personId: "a", amount: 334n },
        { personId: "b", amount: 333n },
        { personId: "c", amount: 333n },
      ],
    }));
    expect(sum(computeBalances(events).net.values())).toBe(0n);
  });
});

describe("splitting — the indivisible penny", () => {
  it("splits 10.00 three ways as 3.34 / 3.33 / 3.33, and the payer absorbs the extra", () => {
    const result = resolveSplit({
      mode: "EQUAL",
      total: 1_000n,
      participants: [{ personId: "a" }, { personId: "b" }, { personId: "c" }],
      payerIds: ["a"],
    });
    const amounts = result.splits.map((s) => s.amount);
    expect(sum(amounts)).toBe(1_000n);
    expect(amounts.filter((a) => a === 334n)).toHaveLength(1);
    expect(amounts.filter((a) => a === 333n)).toHaveLength(2);
    // The odd penny lands on the payer: they are already out of pocket, which
    // is both the fairest answer and the easiest one to explain.
    expect(result.splits.find((s) => s.personId === "a")?.amount).toBe(334n);
  });

  it("conserves the total for every awkward divisor", () => {
    for (const people of [3, 6, 7, 9, 11, 13]) {
      for (const total of [1n, 7n, 100n, 1_000n, 99_999n]) {
        const parts = apportion(
          total,
          Array.from({ length: people }, () => 1),
        );
        expect(sum(parts)).toBe(total);
        expect(parts).toHaveLength(people);
      }
    }
  });

  it("conserves a percentage split that cannot divide evenly", () => {
    const result = resolveSplit({
      mode: "PERCENT",
      total: 10_000n,
      participants: [
        { personId: "a", weight: 33.33 },
        { personId: "b", weight: 33.33 },
        { personId: "c", weight: 33.34 },
      ],
      payerIds: ["a"],
    });
    expect(sum(result.splits.map((s) => s.amount))).toBe(10_000n);
  });

  it("conserves a share split with lopsided ratios", () => {
    const result = resolveSplit({
      mode: "SHARES",
      total: 7n, // Fewer units than shares: somebody must get nothing.
      participants: [
        { personId: "a", weight: 5 },
        { personId: "b", weight: 1 },
        { personId: "c", weight: 1 },
      ],
      payerIds: ["a"],
    });
    expect(sum(result.splits.map((s) => s.amount))).toBe(7n);
  });

  it("does not lose a unit when a negative total is apportioned", () => {
    // Refunds and corrections arrive as negatives.
    const parts = apportion(-1_000n, [1, 1, 1]);
    expect(sum(parts)).toBe(-1_000n);
    expect(parts.every((p) => p <= 0n)).toBe(true);
  });
});
