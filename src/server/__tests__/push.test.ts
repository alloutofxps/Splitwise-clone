import { describe, expect, it } from "vitest";
import { messageFor, recipientsFor } from "../push";

const base = {
  id: "a1",
  groupId: "g1",
  actorPersonId: "ana",
  targetPersonId: null,
  actor: { displayName: "Ana" },
  group: { name: "Lisbon", emoji: "🏝️" },
  expense: null,
  settlement: null,
};

const dinner = {
  ...base,
  type: "expense.created",
  data: JSON.stringify({ description: "Dinner", amount: "9000", currency: "EUR" }),
  expense: {
    currency: "EUR",
    payers: [{ personId: "ana", amount: 9000n }],
    splits: [
      { personId: "ana", amount: 3000n },
      { personId: "ben", amount: 3000n },
      { personId: "cy", amount: 3000n },
      { personId: "dee", amount: 0n },
    ],
  },
};

describe("who hears about it", () => {
  it("tells the people on an expense, not whoever added it", () => {
    expect(recipientsFor(dinner, []).sort()).toEqual(["ben", "cy"]);
  });

  it("leaves out someone who was in the group but not in the split", () => {
    expect(recipientsFor(dinner, [])).not.toContain("dee");
  });

  it("tells both sides of a payment except the one who saved it", () => {
    const paid = { ...base, type: "settlement.created", data: "{}", settlement: { fromPersonId: "ben", toPersonId: "ana", amount: 3000n, currency: "EUR" }, actorPersonId: "ben" };
    expect(recipientsFor(paid, [])).toEqual(["ana"]);
  });

  it("sends a reminder only to the person reminded", () => {
    const nudge = { ...base, type: "nudge.sent", data: "{}", targetPersonId: "ben" };
    expect(recipientsFor(nudge, ["ana", "ben", "cy"])).toEqual(["ben"]);
  });

  it("tells the creator when a repeating expense adds itself", () => {
    const rent = { ...dinner, type: "recurrence.fired" };
    expect(recipientsFor(rent, [])).toContain("ana");
  });

  it("stays quiet about things nobody needs a buzz for", () => {
    expect(recipientsFor({ ...base, type: "group.updated", data: "{}" }, ["ana", "ben"])).toEqual([]);
  });
});

describe("what the notification says", () => {
  it("says what was added and the reader's share", () => {
    const m = messageFor(dinner, "ben");
    expect(m?.title).toBe("🏝️ Lisbon");
    expect(m?.body).toContain("Ana added “Dinner”");
    expect(m?.body).toContain("Your share is €30.00");
    expect(m?.url).toBe("/groups/g1");
  });

  it("tells the person paid that they were paid", () => {
    const paid = { ...base, type: "settlement.created", data: "{}", actorPersonId: "ben", actor: { displayName: "Ben" }, settlement: { fromPersonId: "ben", toPersonId: "ana", amount: 3000n, currency: "EUR" } };
    expect(messageFor(paid, "ana")?.body).toBe("Ben paid you €30.00.");
  });

  it("uses plain words with no dashes", () => {
    for (const recipient of ["ben", "cy"]) {
      expect(messageFor(dinner, recipient)?.body).not.toMatch(/[—–]/);
    }
  });
});

describe("which notification addresses are accepted", () => {
  it("accepts the real push services", async () => {
    const { isPushServiceUrl } = await import("../push");
    expect(isPushServiceUrl("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushServiceUrl("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isPushServiceUrl("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushServiceUrl("https://wns2-by3p.notify.windows.com/w/?token=abc")).toBe(true);
  });

  it("refuses anything that would make the server call somewhere else", async () => {
    const { isPushServiceUrl } = await import("../push");
    expect(isPushServiceUrl("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushServiceUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isPushServiceUrl("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isPushServiceUrl("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isPushServiceUrl("https://localhost/x")).toBe(false);
  });
});
