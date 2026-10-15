import { describe, expect, it } from "vitest";
import { categoryFor, groupNameFromFile, mainCurrency, parseCsv, parseSplitwiseExport, rebuildRow } from "../splitwise-import";

const sample = [
  "﻿Date,Description,Category,Cost,Currency,Ana Lima,Ben,Cy",
  "2026-03-01,Dinner,Dining out,90.00,EUR,60.00,-30.00,-30.00",
  '2026-03-02,"Tickets, museum",Entertainment - Other,45.00,EUR,-15.00,30.00,-15.00',
  "2026-03-03,Ben paid Ana,Payment,30.00,EUR,-30.00,30.00,0.00",
  "2026-03-04,Taxi split two ways,Taxi,10.01,EUR,5.00,-5.01,0.00",
  "2026-03-05,Snacks just for Ana,Groceries,12.00,EUR,0.00,0.00,0.00",
  "2026-03-06,Hotel paid by two,Hotel,300.00,EUR,100.00,50.00,-150.00",
  "",
  "2026-03-31,Total balance, , ,EUR,120.00,-25.01,-195.00",
].join("\r\n");

describe("reading a Splitwise export", () => {
  it("reads the people and every row, and skips the total", () => {
    const parsed = parseSplitwiseExport(sample);
    expect(parsed.people).toEqual(["Ana Lima", "Ben", "Cy"]);
    expect(parsed.rows).toHaveLength(6);
    expect(parsed.rows[1].description).toBe("Tickets, museum");
    expect(parsed.rows[0].cost).toBe("9000");
    expect(parsed.rows[0].nets).toEqual(["6000", "-3000", "-3000"]);
    expect(parsed.problems).toEqual([]);
  });

  it("explains when a file isn't a Splitwise export", () => {
    expect(() => parseSplitwiseExport("name,amount\nx,1")).toThrow(/Export as spreadsheet/);
  });

  it("handles quotes inside quotes and line breaks inside a cell", () => {
    expect(parseCsv('a,"say ""hi""","two\nlines"\n')).toEqual([["a", 'say "hi"', "two\nlines"]]);
  });
});

describe("rebuilding each row", () => {
  const parsed = parseSplitwiseExport(sample);

  it("gives everyone exactly the balance Splitwise had, row by row", () => {
    for (const row of parsed.rows) {
      const rebuilt = rebuildRow(row);
      const nets = parsed.people.map(() => 0n);
      if (rebuilt.kind === "payment") {
        nets[rebuilt.from] += rebuilt.amount;
        nets[rebuilt.to] -= rebuilt.amount;
      } else if (rebuilt.kind === "expense") {
        const paid = rebuilt.payers.reduce((t, p) => t + p.amount, 0n);
        const owed = rebuilt.splits.reduce((t, s) => t + s.amount, 0n);
        expect(paid).toBe(rebuilt.amount);
        expect(owed).toBe(rebuilt.amount);
        for (const p of rebuilt.payers) nets[p.index] += p.amount;
        for (const s of rebuilt.splits) nets[s.index] -= s.amount;
      }
      const expected = row.nets.map((n) => BigInt(n));
      const drift = expected.reduce((t, n) => t + n, 0n);
      if (drift === 0n && rebuilt.kind !== "skip") expect(nets, row.description).toEqual(expected);
    }
  });

  it("keeps the real cost of an expense", () => {
    const dinner = rebuildRow(parsed.rows[0]);
    expect(dinner.kind === "expense" && dinner.amount).toBe(9000n);
  });

  it("turns a payment row into a payment", () => {
    expect(rebuildRow(parsed.rows[2])).toEqual({ kind: "payment", from: 1, to: 0, amount: 3000n });
  });

  it("absorbs a one-cent rounding difference so the row still balances", () => {
    const taxi = rebuildRow(parsed.rows[3]);
    expect(taxi.kind).toBe("expense");
    if (taxi.kind === "expense") {
      expect(taxi.payers.reduce((t, p) => t + p.amount, 0n)).toBe(taxi.splits.reduce((t, s) => t + s.amount, 0n));
    }
  });

  it("skips a row where nobody owes anybody", () => {
    expect(rebuildRow(parsed.rows[4]).kind).toBe("skip");
  });

  it("splits a row two people came out ahead on between both of them", () => {
    const hotel = rebuildRow(parsed.rows[5]);
    expect(hotel.kind === "expense" && hotel.payers.map((p) => p.index).sort()).toEqual([0, 1]);
  });
});

describe("small helpers", () => {
  it("maps Splitwise categories to ours", () => {
    expect(categoryFor("Dining out", "x")).toBe("dining");
    expect(categoryFor("Hotel", "x")).toBe("accommodation");
    expect(categoryFor("General", "Uber to airport")).toBe("taxi");
  });

  it("names the group after the file", () => {
    expect(groupNameFromFile("lisbon-2026_2026-10-15_export.csv")).toBe("Lisbon 2026");
    expect(groupNameFromFile("flat_export.csv")).toBe("Flat");
  });

  it("picks the currency most rows use", () => {
    expect(mainCurrency(parseSplitwiseExport(sample).rows)).toBe("EUR");
  });
});
