"use client";

import type { QueryClient } from "@tanstack/react-query";
import { clear as clearOutbox, discardAllRejected } from "./outbox";
import { clearRecoveryPending, clearStashedRecoveryKey } from "./recovery";

/**
 * Removes everything this device holds about the signed-in person.
 *
 * Signing out used to clear the in-memory cache and the outbox but leave the
 * service worker's copy of every API response it had ever served - balances,
 * ledgers, friends, expenses - plus the store of rejected changes. On a shared
 * or borrowed device the next person could read all of it, offline or from
 * the browser's developer tools. This clears every cache the app owns.
 *
 * The app shell and static assets go too; they are re-fetched on the next
 * visit, which is a small price for not having to reason about which cache
 * might hold what.
 */
export async function wipeLocalData(client: QueryClient): Promise<void> {
  client.clear();
  await clearOutbox().catch(() => {});
  await discardAllRejected().catch(() => {});
  clearRecoveryPending();
  clearStashedRecoveryKey();

  if (typeof caches !== "undefined") {
    try {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith("divvy")).map((name) => caches.delete(name)),
      );
    } catch {
      // Storage disabled or partitioned: nothing was cached to begin with.
    }
  }
}
