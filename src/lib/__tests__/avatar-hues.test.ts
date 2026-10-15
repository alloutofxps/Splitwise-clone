import { describe, expect, it } from "vitest";
import { AVATAR_COLORS, hueVar, normalizeColor, resolveHues } from "../avatar";

describe("person hues", () => {
  it("moves every old colour name to one of the ten new hues", () => {
    for (const old of ["iris", "fuchsia", "rose", "orange", "lime", "cyan", "sky"]) {
      expect(AVATAR_COLORS).toContain(normalizeColor(old));
    }
    expect(normalizeColor("teal")).toBe("teal");
    expect(normalizeColor(undefined)).toBe("cobalt");
    expect(normalizeColor("nonsense")).toBe("cobalt");
  });

  it("gives a CSS variable for any stored name", () => {
    expect(hueVar("azure")).toBe("var(--person-azure)");
    expect(hueVar("sky")).toBe("var(--person-cobalt)");
  });

  it("keeps everyone's own hue when nobody clashes", () => {
    const hues = resolveHues([
      { id: "a", avatarColor: "azure" },
      { id: "b", avatarColor: "coral" },
    ]);
    expect(hues.get("a")).toBe("azure");
    expect(hues.get("b")).toBe("coral");
  });

  it("shows a later member with the same hue in a free one, in this group only", () => {
    const hues = resolveHues([
      { id: "a", avatarColor: "azure" },
      { id: "b", avatarColor: "azure" },
      { id: "c", avatarColor: "azure" },
    ]);
    expect(hues.get("a")).toBe("azure");
    expect(new Set(hues.values()).size).toBe(3);
  });

  it("repeats hues only once all ten are used", () => {
    const members = Array.from({ length: 12 }, (_, i) => ({ id: String(i), avatarColor: "teal" }));
    const hues = resolveHues(members);
    expect(new Set([...hues.values()].slice(0, 10)).size).toBe(10);
  });
});
