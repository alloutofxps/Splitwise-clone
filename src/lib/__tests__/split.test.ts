import { describe, expect, it } from "vitest";
import { apportion, resolveSplit, validateExpenseBalance, type SplitMode } from "../split";
import { sum } from "../money";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

describe("apportion", () => {
  it("always sums to the total", () => {
    for (const total of [0n, 1n, 7n, 100n, 1000n, 99999n]) {
      for (const n of [1, 2, 3, 5, 7, 11]) {
        const parts = apportion(total, Array.from({ length: n }, () => 1));
        expect(sum(parts)).toBe(total);
      }
    }
  });

  it("spreads the remainder one unit at a time", () => {
    // 10.00 three ways: two people at 3.33, one at 3.34.
    const parts = apportion(1000n, [1, 1, 1]);
    expect([...parts].sort()).toEqual([333n, 333n, 334n]);
  });

  it("gives the remainder to the priority recipient first", () => {
    // p1 is the payer, so p1 absorbs the odd cent.
    const parts = apportion(1000n, [1, 1, 1], [1, 0, 1]);
    expect(parts).toEqual([333n, 334n, 333n]);
  });

  it("honours weights", () => {
    expect(apportion(1000n, [3, 1])).toEqual([750n, 250n]);
    expect(sum(apportion(1000n, [1, 2, 3, 4]))).toBe(1000n);
  });

  it("handles negative totals", () => {
    const parts = apportion(-1000n, [1, 1, 1]);
    expect(sum(parts)).toBe(-1000n);
  });

  it("falls back to an even split when every weight is zero", () => {
    expect(sum(apportion(900n, [0, 0, 0]))).toBe(900n);
  });

  it("never loses a unit across many random splits", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 2000; trial++) {
      const n = 1 + Math.floor(rand() * 9);
      const total = BigInt(Math.floor(rand() * 1_000_000));
      const weights = Array.from({ length: n }, () => Math.floor(rand() * 10));
      expect(sum(apportion(total, weights))).toBe(total);
    }
  });
});

