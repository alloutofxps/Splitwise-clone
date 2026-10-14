/**
 * Server start-up for the Node runtime, loaded by `instrumentation.ts`.
 *
 * Kept in its own module so the edge build never sees the filesystem and
 * database imports the scheduler needs.
 */

import { configureDatabase } from "./lib/db";
import { log } from "./lib/log";
import { startScheduler } from "./server/jobs";

export async function startNodeServer(): Promise<void> {
  try {
    await configureDatabase();
  } catch (error) {
    log.error("database configuration failed", { error });
  }

  startScheduler();

  // Shutdown is left to `next start`'s own SIGTERM handling. Every write is a
  // single short transaction and SQLite in WAL mode is durable across a
  // process exit, so there is no half-finished state to flush; the job leases
  // expire on their own if the process dies holding one.
}
