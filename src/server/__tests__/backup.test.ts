import { describe, expect, it } from "vitest";
import { ASK_ACCOUNTS_MADE_BEFORE, backupUnconfirmed } from "../backup";

const madeAt = new Date("2026-10-01T12:00:00Z");
const key = (extra = {}) => ({ kind: "recovery", createdAt: new Date(madeAt.getTime() + 5), lastUsedAt: null, ...extra });

describe("backupUnconfirmed", () => {
  it("asks an older account still on the key it was made with", () => {
    expect(backupUnconfirmed(madeAt, [key()])).toBe(true);
  });

  it("doesn't ask someone with a passkey", () => {
    expect(backupUnconfirmed(madeAt, [key(), { kind: "passkey", createdAt: madeAt, lastUsedAt: null }])).toBe(false);
  });

  it("doesn't ask someone who has replaced their key", () => {
    expect(backupUnconfirmed(madeAt, [key({ createdAt: new Date(madeAt.getTime() + 86_400_000) })])).toBe(false);
  });

  it("doesn't ask someone who has signed in with their key", () => {
    expect(backupUnconfirmed(madeAt, [key({ lastUsedAt: new Date("2026-10-02T12:00:00Z") })])).toBe(false);
  });

  it("asks someone with no way back in at all", () => {
    expect(backupUnconfirmed(madeAt, [])).toBe(true);
  });

  it("never asks an account made since the fix", () => {
    const since = new Date(ASK_ACCOUNTS_MADE_BEFORE.getTime() + 1);
    expect(backupUnconfirmed(since, [])).toBe(false);
  });
});
