import { describe, expect, it } from "vitest";
import { caretInGrouped, groupTypedAmount, readTypedAmount } from "../money";

/** Types into a grouped field: `shown` with `insert` placed at `at`. */
function type(shown: string, at: number, insert: string) {
  const raw = shown.slice(0, at) + insert + shown.slice(at);
  const read = readTypedAmount(raw, shown, at + insert.length);
  const next = groupTypedAmount(read.text);
  return { text: read.text, shown: next, caret: caretInGrouped(next, read.significant) };
}

/** Backspace in a grouped field, with the caret at `at`. */
function backspace(shown: string, at: number) {
  const raw = shown.slice(0, at - 1) + shown.slice(at);
  const read = readTypedAmount(raw, shown, at - 1);
  const next = groupTypedAmount(read.text);
  return { text: read.text, shown: next, caret: caretInGrouped(next, read.significant) };
}

describe("grouping a typed amount", () => {
  it("groups the whole part only", () => {
    expect(groupTypedAmount("9999999.99")).toBe("9,999,999.99");
    expect(groupTypedAmount("1234")).toBe("1,234");
    expect(groupTypedAmount("123")).toBe("123");
    expect(groupTypedAmount("1000.5")).toBe("1,000.5");
    expect(groupTypedAmount("0.")).toBe("0.");
    expect(groupTypedAmount("")).toBe("");
  });
});

describe("reading what was typed", () => {
  it("adds a digit at the end and keeps the caret at the end", () => {
    expect(type("999", 3, "9")).toEqual({ text: "9999", shown: "9,999", caret: 5 });
    expect(type("99,999", 6, "9")).toEqual({ text: "999999", shown: "999,999", caret: 7 });
  });

  it("treats a typed comma as a decimal point", () => {
    expect(type("12", 2, ",")).toEqual({ text: "12.", shown: "12.", caret: 3 });
    expect(type("1,234", 5, ",")).toEqual({ text: "1234.", shown: "1,234.", caret: 6 });
  });

  it("keeps the caret beside the digit typed in the middle", () => {
    // 1,234 with the caret after the 1: typing 5 gives 15,234, caret after 5.
    const r = type("1,234", 1, "5");
    expect(r.shown).toBe("15,234");
    expect(r.shown.slice(0, r.caret)).toBe("15");
  });

  it("deletes the digit before a drawn comma", () => {
    // Caret just after the comma in 1,234: backspace removes the 1.
    expect(backspace("1,234", 2)).toEqual({ text: "234", shown: "234", caret: 0 });
    expect(backspace("12,345", 3).text).toBe("1345");
  });

  it("regroups after a digit is deleted from the middle", () => {
    const r = backspace("9,999,999.99", 4);
    expect(r.text).toBe("999999.99");
    expect(r.shown).toBe("999,999.99");
  });

  it("reads pasted amounts the way they are written", () => {
    expect(readTypedAmount("12,50", "", 5).text).toBe("12.50");
    expect(readTypedAmount("1,234", "", 5).text).toBe("1234");
    expect(readTypedAmount("1,234,567.89", "", 12).text).toBe("1234567.89");
  });
});
