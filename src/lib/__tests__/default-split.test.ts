import { describe, expect, it } from "vitest";
import { defaultSplitProblem, describeDefaultSplit, parseDefaultSplit, startingSplit } from "../default-split";
import { resolveSplit } from "../split";

const couple = { mode: "PERCENT" as const, entries: [{ personId: "ana", value: 60 }, { personId: "ben", value: 40 }] };

describe("checking a usual split", () => {
  it("accepts percentages that add up to 100", () => {
    expect(defaultSplitProblem(couple, ["ana", "ben"])).toBeNull();
  });

  it("says what's wrong when they don't", () => {
    const off = { mode: "PERCENT" as const, entries: [{ personId: "ana", value: 60 }, { personId: "ben", value: 30 }] };
    expect(defaultSplitProblem(off, ["ana", "ben"])).toMatch(/add up to 90%/);
  });

  it("refuses someone who isn't in the group", () => {
    expect(defaultSplitProblem(couple, ["ana"])).toMatch(/in the group/);
  });

  it("needs at least one share", () => {
    expect(defaultSplitProblem({ mode: "SHARES", entries: [{ personId: "ana", value: 0 }] }, ["ana"])).toMatch(/share/);
  });

  it("allows thirds that round to 99.99", () => {
    const thirds = { mode: "PERCENT" as const, entries: ["a", "b", "c"].map((personId) => ({ personId, value: 33.33 })) };
    expect(defaultSplitProblem(thirds, ["a", "b", "c"])).toMatch(/99.99/);
    const fixed = { ...thirds, entries: [...thirds.entries.slice(0, 2), { personId: "c", value: 33.34 }] };
    expect(defaultSplitProblem(fixed, ["a", "b", "c"])).toBeNull();
  });
});

describe("starting a new expense", () => {
  it("uses the usual split, and the maths comes out exact", () => {
    const start = startingSplit(couple, ["ana", "ben"])!;
    expect(start.mode).toBe("PERCENT");
    const { splits, errors } = resolveSplit({ mode: start.mode, total: 9999n, participants: start.participants, payerIds: ["ana"] });
    expect(errors).toEqual([]);
    expect(splits.reduce((t, s) => t + s.amount, 0n)).toBe(9999n);
    expect(splits.find((s) => s.personId === "ana")?.amount).toBe(5999n);
  });

  it("leaves a newcomer out of a percent split rather than guessing their share", () => {
    const start = startingSplit(couple, ["ana", "ben", "cy"])!;
    expect(start.participants.find((p) => p.personId === "cy")?.percent).toBe(0);
  });

  it("falls back to equal when someone in a percent split has left", () => {
    const start = startingSplit(couple, ["ana", "cy"])!;
    expect(start.mode).toBe("EQUAL");
    expect(start.stale).toBe(true);
  });

  it("just drops a leaver from a split by shares", () => {
    const shares = { mode: "SHARES" as const, entries: [{ personId: "ana", value: 2 }, { personId: "ben", value: 1 }, { personId: "cy", value: 1 }] };
    const start = startingSplit(shares, ["ana", "ben"])!;
    expect(start.mode).toBe("SHARES");
    expect(start.stale).toBe(false);
  });

  it("starts equal when the group has no usual split", () => {
    expect(startingSplit(null, ["ana", "ben"])).toBeNull();
  });
});

describe("reading and describing", () => {
  it("ignores anything that isn't a valid usual split", () => {
    expect(parseDefaultSplit("not json")).toBeNull();
    expect(parseDefaultSplit(JSON.stringify({ mode: "EQUAL", entries: [] }))).toBeNull();
    expect(parseDefaultSplit(JSON.stringify(couple))).toEqual(couple);
  });

  it("describes it in a few words", () => {
    const name = (id: string) => (id === "ana" ? "You" : "Ben");
    expect(describeDefaultSplit(couple, name)).toBe("You 60%, Ben 40%");
    expect(describeDefaultSplit(null, name)).toBe("Equally");
  });
});
