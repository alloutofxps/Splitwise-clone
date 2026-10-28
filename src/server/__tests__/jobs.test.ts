import { beforeEach, describe, expect, it, vi } from "vitest";

// One JobLock table in memory, counting every write.
const table = new Map<string, { holder: string; expiresAt: Date }>();
let writes = 0;

vi.mock("@/lib/db", () => ({
  isSqlite: true,
  prisma: {
    jobLock: {
      updateMany({ where, data }: { where: { name: string; holder?: string; OR?: [{ expiresAt: { lt: Date } }, { holder: string }] }; data: { holder?: string; expiresAt: Date } }) {
        const row = table.get(where.name);
        const matches = !!row && (where.OR
          ? row.expiresAt < where.OR[0].expiresAt.lt || row.holder === where.OR[1].holder
          : row.holder === where.holder);
        if (!row || !matches) return Promise.resolve({ count: 0 });
        writes++;
        table.set(where.name, { holder: data.holder ?? row.holder, expiresAt: data.expiresAt });
        return Promise.resolve({ count: 1 });
      },
      create({ data }: { data: { name: string; holder: string; expiresAt: Date } }) {
        if (table.has(data.name)) return Promise.reject(new Error("unique"));
        writes++;
        table.set(data.name, { holder: data.holder, expiresAt: data.expiresAt });
        return Promise.resolve();
      },
    },
  },
}));
vi.mock("../rates", () => ({ refreshAllBases: () => Promise.resolve() }));
vi.mock("../recurrence", () => ({ runDueRecurrences: () => Promise.resolve(0) }));
vi.mock("../push", () => ({ sendPendingNotifications: () => Promise.resolve(0) }));

const { withJobLock } = await import("../jobs");
const MINUTE = 60_000;

beforeEach(() => {
  table.clear();
  writes = 0;
  vi.useRealTimers();
});

describe("job leases", () => {
  it("takes and releases a lease around a run by default", async () => {
    expect(await withJobLock("snapshot", 5 * MINUTE, () => Promise.resolve("ran"))).toBe("ran");
    expect(writes).toBe(2);
    expect(table.get("snapshot")!.expiresAt.getTime()).toBe(0);
  });

  it("skips the run while another process holds the lease", async () => {
    table.set("push", { holder: "someone-else", expiresAt: new Date(Date.now() + MINUTE) });
    const run = vi.fn(() => Promise.resolve("ran"));
    expect(await withJobLock("push", 5 * MINUTE, run)).toBeUndefined();
    expect(await withJobLock("push", 5 * MINUTE, run, { keep: true })).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps a frequent job's lease instead of writing on every run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T09:00:00Z"));
    // Twenty minutes of the fifteen-second notification check.
    for (let i = 0; i < 80; i++) {
      await withJobLock("push-kept", 5 * MINUTE, () => Promise.resolve(0), { keep: true });
      vi.setSystemTime(Date.now() + 15_000);
    }
    // One write to take it, then one renewal every two and a half minutes.
    expect(writes).toBeLessThanOrEqual(9);
    expect(table.get("push-kept")!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("lets another process take over once a kept lease runs out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T09:00:00Z"));
    await withJobLock("push-handover", 5 * MINUTE, () => Promise.resolve(0), { keep: true });
    // This server stops; five minutes later the lease is anyone's.
    vi.setSystemTime(Date.now() + 5 * MINUTE + 1);
    // The new server's attempt, exactly as withJobLock makes it.
    const { prisma } = await import("@/lib/db");
    const now = new Date();
    const taken = await prisma.jobLock.updateMany({
      where: { name: "push-handover", OR: [{ expiresAt: { lt: now } }, { holder: "new-server" }] },
      data: { holder: "new-server", expiresAt: new Date(now.getTime() + 5 * MINUTE) },
    });
    expect(taken.count).toBe(1);
  });
});
