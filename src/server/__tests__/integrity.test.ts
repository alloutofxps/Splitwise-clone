import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
const { INTEGRITY_CHECKS } = await import("../integrity");

describe("the daily database check", () => {
  it("asks the same questions, by the same names, as the by-hand script", () => {
    const script = readFileSync(path.join(process.cwd(), "scripts", "db-check.mjs"), "utf8");
    for (const label of Object.keys(INTEGRITY_CHECKS)) expect(script).toContain(`"${label}"`);
  });

  it("only ever counts", () => {
    for (const sql of Object.values(INTEGRITY_CHECKS)) {
      expect(sql.trim()).toMatch(/^SELECT /);
      expect(sql).toMatch(/AS n\b/);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
    }
  });
});
