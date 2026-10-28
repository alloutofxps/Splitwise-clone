import { describe, expect, it } from "vitest";
import { apportion, convertedBreakdown, resolveSplit, validateExpenseBalance, type SplitMode } from "../split";

/**
 * The exact result of every split mode: each share, who counts as included,
 * and the words shown when a split doesn't add up (RULES.md M1, M2, M12).
 *
 * Mutation testing found these were mostly unchecked: the money tests proved
 * the shares add up, but not which person gets the odd cent, who is shown as
 * "in" on the expense, or what the error says.
 */

describe("handing out the odd cent", () => {
  it("goes in order when everyone is equal", () => {
    expect(apportion(10n, [1, 1, 1])).toEqual([4n, 3n, 3n]);
    expect(apportion(-10n, [1, 1, 1])).toEqual([-4n, -3n, -3n]);
  });

  it("goes to the lowest priority number first", () => {
    expect(apportion(10n, [1, 1, 1], [1, 0, 1])).toEqual([3n, 4n, 3n]);
    expect(apportion(10n, [1, 1, 1], [2, 1, 3])).toEqual([3n, 4n, 3n]);
    expect(apportion(11n, [1, 1, 1], [2, 1, 3])).toEqual([4n, 4n, 3n]);
    expect(apportion(10n, [1, 1, 1], [5])).toEqual([4n, 3n, 3n]);
  });

  it("goes to the biggest fraction before priority", () => {
    expect(apportion(10n, [1, 2])).toEqual([3n, 7n]);
    expect(apportion(10n, [1, 2], [0, 1])).toEqual([3n, 7n]);
  });

  it("shares evenly when nobody has any weight", () => {
    expect(apportion(9n, [0, 0, 0])).toEqual([3n, 3n, 3n]);
    expect(apportion(10n, [-1, 0])).toEqual([5n, 5n]);
    expect(apportion(5n, [])).toEqual([]);
  });
});

const run = (mode: SplitMode, total: bigint, participants: Parameters<typeof resolveSplit>[0]["participants"], extra = {}) =>
  resolveSplit({ mode, total, participants, ...extra });

