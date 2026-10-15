import { describe, expect, it } from "vitest";
import { readReceiptText } from "../receipt-text";

const cafe = `
CAFE LISBOA
Rua Augusta 120
Tel 21 345 6789
2 x Pastel de nata    3.00
Galao                 1.80
Tosta mista           4.50
Agua 50cl             1.20
SUBTOTAL             10.50
IVA 23%               1.96
TOTAL                10.50
VISA                 10.50
`;

describe("reading a receipt", () => {
  it("finds the total, not the subtotal or the card line", () => {
    expect(readReceiptText(cafe, "EUR").total).toBe(1050n);
  });

  it("finds the shop's name at the top", () => {
    expect(readReceiptText(cafe, "EUR").merchant).toBe("Cafe Lisboa");
  });

  it("lists the items and leaves out tax, subtotal and payment lines", () => {
    const { items } = readReceiptText(cafe, "EUR");
    expect(items.map((i) => i.name)).toEqual(["Pastel de nata", "Galao", "Tosta mista", "Agua 50cl"]);
    expect(items.map((i) => i.amount)).toEqual([300n, 180n, 450n, 120n]);
  });

  it("copes with common misreadings: O for 0 and a space instead of a decimal point", () => {
    const messy = "DINER 24\nBurger 12 5O\nFries 4 00\nTOTAL 16 5O";
    const reading = readReceiptText(messy, "EUR");
    expect(reading.total).toBe(1650n);
  });

  it("reads yen, which has no decimals", () => {
    const ramen = "ICHIRAN SHIBUYA\nRamen 980\nEgg 140\nTotal ¥1,120";
    const reading = readReceiptText(ramen, "JPY");
    expect(reading.total).toBe(1120n);
    expect(reading.items.map((i) => i.amount)).toEqual([980n, 140n]);
  });

  it("reads rupees with thousands separators", () => {
    const bill = "Spice Route\nPaneer tikka 1,250.00\nNaan 180.00\nCGST 2.5% 35.75\nSGST 2.5% 35.75\nGrand Total 1,501.50";
    const reading = readReceiptText(bill, "INR");
    expect(reading.total).toBe(150150n);
    expect(reading.items).toHaveLength(2);
  });

  it("falls back to the biggest amount when no line says total", () => {
    expect(readReceiptText("Market\nApples 2.40\nBread 3.10\n5.50", "EUR").total).toBe(550n);
  });

  it("gives up cleanly on a photo with no prices", () => {
    expect(readReceiptText("hello there", "EUR")).toEqual({ total: null, merchant: "Hello There", items: [] });
  });
});
