import { afterEach, describe, expect, it } from "vitest";
import { relatedOrigins, usableHere } from "../webauthn";

/**
 * The domain-move rules.
 *
 * These decide what the account screen tells somebody after the app changes
 * address — the moment when passkeys stop being offered and the app looks
 * broken rather than moved. Getting the message wrong is worse than showing
 * nothing, so the logic is pinned rather than eyeballed.
 */

const ORIGINAL = process.env.DIVVY_RELATED_ORIGINS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DIVVY_RELATED_ORIGINS;
  else process.env.DIVVY_RELATED_ORIGINS = ORIGINAL;
});

describe("relatedOrigins", () => {
  it("is empty when unset, rather than a list containing nothing", () => {
    delete process.env.DIVVY_RELATED_ORIGINS;
    expect(relatedOrigins()).toEqual([]);
  });

  it("splits, trims, and drops trailing slashes", () => {
    process.env.DIVVY_RELATED_ORIGINS = " https://old.example.com/ , https://new.example.com ";
    expect(relatedOrigins()).toEqual(["https://old.example.com", "https://new.example.com"]);
  });

  it("ignores empty entries from a trailing comma", () => {
    process.env.DIVVY_RELATED_ORIGINS = "https://a.example.com,,";
    expect(relatedOrigins()).toEqual(["https://a.example.com"]);
  });
});

describe("usableHere", () => {
  it("accepts a credential registered against this exact domain", () => {
    expect(usableHere("divvy.example.com", "divvy.example.com")).toBe(true);
  });

  it("rejects one registered against a different domain", () => {
    delete process.env.DIVVY_RELATED_ORIGINS;
    expect(usableHere("old.example.com", "divvy.example.com")).toBe(false);
  });

  it("accepts a different domain once it is declared related", () => {
    // This is the whole migration story: both addresses answer for a while, so
    // people sign in on the new one without being locked out of the old.
    process.env.DIVVY_RELATED_ORIGINS = "https://old.example.com";
    expect(usableHere("old.example.com", "divvy.example.com")).toBe(true);
  });

  it("matches a related origin by host, ignoring scheme and port", () => {
    process.env.DIVVY_RELATED_ORIGINS = "https://old.example.com:8443/";
    expect(usableHere("old.example.com", "divvy.example.com")).toBe(true);
  });

  it("assumes a credential with no recorded domain is fine", () => {
    // Rows written before the column existed. Claiming those are unusable
    // would put a warning on every passkey that predates this change.
    expect(usableHere(null, "divvy.example.com")).toBe(true);
  });
});
