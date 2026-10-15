import { afterEach, describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { readLimitedText } from "@/lib/api";
import { clientKey, consume, resetRateLimits } from "../rate-limit";
import { cleanFilename, decodeDataUrl, validateExpense, type ExpenseWriteInput } from "../write";

const base: ExpenseWriteInput = {
  id: "exp_test",
  groupId: "g",
  description: "Dinner",
  notes: null,
  amount: 1000n,
  currency: "USD",
  exchangeRate: "1",
  settlementCurrency: "USD",
  splitMode: "EXACT",
  categoryId: null,
  date: new Date(),
  createdByPersonId: "a",
  payers: [{ personId: "a", amount: 1000n }],
  splits: [
    { personId: "a", amount: 500n, included: true, weight: null, percent: null, adjustment: null },
    { personId: "b", amount: 500n, included: true, weight: null, percent: null, adjustment: null },
  ],
  items: [],
  attachments: [],
};

describe("expense validation", () => {
  it("accepts a well-formed expense", () => {
    expect(() => validateExpense(base)).not.toThrow();
  });

  it("refuses the same payer twice instead of hitting a database 500", () => {
    expect(() =>
      validateExpense({ ...base, payers: [{ personId: "a", amount: 500n }, { personId: "a", amount: 500n }] }),
    ).toThrow(ValidationError);
  });

  it("refuses the same person twice in the split", () => {
    const split = base.splits[0];
    expect(() => validateExpense({ ...base, splits: [split, { ...split }] })).toThrow(ValidationError);
  });

  it("refuses a made-up currency", () => {
    expect(() => validateExpense({ ...base, currency: "ZZZ", settlementCurrency: "ZZZ" })).toThrow(/currency/);
  });

  it("refuses item lines naming somebody outside the split", () => {
    expect(() =>
      validateExpense({ ...base, items: [{ name: "x", amount: 100n, quantity: 1, participantIds: ["stranger"] }] }),
    ).toThrow(/isn't in the split/);
  });

  it("refuses negative item prices and out-of-range percentages", () => {
    expect(() =>
      validateExpense({ ...base, items: [{ name: "x", amount: -1n, quantity: 1, participantIds: ["a"] }] }),
    ).toThrow(ValidationError);
    expect(() =>
      validateExpense({ ...base, splits: base.splits.map((s) => ({ ...s, percent: 150 })) }),
    ).toThrow(/percentage/);
  });
});

describe("receipt uploads", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  it("accepts a file that is what it says it is", () => {
    const decoded = decodeDataUrl(`data:image/png;base64,${png.toString("base64")}`, "r.png");
    expect(decoded.mimeType).toBe("image/png");
  });

  it("refuses an HTML page labelled as an image", () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
    expect(() => decodeDataUrl(`data:image/png;base64,${html}`, "r.png")).toThrow(/isn't really a photo or PDF/);
  });

  it("refuses the percent-encoded form that used to crash with a 500", () => {
    expect(() => decodeDataUrl("data:image/png,%E0%A4%A", "r.png")).toThrow(ValidationError);
  });

  it("strips paths and control characters from filenames", () => {
    expect(cleanFilename('../../etc/"pass\u0007wd')).toBe('.._.._etc_passwd');
    expect(cleanFilename("")).toBe("receipt");
  });
});

describe("rate limiting", () => {
  afterEach(() => {
    resetRateLimits();
    delete process.env.DIVVY_TRUSTED_PROXIES;
  });

  const request = (forwardedFor?: string) =>
    new Request("http://x/", { headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {} });

  it("trusts the address the proxy appended, not the one the client wrote", () => {
    expect(clientKey(request("6.6.6.6, 203.0.113.9"))).toBe("203.0.113.9");
  });

  it("can trust more than one proxy hop", () => {
    process.env.DIVVY_TRUSTED_PROXIES = "2";
    expect(clientKey(request("6.6.6.6, 203.0.113.9, 10.0.0.1"))).toBe("203.0.113.9");
  });

  it("returns nothing rather than lumping everyone together when there is no address", () => {
    expect(clientKey(request())).toBeNull();
  });

  it("blocks past the allowance and does not reset when flooded with new keys", () => {
    const limit = { limit: 3, windowSeconds: 60 };
    for (let i = 0; i < 3; i++) consume("victim", limit);
    expect(() => consume("victim", limit)).toThrow();
    // A flood of fresh keys used to clear every counter at once.
    for (let i = 0; i < 60_000; i++) consume(`flood-${i}`, limit);
    expect(() => consume("victim", limit)).toThrow();
  });
});

describe("request bodies", () => {
  it("stops reading once a body passes the limit", async () => {
    const big = new Request("http://x/", { method: "POST", body: "a".repeat(10_000) });
    await expect(readLimitedText(big, 1_000)).rejects.toThrow(/too big/);
  });

  it("refuses a declared length over the limit without reading", async () => {
    const declared = new Request("http://x/", {
      method: "POST",
      body: "small",
      headers: { "content-length": "999999999" },
    });
    await expect(readLimitedText(declared, 1_000)).rejects.toThrow(/too big/);
  });

  it("reads a body under the limit", async () => {
    const ok = new Request("http://x/", { method: "POST", body: '{"a":1}' });
    await expect(readLimitedText(ok, 1_000)).resolves.toBe('{"a":1}');
  });
});
