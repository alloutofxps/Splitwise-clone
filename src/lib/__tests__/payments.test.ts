import { describe, expect, it } from "vitest";
import { paymentLink } from "@/lib/payments";

const method = (kind: string, value: string) => ({ id: "m1", kind, label: null, value, sortOrder: 0 });

describe("paymentLink", () => {
  it("fills in the amount when the debt is in the service's own currency", () => {
    expect(paymentLink(method("venmo", "@sam"), 5000n, "USD", "Sam")).toContain("amount=50.00");
    expect(paymentLink(method("cashapp", "$sam"), 5000n, "USD", "Sam")).toBe("https://cash.app/$sam/50.00");
    expect(paymentLink(method("monzo", "monzo.me/sam"), 5000n, "GBP", "Sam")).toBe("https://monzo.me/sam/50.00");
    const upi = new URL(paymentLink(method("upi", "sam@okhdfc"), 5000n, "INR", "Sam")!);
    expect(upi.searchParams.get("am")).toBe("50.00");
    expect(upi.searchParams.get("cu")).toBe("INR");
  });

  it("leaves the amount out when the service would read it in another currency", () => {
    // 50 euros must never open Venmo asking for 50 dollars.
    const venmo = new URL(paymentLink(method("venmo", "@sam"), 5000n, "EUR", "Sam")!);
    expect(venmo.searchParams.has("amount")).toBe(false);
    expect(venmo.searchParams.get("recipients")).toBe("sam");
    expect(paymentLink(method("cashapp", "$sam"), 5000n, "EUR", "Sam")).toBe("https://cash.app/$sam");
    expect(paymentLink(method("monzo", "monzo.me/sam"), 5000n, "USD", "Sam")).toBe("https://monzo.me/sam");
    const upi = new URL(paymentLink(method("upi", "sam@okhdfc"), 5000n, "EUR", "Sam")!);
    expect(upi.searchParams.has("am")).toBe(false);
    expect(upi.searchParams.has("cu")).toBe(false);
    expect(upi.searchParams.get("pa")).toBe("sam@okhdfc");
  });

  it("gives PayPal the currency with the amount, so any currency is safe", () => {
    expect(paymentLink(method("paypal", "paypal.me/sam"), 5000n, "EUR", "Sam")).toBe("https://paypal.me/sam/50.00EUR");
    expect(paymentLink(method("paypal", "@sam"), 1200n, "JPY", "Sam")).toBe("https://paypal.me/sam/1200JPY");
  });

  it("writes the amount with the currency's own decimals", () => {
    expect(paymentLink(method("upi", "sam@okhdfc"), 123456n, "INR", "Sam")).toContain("am=1234.56");
  });

  it("offers bank details and anything without a safe link as text to copy", () => {
    expect(paymentLink(method("iban", "GB29 NWBK 6016 1331 9268 19"), 5000n, "GBP", "Sam")).toBeNull();
    expect(paymentLink(method("bank", "12-34-56 12345678"), 5000n, "GBP", "Sam")).toBeNull();
    expect(paymentLink(method("custom", "http://example.com/pay"), 5000n, "GBP", "Sam")).toBeNull();
    expect(paymentLink(method("custom", "https://example.com/pay"), 5000n, "GBP", "Sam")).toBe("https://example.com/pay");
  });
});