describe("resolveSplit", () => {
  const base = (mode: SplitMode, participants: Parameters<typeof resolveSplit>[0]["participants"]) =>
    resolveSplit({ mode, total: 1000n, participants, payerIds: ["p0"] });

  it("splits equally and gives the payer the odd unit", () => {
    const { splits, errors } = base(
      "EQUAL",
      ids(3).map((personId) => ({ personId })),
    );
    expect(errors).toEqual([]);
    expect(sum(splits.map((s) => s.amount))).toBe(1000n);
    expect(splits.find((s) => s.personId === "p0")!.amount).toBe(334n);
  });

  it("excludes people who are switched off", () => {
    const { splits } = base("EQUAL", [
      { personId: "p0" },
      { personId: "p1" },
      { personId: "p2", included: false },
    ]);
    expect(splits.find((s) => s.personId === "p2")!.amount).toBe(0n);
    expect(sum(splits.map((s) => s.amount))).toBe(1000n);
  });

  it("rejects an equal split with nobody in it", () => {
    const { errors } = base("EQUAL", [{ personId: "p0", included: false }]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("reports the gap on an exact split that does not add up", () => {
    const { errors } = base("EXACT", [
      { personId: "p0", amount: 400n },
      { personId: "p1", amount: 400n },
    ]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("200");
  });

  it("accepts an exact split that adds up", () => {
    const { errors, splits } = base("EXACT", [
      { personId: "p0", amount: 400n },
      { personId: "p1", amount: 600n },
    ]);
    expect(errors).toEqual([]);
    expect(sum(splits.map((s) => s.amount))).toBe(1000n);
  });

  it("splits by percentage and validates the total", () => {
    const ok = base("PERCENT", [
      { personId: "p0", percent: 30 },
      { personId: "p1", percent: 70 },
    ]);
    expect(ok.errors).toEqual([]);
    expect(ok.splits.map((s) => s.amount)).toEqual([300n, 700n]);

    const bad = base("PERCENT", [
      { personId: "p0", percent: 30 },
      { personId: "p1", percent: 60 },
    ]);
    expect(bad.errors[0]).toContain("10");
  });

  it("splits by shares", () => {
    const { splits, errors } = base("SHARES", [
      { personId: "p0", weight: 2 },
      { personId: "p1", weight: 1 },
      { personId: "p2", weight: 1 },
    ]);
    expect(errors).toEqual([]);
    expect(splits.map((s) => s.amount)).toEqual([500n, 250n, 250n]);
  });

  it("takes adjustments off the top then splits the rest evenly", () => {
    // 10.00 total, Sam had a 4.00 extra: remainder 6.00 split two ways.
    const { splits, errors } = base("ADJUSTMENT", [
      { personId: "p0" },
      { personId: "p1", adjustment: 400n },
    ]);
    expect(errors).toEqual([]);
    expect(splits.find((s) => s.personId === "p0")!.amount).toBe(300n);
    expect(splits.find((s) => s.personId === "p1")!.amount).toBe(700n);
  });

  it("flags adjustments that exceed the total", () => {
    const { errors } = base("ADJUSTMENT", [
      { personId: "p0" },
      { personId: "p1", adjustment: 1500n },
    ]);
    expect(errors.length).toBe(1);
  });

  it("splits an itemised receipt and shares tax by consumption", () => {
    // p0 ordered 6.00, p1 ordered 2.00, and there is 2.00 of tax/tip left over
    // which should land 3:1 in the same proportion.
    const { splits, errors } = resolveSplit({
      mode: "ITEMIZED",
      total: 1000n,
      payerIds: ["p0"],
      participants: [{ personId: "p0" }, { personId: "p1" }],
      items: [
        { id: "i1", amount: 600n, participantIds: ["p0"] },
        { id: "i2", amount: 200n, participantIds: ["p1"] },
      ],
    });
    expect(errors).toEqual([]);
    expect(sum(splits.map((s) => s.amount))).toBe(1000n);
    expect(splits.find((s) => s.personId === "p0")!.amount).toBe(750n);
    expect(splits.find((s) => s.personId === "p1")!.amount).toBe(250n);
  });

  it("shares an unclaimed item across everyone", () => {
    const { splits } = resolveSplit({
      mode: "ITEMIZED",
      total: 1000n,
      participants: [{ personId: "p0" }, { personId: "p1" }],
      items: [{ id: "i1", amount: 1000n, participantIds: [] }],
    });
    expect(splits.map((s) => s.amount)).toEqual([500n, 500n]);
  });

  it("flags a duplicated participant", () => {
    const { errors } = base("EQUAL", [{ personId: "p0" }, { personId: "p0" }]);
    expect(errors.some((e) => e.includes("twice"))).toBe(true);
  });

  it("keeps every mode exactly conservative across random inputs", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const modes: SplitMode[] = ["EQUAL", "PERCENT", "SHARES", "ADJUSTMENT"];

    for (let trial = 0; trial < 1000; trial++) {
      const n = 1 + Math.floor(rand() * 6);
      const people = ids(n);
      const total = BigInt(1 + Math.floor(rand() * 500_000));
      const mode = modes[Math.floor(rand() * modes.length)];

      const participants = people.map((personId, i) => {
        switch (mode) {
          case "PERCENT":
            return { personId, percent: i === 0 ? 100 - (n - 1) * 10 : 10 };
          case "SHARES":
            return { personId, weight: 1 + Math.floor(rand() * 4) };
          case "ADJUSTMENT":
            // Keep adjustments small enough that they cannot exceed the total.
            return { personId, adjustment: BigInt(Math.floor(rand() * 100)) };
          default:
            return { personId };
        }
      });

      const { splits } = resolveSplit({ mode, total, participants, payerIds: [people[0]] });
      expect(sum(splits.map((s) => s.amount))).toBe(total);
    }
  });
});

describe("validateExpenseBalance", () => {
  it("passes when payers and splits both match the total", () => {
    expect(
      validateExpenseBalance(
        1000n,
        [{ personId: "p0", amount: 1000n }],
        [
          { personId: "p0", amount: 500n },
          { personId: "p1", amount: 500n },
        ],
      ),
    ).toEqual([]);
  });

  it("catches payers that do not add up", () => {
    const errors = validateExpenseBalance(
      1000n,
      [{ personId: "p0", amount: 900n }],
      [{ personId: "p0", amount: 1000n }],
    );
    expect(errors.length).toBe(1);
  });

  it("rejects a zero or negative total", () => {
    expect(validateExpenseBalance(0n, [], []).length).toBeGreaterThan(0);
  });
});
