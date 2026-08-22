import { describe, expect, it } from "vitest";
import {
  aggregateNet,
  computeBalances,
  personalBalance,
  simplifyDebts,
  type BalanceEvent,
} from "../balances";
import { sum } from "../money";

const expense = (
  id: string,
  paid: [string, bigint][],
  owed: [string, bigint][],
): BalanceEvent => ({
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

describe("computeBalances", () => {
  it("nets a single expense to the payer", () => {
    const sheet = computeBalances([
      expense("e1", [["alice", 3000n]], [
        ["alice", 1000n],
        ["bob", 1000n],
        ["cara", 1000n],
      ]),
    ]);

    expect(sheet.net.get("alice")).toBe(2000n);
    expect(sheet.net.get("bob")).toBe(-1000n);
    expect(sheet.net.get("cara")).toBe(-1000n);
    expect(sheet.totalSpend).toBe(3000n);

    expect(sheet.pairwise).toHaveLength(2);
    expect(sheet.pairwise.every((e) => e.toPersonId === "alice")).toBe(true);
  });

  it("always has net positions summing to zero", () => {
    const sheet = computeBalances([
      expense("e1", [["alice", 3000n]], [["alice", 1000n], ["bob", 1000n], ["cara", 1000n]]),
      expense("e2", [["bob", 500n]], [["alice", 250n], ["bob", 250n]]),
      settle("s1", "cara", "alice", 400n),
    ]);
    expect(sum(sheet.net.values())).toBe(0n);
  });

  it("cancels debts that run both ways between a pair", () => {
    const sheet = computeBalances([
      expense("e1", [["alice", 1000n]], [["alice", 500n], ["bob", 500n]]),
      expense("e2", [["bob", 600n]], [["alice", 300n], ["bob", 300n]]),
    ]);

    // Bob owed Alice 500, Alice then owed Bob 300: one edge of 200 remains.
    expect(sheet.pairwise).toHaveLength(1);
    expect(sheet.pairwise[0]).toEqual({
      fromPersonId: "bob",
      toPersonId: "alice",
      amount: 200n,
    });
  });

  it("pays debts down with settlements", () => {
    const sheet = computeBalances([
      expense("e1", [["alice", 1000n]], [["alice", 500n], ["bob", 500n]]),
      settle("s1", "bob", "alice", 500n),
    ]);
    expect(sheet.net.get("alice")).toBe(0n);
    expect(sheet.net.get("bob")).toBe(0n);
    expect(sheet.pairwise).toHaveLength(0);
    expect(sheet.simplified).toHaveLength(0);
  });

  it("apportions across several payers without drift", () => {
    // Two payers front unequal amounts; three people share the cost.
    const sheet = computeBalances([
      expense(
        "e1",
        [
          ["alice", 700n],
          ["bob", 300n],
        ],
        [
          ["alice", 333n],
          ["bob", 333n],
          ["cara", 334n],
        ],
      ),
    ]);

    expect(sum(sheet.net.values())).toBe(0n);
    // Every creditor's incoming edges equal their surplus exactly.
    for (const creditor of ["alice", "bob"]) {
      const incoming = sum(
        sheet.pairwise.filter((e) => e.toPersonId === creditor).map((e) => e.amount),
      );
      const outgoing = sum(
        sheet.pairwise.filter((e) => e.fromPersonId === creditor).map((e) => e.amount),
      );
      expect(incoming - outgoing).toBe(sheet.net.get(creditor));
    }
  });
});

describe("simplifyDebts", () => {
  it("collapses a chain into a single transfer", () => {
    // Alice -> Bob -> Cara should become Alice -> Cara.
    const net = new Map([
      ["alice", -1000n],
      ["bob", 0n],
      ["cara", 1000n],
    ]);
    expect(simplifyDebts(net)).toEqual([
      { fromPersonId: "alice", toPersonId: "cara", amount: 1000n },
    ]);
  });

  it("never needs more than n-1 transfers", () => {
    let seed = 99;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

    for (let trial = 0; trial < 500; trial++) {
      const n = 2 + Math.floor(rand() * 8);
      const net = new Map<string, bigint>();
      let running = 0n;
      for (let i = 0; i < n - 1; i++) {
        const value = BigInt(Math.floor(rand() * 20000) - 10000);
        net.set(`p${i}`, value);
        running += value;
      }
      net.set(`p${n - 1}`, -running);

      const edges = simplifyDebts(net);
      expect(edges.length).toBeLessThanOrEqual(n - 1);

      // The plan must reproduce the same net position for everyone.
      const replay = new Map<string, bigint>();
      for (const e of edges) {
        replay.set(e.fromPersonId, (replay.get(e.fromPersonId) ?? 0n) - e.amount);
        replay.set(e.toPersonId, (replay.get(e.toPersonId) ?? 0n) + e.amount);
      }
      for (const [personId, value] of net) {
        expect(replay.get(personId) ?? 0n).toBe(value);
      }
      expect(edges.every((e) => e.amount > 0n)).toBe(true);
    }
  });

  it("does not mutate the caller's map", () => {
    const net = new Map([
      ["alice", -500n],
      ["bob", 500n],
    ]);
    simplifyDebts(net);
    expect(net.get("alice")).toBe(-500n);
    expect(net.get("bob")).toBe(500n);
  });
});

describe("personalBalance", () => {
  it("separates what you owe from what you are owed", () => {
    const sheet = computeBalances([
      expense("e1", [["alice", 900n]], [
        ["alice", 300n],
        ["bob", 300n],
        ["cara", 300n],
      ]),
      expense("e2", [["cara", 200n]], [["alice", 100n], ["cara", 100n]]),
    ]);

    const view = personalBalance(sheet, "alice", false);
    expect(view.net).toBe(500n);
    expect(view.owed.map((e) => e.fromPersonId).sort()).toEqual(["bob", "cara"]);
    expect(view.owes).toHaveLength(0);
  });
});

describe("aggregateNet", () => {
  it("keeps currencies apart", () => {
    const eur = computeBalances([expense("e1", [["alice", 1000n]], [["bob", 1000n]])]);
    const inr = computeBalances([expense("e2", [["bob", 5000n]], [["alice", 5000n]])]);

    const totals = aggregateNet(
      [
        { currency: "EUR", sheet: eur },
        { currency: "INR", sheet: inr },
      ],
      "alice",
    );
    expect(totals.get("EUR")).toBe(1000n);
    expect(totals.get("INR")).toBe(-5000n);
  });

  it("drops currencies that net to zero", () => {
    const a = computeBalances([expense("e1", [["alice", 1000n]], [["bob", 1000n]])]);
    const b = computeBalances([expense("e2", [["bob", 1000n]], [["alice", 1000n]])]);
    const totals = aggregateNet(
      [
        { currency: "EUR", sheet: a },
        { currency: "EUR", sheet: b },
      ],
      "alice",
    );
    expect(totals.has("EUR")).toBe(false);
  });
});
