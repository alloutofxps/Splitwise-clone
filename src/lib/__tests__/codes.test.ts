import { describe, expect, it } from "vitest";
import { generateGhostCode, generateInviteCode, generatePersonalCode, generateSignInCode } from "../codes";
import { codeFromText, formatSignInCode, inviteCodeIn, inviteMessage, normalizeInviteCode, normalizeSignInCode, signInCodeIn } from "../invite-code";

describe("codes", () => {
  it("invite codes are readable words with an unguessable tail", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode();
      expect(code).toMatch(/^[a-z]+-[a-z]+-\d{2}-[2-9a-km-z]{4}$/);
      // What a person types back must reach the same code.
      expect(normalizeInviteCode(code.toUpperCase().replace(/-/g, " "))).toBe(code);
    }
  });

  it("personal codes are not just one of 2,976 word pairs", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const code = generatePersonalCode();
      expect(code).toMatch(/^me-[a-z]+-[a-z]+-[2-9a-km-z]{6}$/);
      seen.add(code);
    }
    expect(seen.size).toBe(500);
  });

  it("placeholder codes are random and never collide with a typed code", () => {
    const a = generateGhostCode();
    const b = generateGhostCode();
    expect(a).toMatch(/^ghost-/);
    expect(a).not.toBe(b);
  });
});

describe("sign-in codes", () => {
  it("are eight easy-to-read characters", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = generateSignInCode();
      expect(code).toMatch(/^[2-9a-kmnp-z]{8}$/);
      seen.add(code);
    }
    expect(seen.size).toBe(200);
  });

  it("read the same however they're typed", () => {
    for (const typed of ["k7fq-m2xp", "K7FQ-M2XP", " k7fq m2xp ", "k7fqm2xp"]) {
      expect(normalizeSignInCode(typed)).toBe("k7fqm2xp");
    }
  });

  it("leave a long code from before alone", () => {
    expect(normalizeSignInCode(" dvy_AbC-d_1 ")).toBe("dvy_AbC-d_1");
  });

  it("show in two parts", () => {
    expect(formatSignInCode("k7fqm2xp")).toBe("k7fq-m2xp");
  });

  it("come out of a whole link", () => {
    expect(signInCodeIn("https://divvy.up.railway.app/link/k7fqm2xp")).toBe("k7fqm2xp");
    expect(signInCodeIn("K7FQ-M2XP")).toBe("k7fqm2xp");
  });
});

describe("codeFromText", () => {
  it("takes the code out of an invite link", () => {
    expect(codeFromText("https://divvy.up.railway.app/join/mango-tiger-42")).toBe("mango-tiger-42");
    expect(codeFromText("https://divvy.up.railway.app/join/mango-tiger-42?x=1")).toBe("mango-tiger-42");
  });

  it("keeps a bare code as it is", () => {
    expect(codeFromText("  mango-tiger-42 ")).toBe("mango-tiger-42");
  });

  it("never throws on a broken link", () => {
    expect(codeFromText("https://x/join/%E0%A4%A")).toBe("%E0%A4%A");
  });

  it("leaves a code alone while it's being typed", () => {
    for (const typing of ["mango", "mango-tiger", "mango-tiger-", "mango-tiger-42-", "mango tiger 42"]) {
      expect(codeFromText(typing)).toBe(typing);
    }
    expect(codeFromText("mango-tiger-42-k")).toBe("mango-tiger-42-k");
  });
});

describe("inviteCodeIn", () => {
  const url = "https://divvy.up.railway.app/join/bright-canyon-51-mqk4";

  it("finds the code in the message Divvy shares", () => {
    const message = inviteMessage('Join "Lisbon 2026" on Divvy so we can split costs.', url, "bright-canyon-51-mqk4");
    expect(inviteCodeIn(message)).toBe("bright-canyon-51-mqk4");
  });

  it("finds a person's code in their message", () => {
    const code = "me-calm-otter-x7k2pq";
    const message = inviteMessage("Add me on Divvy to split expenses.", `https://divvy.up.railway.app/join/${code}`, code);
    expect(inviteCodeIn(message)).toBe(code);
  });

  it("finds the code in a message from before the wording changed", () => {
    expect(inviteCodeIn(`Join "Flat" on Divvy so we can split costs.\n\nCode: bright-canyon-51-mqk4\n${url}`)).toBe("bright-canyon-51-mqk4");
    expect(inviteCodeIn("Code: BRIGHT-CANYON-51-MQK4")).toBe("BRIGHT-CANYON-51-MQK4");
  });

  it("finds the code without a link", () => {
    expect(inviteCodeIn("Already have Divvy? Open it, tap Join and enter this code.\nbright-canyon-51-mqk4")).toBe("bright-canyon-51-mqk4");
  });

  it("isn't fooled by a group's name", () => {
    const message = inviteMessage('Join "see /join/wrong-code-11 or fair-otter-12" on Divvy.', url, "bright-canyon-51-mqk4");
    expect(inviteCodeIn(message)).toBe("bright-canyon-51-mqk4");
  });

  it("copes with a link that has picked up punctuation", () => {
    expect(normalizeInviteCode(inviteCodeIn(`Here you go: ${url}.`) ?? "")).toBe("bright-canyon-51-mqk4");
  });

  it("finds nothing in anything else", () => {
    for (const text of ["", "hello there", "dvy_Abc-def_123", "my password", "well-known-fact", "see you at 7"]) {
      expect(inviteCodeIn(text)).toBeNull();
    }
  });
});
