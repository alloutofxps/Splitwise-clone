import { describe, expect, it } from "vitest";
import { isolate } from "../bidi";

describe("fencing typed text", () => {
  it("wraps it in the first strong isolate and the pop", () => {
    expect(isolate("قهوة")).toBe("⁨قهوة⁩");
  });

  it("leaves the sentence around it alone", () => {
    const line = `You added ${isolate("قهوة")} · €9,999,999.99`;
    expect(line.startsWith("You added ⁨")).toBe(true);
    expect(line.endsWith("⁩ · €9,999,999.99")).toBe(true);
  });
});