describe("splitting", () => {
  it("refuses an empty split, a person twice and a mode it doesn't know", () => {
    expect(run("EQUAL", 100n, [])).toEqual({ splits: [], errors: ["Pick at least one person to split with."] });
    expect(run("EQUAL", 100n, [{ personId: "a" }, { personId: "a" }]).errors).toEqual([
      "The same person appears twice in the split.",
    ]);
    expect(run("BOGUS" as SplitMode, 100n, [{ personId: "a" }])).toEqual({
      splits: [],
      errors: ['Unknown split mode "BOGUS".'],
    });
  });

  it("equally: the payer takes the odd cent, and people left out owe nothing", () => {
    expect(run("EQUAL", 101n, [{ personId: "a" }, { personId: "b" }, { personId: "c", included: false }], { payerIds: ["b"] })).toEqual({
      splits: [
        { personId: "a", amount: 50n, included: true },
        { personId: "b", amount: 51n, included: true },
        { personId: "c", amount: 0n, included: false },
      ],
      errors: [],
    });
    expect(run("EQUAL", 100n, [{ personId: "a", included: false }])).toEqual({
      splits: [],
      errors: ["Nobody is selected, so nobody would owe anything."],
    });
  });

  it("by exact amounts: says how much is left or over", () => {
    expect(run("EXACT", 1000n, [{ personId: "a", amount: 600n }, { personId: "b" }])).toEqual({
      splits: [
        { personId: "a", amount: 600n, included: true },
        { personId: "b", amount: 0n, included: false },
      ],
      errors: ["400 still needs to be assigned."],
    });
    expect(run("EXACT", 1000n, [{ personId: "a", amount: 1200n }]).errors).toEqual([
      "200 more has been assigned than the expense total.",
    ]);
    expect(run("EXACT", 1000n, [{ personId: "a", amount: 400n }, { personId: "b", amount: 600n }]).errors).toEqual([]);
  });

  it("by percent: shares, who is in, and what's left or over", () => {
    expect(run("PERCENT", 1000n, [{ personId: "a", percent: 50.5 }, { personId: "b", percent: 49.5 }, { personId: "c" }])).toEqual({
      splits: [
        { personId: "a", amount: 505n, included: true, percent: 50.5 },
        { personId: "b", amount: 495n, included: true, percent: 49.5 },
        { personId: "c", amount: 0n, included: false, percent: 0 },
      ],
      errors: [],
    });
    expect(run("PERCENT", 1000n, [{ personId: "a", percent: 60 }, { personId: "b", percent: 0 }]).errors).toEqual([
      "40% left to assign.",
    ]);
    expect(run("PERCENT", 1000n, [{ personId: "a", percent: 70 }, { personId: "b", percent: 40 }]).errors).toEqual([
      "10% over 100%.",
    ]);
    expect(run("PERCENT", 1000n, [{ personId: "a", percent: 33.33 }, { personId: "b", percent: 33.33 }]).errors).toEqual([
      "33.3% left to assign.",
    ]);
  });

  it("by shares: weights, who is in, and nobody with a share", () => {
    expect(run("SHARES", 300n, [{ personId: "a", weight: 2 }, { personId: "b", weight: 1 }, { personId: "c", weight: -1 }])).toEqual({
      splits: [
        { personId: "a", amount: 200n, included: true, weight: 2 },
        { personId: "b", amount: 100n, included: true, weight: 1 },
        { personId: "c", amount: 0n, included: false, weight: 0 },
      ],
      errors: [],
    });
    expect(run("SHARES", 300n, [{ personId: "a" }, { personId: "b", weight: 0 }])).toEqual({
      splits: [
        { personId: "a", amount: 0n, included: false, weight: 0 },
        { personId: "b", amount: 0n, included: false, weight: 0 },
      ],
      errors: ["Give at least one person a share."],
    });
  });

  it("with extras: takes them off the top, then splits the rest", () => {
    expect(
      run("ADJUSTMENT", 1000n, [
        { personId: "a", adjustment: 200n },
        { personId: "b" },
        { personId: "c", included: false, adjustment: 100n },
        { personId: "d", included: false },
      ]),
    ).toEqual({
      splits: [
        { personId: "a", amount: 550n, included: true, adjustment: 200n },
        { personId: "b", amount: 350n, included: true, adjustment: 0n },
        { personId: "c", amount: 100n, included: true, adjustment: 100n },
        { personId: "d", amount: 0n, included: false, adjustment: 0n },
      ],
      errors: [],
    });
    expect(run("ADJUSTMENT", 1000n, [{ personId: "a", adjustment: 1200n }]).errors).toEqual([
      "Extras add up to 200 more than the expense total.",
    ]);
    // Extras that use up the whole bill are fine; nothing is left to share.
    expect(run("ADJUSTMENT", 1000n, [{ personId: "a", adjustment: 1000n }, { personId: "b" }])).toEqual({
      splits: [
        { personId: "a", amount: 1000n, included: true, adjustment: 1000n },
        { personId: "b", amount: 0n, included: true, adjustment: 0n },
      ],
      errors: [],
    });
    expect(run("ADJUSTMENT", 1000n, [{ personId: "a", included: false }])).toEqual({
      splits: [],
      errors: ["Pick at least one person to split the rest."],
    });
  });

  it("by item: lines to who had them, tax and tip by what each had", () => {
    const items = [
      { id: "i1", amount: 600n, participantIds: ["a"] },
      { id: "i2", amount: 300n, participantIds: ["a", "b"] },
      // Claimed only by someone left out, so everyone in shares it.
      { id: "i3", amount: 100n, participantIds: ["c"] },
    ];
    expect(run("ITEMIZED", 1100n, [{ personId: "a" }, { personId: "b" }, { personId: "c", included: false }], { items })).toEqual({
      splits: [
        { personId: "a", amount: 880n, included: true },
        { personId: "b", amount: 220n, included: true },
        { personId: "c", amount: 0n, included: false },
      ],
      errors: [],
    });
  });

  it("by item: the payer takes a line's odd cent, and nothing itemised shares evenly", () => {
    const items = [{ id: "i1", amount: 101n, participantIds: ["a", "b"] }];
    expect(run("ITEMIZED", 101n, [{ personId: "a" }, { personId: "b" }], { items, payerIds: ["b"] }).splits.map((s) => s.amount)).toEqual([50n, 51n]);
    expect(run("ITEMIZED", 100n, [{ personId: "a" }, { personId: "b" }]).splits.map((s) => s.amount)).toEqual([50n, 50n]);
    expect(run("ITEMIZED", 101n, [{ personId: "a" }, { personId: "b" }], { payerIds: ["b"] }).splits.map((s) => s.amount)).toEqual([50n, 51n]);
  });

  it("by item: says when the lines come to more than the bill", () => {
    const items = [{ id: "i1", amount: 600n, participantIds: ["a"] }];
    const result = run("ITEMIZED", 500n, [{ personId: "a" }, { personId: "b" }], { items });
    expect(result.errors).toEqual(["Items add up to 100 more than the expense total."]);
    expect(result.splits.map((s) => s.amount)).toEqual([500n, 0n]);
    expect(run("ITEMIZED", 500n, [{ personId: "a", included: false }], { items })).toEqual({
      splits: [],
      errors: ["Pick at least one person to split with."],
    });
  });
});

describe("the last check before saving", () => {
  it("passes a bill that adds up", () => {
    expect(validateExpenseBalance(1000n, [a("x", 1000n)], [a("x", 500n), a("y", 500n)])).toEqual([]);
  });

  it("says exactly what is wrong", () => {
    expect(validateExpenseBalance(0n, [], [])).toEqual(["An expense needs an amount greater than zero."]);
    expect(validateExpenseBalance(1000n, [a("x", 900n)], [a("x", 1000n)])).toEqual([
      "Payments add up to 900 but the expense is 1000. They have to match.",
    ]);
    expect(validateExpenseBalance(1000n, [a("x", 1000n)], [a("x", 900n)])).toEqual([
      "Shares add up to 900 but the expense is 1000. They have to match.",
    ]);
    expect(validateExpenseBalance(1000n, [a("x", 1500n), a("y", -500n)], [a("x", 1000n)])).toEqual([
      "What someone paid can't be below zero.",
    ]);
    expect(validateExpenseBalance(1000n, [a("x", 1000n)], [a("x", 2000n), a("y", -1000n)])).toEqual([
      "A share can't be below zero.",
    ]);
  });

  it("allows someone who paid nothing or owes nothing", () => {
    expect(validateExpenseBalance(1000n, [a("x", 1000n), a("y", 0n)], [a("x", 1000n), a("y", 0n)])).toEqual([]);
  });
});

describe("converting a bill's shares", () => {
  it("keeps each person with their own amount, and leaves out zero shares", () => {
    expect(
      convertedBreakdown({ convertedAmount: 2000n, payers: [a("p", 300n), a("q", 700n)], splits: [a("x", 0n), a("y", 500n), a("z", 500n)] }),
    ).toEqual({
      paid: [a("p", 600n), a("q", 1400n)],
      owed: [a("y", 1000n), a("z", 1000n)],
    });
  });
});

function a(personId: string, amount: bigint) {
  return { personId, amount };
}
