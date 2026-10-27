import { describe, expect, it } from "vitest";
import { biggestFirst } from "../shared-ledgers";
import type { SharedLedgerDto } from "../types";

const direct = (currency: string, net: string): SharedLedgerDto => ({
  groupId: null, name: null, emoji: null, currency, net, planned: null,
});
const group = (groupId: string, name: string, net: string): SharedLedgerDto => ({
  groupId, name, emoji: "🏠", currency: "EUR", net, planned: null,
});
const keys = (ledgers: SharedLedgerDto[]) => ledgers.map((ledger) => ledger.groupId ?? `direct ${ledger.currency}`);

describe("biggestFirst", () => {
  it("puts the biggest amount first, whichever way it is owed", () => {
    const ledgers = [group("g1", "Flat", "500"), group("g2", "Trip", "-2000"), direct("EUR", "1200")];
    expect(keys(ledgers.sort(biggestFirst))).toEqual(["g2", "direct EUR", "g1"]);
  });

  it("gives equal amounts the same order whatever order they arrive in", () => {
    const ledgers = [
      group("g3", "Trip", "1000"),
      direct("USD", "-1000"),
      group("g1", "Flat", "-1000"),
      direct("EUR", "1000"),
      group("g2", "Flat", "1000"),
    ];
    const expected = ["direct EUR", "direct USD", "g1", "g2", "g3"];
    // Every starting order of the five comes out the same.
    const orders = (rest: SharedLedgerDto[]): SharedLedgerDto[][] =>
      rest.length <= 1 ? [rest] : rest.flatMap((first, i) => orders(rest.filter((_, j) => j !== i)).map((tail) => [first, ...tail]));
    for (const order of orders(ledgers)) {
      expect(keys([...order].sort(biggestFirst))).toEqual(expected);
    }
  });

  it("calls a ledger equal to itself", () => {
    const ledger = group("g1", "Flat", "1000");
    expect(biggestFirst(ledger, ledger)).toBe(0);
    expect(biggestFirst(direct("EUR", "5"), direct("EUR", "-5"))).toBe(0);
  });
});
