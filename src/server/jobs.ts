/**
 * Background jobs, run inside the server process.
 *
 * Divvy is one Node server and one database, so the scheduler lives in the
 * server rather than in a separate cron service - started from
 * `instrumentation.ts`, which Next runs once when the server boots. Each job
 * takes a lease in the `JobLock` table before running, so a second process
 * (a rolling deploy overlapping the old one, or `next dev` restarting) never
 * runs the same job at the same moment.
 *
 * Jobs:
 *  - recurring expenses, every minute;
 *  - phone notifications for new activity, every fifteen seconds;
 *  - exchange-rate refresh, every six hours;
 *  - housekeeping (expired sign-in codes, abandoned sessions), hourly;
 *  - a database snapshot, daily, for SQLite deployments.
 *
 * Set `DIVVY_DISABLE_JOBS=1` to run a server that serves requests only.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { prisma, isSqlite } from "@/lib/db";
import { SESSION_IDLE_DAYS } from "@/lib/identity";
import { log } from "@/lib/log";
import { refreshAllBases } from "./rates";
import { runDueRecurrences } from "./recurrence";
import { sendPendingNotifications } from "./push";

const holder = `${process.pid}-${randomUUID().slice(0, 8)}`;

/**
 * Runs `fn` only if no other runner holds the named lease. Returns undefined
 * when the lease was taken, so callers can tell "skipped" from "ran".
 */
export async function withJobLock<T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  // Take an expired (or our own) lease, or create the row if there is none.
  const taken = await prisma.jobLock.updateMany({
    where: { name, OR: [{ expiresAt: { lt: now } }, { holder }] },
    data: { holder, expiresAt },
  });
  if (taken.count === 0) {
    try {
      await prisma.jobLock.create({ data: { name, holder, expiresAt } });
    } catch {
      return undefined; // Somebody else holds it.
    }
  }

  try {
    return await fn();
  } finally {
    await prisma.jobLock
      .updateMany({ where: { name, holder }, data: { expiresAt: new Date(0) } })
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------

async function housekeeping(): Promise<void> {
  const now = Date.now();
  const [links, challenges, sessions] = await prisma.$transaction([
    prisma.deviceLink.deleteMany({ where: { expiresAt: { lt: new Date(now - 86_400_000) } } }),
    prisma.webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }),
    prisma.session.deleteMany({
      where: { lastSeenAt: { lt: new Date(now - SESSION_IDLE_DAYS * 86_400_000) } },
    }),
  ]);
  if (links.count + challenges.count + sessions.count > 0) {
    log.info("housekeeping", {
      deviceLinks: links.count,
      challenges: challenges.count,
      sessions: sessions.count,
    });
  }
}

/** Where snapshots go: `DIVVY_BACKUP_DIR`, or `backups/` next to the database. */
function backupDir(): string | null {
  if (process.env.DIVVY_BACKUP_DIR) return process.env.DIVVY_BACKUP_DIR;
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) return null;
  const file = url.slice("file:".length).split("?")[0];
  // Relative SQLite paths are relative to the schema directory.
  const absolute = path.isAbsolute(file) ? file : path.resolve(process.cwd(), "prisma", file);
  return path.join(path.dirname(absolute), "backups");
}

const KEEP_SNAPSHOTS = 7;

/**
 * A consistent copy of the live database, taken without stopping writes.
 *
 * `VACUUM INTO` produces a transactionally consistent, compacted copy - unlike
 * copying the file, which can capture a half-written page. These stay on the
 * same disk as the database, so they protect against bad writes and bad
 * migrations, not against losing the disk: for that, set
 * `LITESTREAM_REPLICA_URL` (see the Dockerfile) to stream changes off-site.
 */
async function snapshotDatabase(): Promise<string | null> {
  if (!isSqlite) return null;
  const dir = backupDir();
  if (!dir) return null;

  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(dir, `divvy-${stamp}.db`);
  await prisma.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

  const snapshots = (await readdir(dir)).filter((name) => /^divvy-.*\.db$/.test(name)).sort();
  for (const old of snapshots.slice(0, Math.max(0, snapshots.length - KEEP_SNAPSHOTS))) {
    await rm(path.join(dir, old), { force: true });
  }
  log.info("database snapshot written", { file: target });
  return target;
}

// ---------------------------------------------------------------------------

interface Job {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
  /** Run once shortly after boot as well as on the interval. */
  atStart?: boolean;
}

const JOBS: Job[] = [
  { name: "recurrences", everyMs: 60_000, run: () => runDueRecurrences(), atStart: true },
  // Phone notifications for anything new, a few seconds after it happens.
  { name: "push", everyMs: 15_000, run: () => sendPendingNotifications() },
  { name: "rates", everyMs: 6 * 60 * 60_000, run: refreshAllBases },
  { name: "housekeeping", everyMs: 60 * 60_000, run: housekeeping, atStart: true },
  // Also shortly after boot, so a fresh deploy has a snapshot straight away
  // rather than a day later. The newest seven are kept, so restarts are cheap.
  { name: "snapshot", everyMs: 24 * 60 * 60_000, run: snapshotDatabase, atStart: true },
];

let started = false;

export function startScheduler(): void {
  if (started || process.env.DIVVY_DISABLE_JOBS === "1") return;
  started = true;

  for (const job of JOBS) {
    const tick = async () => {
      try {
        // The lease outlives a slow run, but never a crashed process.
        await withJobLock(job.name, Math.max(job.everyMs, 5 * 60_000), job.run);
      } catch (error) {
        log.error("background job failed", { job: job.name, error });
      }
    };
    if (job.atStart) setTimeout(() => void tick(), 5_000).unref();
    setInterval(() => void tick(), job.everyMs).unref();
  }
  log.info("scheduler started", { jobs: JOBS.map((job) => job.name) });
}
