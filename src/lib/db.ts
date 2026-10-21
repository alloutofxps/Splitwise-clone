import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { databaseFile } from "../../prisma/database-url";
import { oneAtATime } from "@/lib/one-at-a-time";

/**
 * A single Prisma client per process. Next.js hot-reloads modules in
 * development, which would otherwise open a new connection on every edit
 * until SQLite starts refusing them.
 *
 * ### SQLite under load
 *
 * SQLite allows one writer at a time. With Prisma 6's default pool of several
 * connections, simultaneous saves each took a connection and then fought over
 * the file lock: measured, 31 of 50 concurrent "save expense" requests failed
 * with socket and transaction timeouts.
 *
 * So there is **one** connection, and everything takes turns on it
 * (`oneAtATime`). Writes queue in order, without lock contention, and each
 * finishes in milliseconds. WAL mode (set in `configureDatabase`) lets backups
 * and the migration runner read while the app writes.
 *
 * ### Dates
 *
 * Prisma 6 stored every date as a number of milliseconds. The SQLite driver
 * Prisma 7 uses would store new ones as text, leaving one table with two
 * formats that sort and compare wrongly against each other, and a database an
 * older build could no longer read. `unixepoch-ms` keeps the existing format.
 */
const sqlite = {
  provider: "sqlite" as const,
  adapterName: "@prisma/adapter-better-sqlite3",
  // Opened on the first query rather than at import, so building the app
  // (the Docker image's build stage has no database) never needs one.
  async connect() {
    const url = process.env.DATABASE_URL;
    if (!url?.startsWith("file:")) {
      throw new Error("DATABASE_URL must be a SQLite file: address, such as file:./dev.db");
    }
    const driver = new PrismaBetterSqlite3(
      // How long to wait if something outside this process (the migration
      // runner, litestream's checkpoint) holds the file's lock.
      { url: databaseFile(url), timeout: 10_000 },
      { timestampFormat: "unixepoch-ms" },
    );
    return oneAtATime(await driver.connect());
  },
};

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: sqlite,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    transactionOptions: {
      // With one connection, a transaction waits its turn behind other
      // queries. The default 2s wait turned a busy moment into errors.
      maxWait: 20_000,
      timeout: 20_000,
    },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export const isSqlite = (process.env.DATABASE_URL ?? "file:").startsWith("file:");

let configured: Promise<void> | null = null;

/**
 * One-time SQLite tuning, run at server start (`instrumentation.ts`).
 *
 * - `journal_mode=WAL`: readers never block the writer and vice versa, which
 *   is what lets a backup or a litestream replica read a live database. It is
 *   persistent - stored in the file - so this only changes anything once.
 * - `busy_timeout`: if something outside this process (the migration runner,
 *   litestream's checkpoint) holds the lock, wait for it instead of failing.
 * - `synchronous=NORMAL`: the recommended pairing with WAL; durable across an
 *   application crash, and avoids a disk flush on every commit.
 * - `foreign_keys=ON`: Prisma relies on it for cascades.
 */
export function configureDatabase(): Promise<void> {
  if (!isSqlite) return Promise.resolve();
  configured ??= (async () => {
    await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 10000;");
    await prisma.$queryRawUnsafe("PRAGMA synchronous = NORMAL;");
    await prisma.$queryRawUnsafe("PRAGMA foreign_keys = ON;");
  })().catch((error: unknown) => {
    configured = null;
    throw error;
  });
  return configured;
}
