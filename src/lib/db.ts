import { PrismaClient } from "@prisma/client";

/**
 * A single Prisma client per process. Next.js hot-reloads modules in
 * development, which would otherwise open a new connection pool on every edit
 * until SQLite starts refusing them.
 *
 * ### SQLite under load
 *
 * SQLite allows one writer at a time. With Prisma's default pool of several
 * connections, simultaneous saves each took a connection and then fought over
 * the file lock: measured, 31 of 50 concurrent "save expense" requests failed
 * with socket and transaction timeouts.
 *
 * So for a `file:` database the pool is pinned to **one** connection. Writes
 * then queue inside Prisma - in order, without lock contention - rather than
 * colliding inside SQLite, and each finishes in milliseconds. WAL mode (set in
 * `configureDatabase`) lets backups and the migration runner read while the
 * app writes. A Postgres `DATABASE_URL` is left exactly as given.
 */
function databaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith("file:")) return url;

  const [base, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  if (!params.has("connection_limit")) params.set("connection_limit", "1");
  // How long a queued query may wait for the one connection. Generous: under
  // a burst the queue is the point, and giving up early just turns a slow save
  // into a failed one.
  if (!params.has("pool_timeout")) params.set("pool_timeout", "30");
  if (!params.has("socket_timeout")) params.set("socket_timeout", "30");
  return `${base}?${params.toString()}`;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: databaseUrl(),
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
