import { describe, expect, it } from "vitest";
import { remapTemplate } from "@/server/merge";

/**
 * Recurrence templates are the one place a person id is stored as text rather
 * than as a foreign key, so nothing in the database stops a template from
 * naming a placeholder that has been merged away. The row survives the merge
 * and fires later, and by then the name it holds belongs to nobody: the
 * generated expense fails, or worse, succeeds against a dangling id.
 *
 * The balance property is the same one the merge as a whole has to satisfy —
 * a template that produced a €100 bill before must still produce a €100 bill
 * — which is why two entries collapsing into one add up rather than overwrite.
 */

const GHOST = "ghost_1";
const REAL = "person_1";

interface Entry {
  personId: string;
  amount?: string;
  included?: boolean;
  weight?: number | null;
  percent?: number | null;
  adjustment?: string | null;
}

/** The stored form is text, so every read of one goes through here. */
function parse(json: string | null): Entry[] {
  return JSON.parse(json ?? "[]") as Entry[];
}

/** Total of every `amount` in a template, as the expense generator would sum it. */
function total(json: string): bigint {
  return parse(json).reduce((sum, entry) => sum + BigInt(entry.amount ?? "0"), 0n);
}

describe("remapTemplate", () => {
  it("leaves a template that never named the placeholder alone", () => {
    const template = JSON.stringify([{ personId: REAL, amount: "5000" }]);
    expect(remapTemplate(template, GHOST, REAL)).toBeNull();
  });

  it("renames the placeholder's entry", () => {
    const template = JSON.stringify([
      { personId: GHOST, amount: "3000" },
      { personId: "other", amount: "7000" },
    ]);
    const result = remapTemplate(template, GHOST, REAL);
    expect(result).not.toBeNull();
    expect(parse(result)).toEqual([
      { personId: REAL, amount: "3000" },
      { personId: "other", amount: "7000" },
    ]);
  });

  it("combines the two entries when both names are in the same template", () => {
    const template = JSON.stringify([
      { personId: REAL, amount: "4000", included: true, percent: 40, weight: null },
      { personId: GHOST, amount: "6000", included: true, percent: 60, weight: null },
    ]);
    const result = remapTemplate(template, GHOST, REAL) as string;
    const entries = parse(result);

    expect(entries).toHaveLength(1);
    expect(entries[0].personId).toBe(REAL);
    expect(entries[0].amount).toBe("10000");
    expect(entries[0].percent).toBe(100);
    expect(total(result)).toBe(total(template));
  });

  it("keeps an entry included when either half was", () => {
    const template = JSON.stringify([
      { personId: REAL, amount: "0", included: false },
      { personId: GHOST, amount: "2500", included: true },
    ]);
    const entries = parse(remapTemplate(template, GHOST, REAL));
    expect(entries[0].included).toBe(true);
    expect(entries[0].amount).toBe("2500");
  });

  it("sums adjustments, which can be negative", () => {
    const template = JSON.stringify([
      { personId: REAL, amount: "1000", adjustment: "-500" },
      { personId: GHOST, amount: "1000", adjustment: "200" },
    ]);
    const entries = parse(remapTemplate(template, GHOST, REAL));
    expect(entries[0].adjustment).toBe("-300");
    expect(entries[0].amount).toBe("2000");
  });

  it("keeps null where both halves were null, rather than inventing a zero", () => {
    const template = JSON.stringify([
      { personId: REAL, amount: "1000", weight: null, percent: null },
      { personId: GHOST, amount: "1000", weight: null, percent: null },
    ]);
    const entries = parse(remapTemplate(template, GHOST, REAL));
    expect(entries[0].weight).toBeNull();
    expect(entries[0].percent).toBeNull();
  });

  it("preserves order, so the first-listed payer stays first", () => {
    const template = JSON.stringify([
      { personId: "a", amount: "100" },
      { personId: GHOST, amount: "200" },
      { personId: "b", amount: "300" },
    ]);
    const entries = parse(remapTemplate(template, GHOST, REAL));
    expect(entries.map((entry) => entry.personId)).toEqual(["a", REAL, "b"]);
  });

  it("declines to touch anything it cannot parse", () => {
    expect(remapTemplate("not json", GHOST, REAL)).toBeNull();
    expect(remapTemplate('{"personId":"ghost_1"}', GHOST, REAL)).toBeNull();
  });
});
