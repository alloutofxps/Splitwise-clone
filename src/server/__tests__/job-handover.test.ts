import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * A deploy, on a real database: the old server keeps its leases, the new one
 * waits for them to run out, then takes over. Waiting is normal, so nothing
 * may be printed as an error while it does (it used to be a dozen
 * "Unique constraint failed" lines after every deploy).
 */

const folder = mkdtempSync(path.join(tmpdir(), "divvy-jobs-"));
process.env.DATABASE_URL = `file:${path.join(folder, "jobs.db")}`;

vi.mock("../rates", () => ({ refreshAllBases: () => Promise.resolve() }));
vi.mock("../recurrence", () => ({ runDueRecurrences: () => Promise.resolve(0) }));
vi.mock("../push", () => ({ sendPendingNotifications: () => Promise.resolve(0) }));

const { prisma } = await import("@/lib/db");
const oldServer = await import("../jobs");
// A second copy of the module is a second server: same database, its own name.
vi.resetModules();
const newServer = await import("../jobs");

const MINUTE = 60_000;
const printed: string[] = [];

beforeAll(async () => {
  const driver = await new PrismaBetterSqlite3({ url: path.join(folder, "jobs.db") }).connect();
  const migrations = path.join(process.cwd(), "prisma", "migrations");
  for (const name of readdirSync(migrations).filter((entry) => !entry.includes(".")).sort()) {
    await driver.executeScript(readFileSync(path.join(migrations, name, "migration.sql"), "utf8"));
  }
  await driver.dispose();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(folder, { recursive: true, force: true });
});

// Prisma prints its "prisma:error" lines with console.log, not console.error.
function capture() {
  printed.length = 0;
  const keep = (...args: unknown[]) => void printed.push(args.map(String).join(" "));
  for (const method of ["log", "info", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation(keep);
}

describe("handing jobs over after a deploy", () => {
  it("waits quietly for the old server's lease, then takes over", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T16:00:00Z"));
    capture();

    const oldRuns = vi.fn(() => Promise.resolve("old"));
    const newRuns = vi.fn(() => Promise.resolve("new"));
    expect(await oldServer.withJobLock("push", 5 * MINUTE, oldRuns, { keep: true })).toBe("old");

    // The new server checks every 15 seconds while the old lease lasts.
    for (let t = 0; t < 5 * MINUTE; t += 15_000) {
      expect(await newServer.withJobLock("push", 5 * MINUTE, newRuns, { keep: true })).toBeUndefined();
      vi.setSystemTime(Date.now() + 15_000);
    }
    expect(newRuns).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + 1);
    expect(await newServer.withJobLock("push", 5 * MINUTE, newRuns, { keep: true })).toBe("new");
    expect(newRuns).toHaveBeenCalledTimes(1);
    expect(await prisma.jobLock.findUnique({ where: { name: "push" } })).toMatchObject({
      expiresAt: new Date(Date.now() + 5 * MINUTE),
    });

    expect(printed).toEqual([]);
  });

  it("lets exactly one of two servers starting together take a new job", async () => {
    capture();
    const runs = vi.fn(() => Promise.resolve("ran"));
    const results = await Promise.all([
      oldServer.withJobLock("integrity", 5 * MINUTE, runs),
      newServer.withJobLock("integrity", 5 * MINUTE, runs),
    ]);
    expect(results.filter((result) => result === "ran")).toHaveLength(1);
    expect(runs).toHaveBeenCalledTimes(1);
    expect(printed).toEqual([]);
  });
});
