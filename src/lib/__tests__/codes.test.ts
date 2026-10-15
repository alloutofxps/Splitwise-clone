import { describe, expect, it } from "vitest";
import { generateGhostCode, generateInviteCode, generatePersonalCode } from "../codes";
import { codeFromScan, normalizeInviteCode } from "../invite-code";

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

describe("codeFromScan", () => {
  it("takes the code out of an invite link", () => {
    expect(codeFromScan("https://divvy.up.railway.app/join/mango-tiger-42")).toBe("mango-tiger-42");
    expect(codeFromScan("https://divvy.up.railway.app/join/mango-tiger-42?x=1")).toBe("mango-tiger-42");
  });

  it("keeps a bare code as it is", () => {
    expect(codeFromScan("  mango-tiger-42 ")).toBe("mango-tiger-42");
  });

  it("never throws on a broken link", () => {
    expect(codeFromScan("https://x/join/%E0%A4%A")).toBe("%E0%A4%A");
  });
});
