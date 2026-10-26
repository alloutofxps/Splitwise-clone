/**
 * Group balance sheets, computed once per change rather than once per request.
 *
 * A balance is a fold over every expense and payment a group has ever had.
 * Doing that fold on every request meant the home screen re-read the complete
 * history of every group the viewer was in, every time it opened - fine for a
 * weekend trip, linear in history for a flat share that has run for years, and
 * repeated again by the friends list, the nudge check and settle-up.
 *
 * Each group carries a `ledgerVersion` that every balance-changing write bumps
 * in the same transaction (`bumpLedger`). A sheet is cached against the version
 * it was computed at, so a request costs one indexed lookup of the versions
 * and folds only the groups that actually moved since.
 *
 * Reading the version *before* the rows is what keeps this safe under
 * concurrency: a write landing in between bumps the version, so the next
 * request recomputes even if this one cached rows that were already newer.
 *
 * The cache is per process and bounded. A second process would hold its own
 * copy and still be correct, because every hit is validated against the
 * database's version.
 */

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { computeBalances, type BalanceEvent, type BalanceSheet } from "@/lib/balances";
import { convertedBreakdown } from "@/lib/split";

type Client = PrismaClient | Prisma.TransactionClient;

const MAX_CACHED = 5_000;
const cache = new Map<string, { version: number; sheet: BalanceSheet }>();

function remember(groupId: string, version: number, sheet: BalanceSheet): void {
  cache.delete(groupId);
  cache.set(groupId, { version, sheet });
  if (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/**
 * Marks groups' balances as changed. Call inside the same transaction as the
 * write, so a reader can never see the new rows under the old version.
 */
export async function bumpLedger(
  client: Client,
  groupIds: Iterable<string | null | undefined>,
): Promise<void> {
  const ids = [...new Set([...groupIds].filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  await client.group.updateMany({
    where: { id: { in: ids } },
    data: { ledgerVersion: { increment: 1 } },
  });
}

/** The same bump, as a query to put in a batch `$transaction([...])`. */
export function bumpLedgerQuery(groupIds: Iterable<string | null | undefined>) {
  const ids = [...new Set([...groupIds].filter((id): id is string => Boolean(id)))];
  return prisma.group.updateMany({
    where: { id: { in: ids.length > 0 ? ids : ["__none__"] } },
    data: { ledgerVersion: { increment: 1 } },
  });
}

/** Folds rows into sheets for several groups with two queries in total. */
async function computeSheets(groupIds: string[]): Promise<Map<string, BalanceSheet>> {
  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: { groupId: { in: groupIds }, deletedAt: null },
      select: {
        id: true,
        groupId: true,
        convertedAmount: true,
        payers: { select: { personId: true, amount: true } },
        splits: { select: { personId: true, amount: true } },
      },
    }),
    prisma.settlement.findMany({
      where: { groupId: { in: groupIds }, deletedAt: null },
      select: {
        id: true,
        groupId: true,
        fromPersonId: true,
        toPersonId: true,
        convertedAmount: true,
      },
    }),
  ]);

  const events = new Map<string, BalanceEvent[]>(groupIds.map((id) => [id, []]));
  for (const expense of expenses) {
    const { paid, owed } = convertedBreakdown(expense);
    events.get(expense.groupId!)?.push({ kind: "expense", id: expense.id, paid, owed });
  }
  for (const settlement of settlements) {
    events.get(settlement.groupId!)?.push({
      kind: "settlement",
      id: settlement.id,
      fromPersonId: settlement.fromPersonId,
      toPersonId: settlement.toPersonId,
      amount: settlement.convertedAmount,
    });
  }

  return new Map([...events].map(([id, list]) => [id, computeBalances(list)]));
}

/**
 * Balance sheets for several groups, from the cache where it is current.
 * Groups that do not exist are absent from the result.
 */
export async function groupSheets(groupIds: string[]): Promise<Map<string, BalanceSheet>> {
  const unique = [...new Set(groupIds)];
  if (unique.length === 0) return new Map();

  const versions = await prisma.group.findMany({
    where: { id: { in: unique } },
    select: { id: true, ledgerVersion: true },
  });

  const result = new Map<string, BalanceSheet>();
  const stale: { id: string; version: number }[] = [];
  for (const { id, ledgerVersion } of versions) {
    const hit = cache.get(id);
    if (hit && hit.version === ledgerVersion) result.set(id, hit.sheet);
    else stale.push({ id, version: ledgerVersion });
  }

  if (stale.length > 0) {
    const computed = await computeSheets(stale.map((entry) => entry.id));
    for (const { id, version } of stale) {
      const sheet = computed.get(id)!;
      remember(id, version, sheet);
      result.set(id, sheet);
    }
  }

  return result;
}

/** Test hook. */
export function clearLedgerCache(): void {
  cache.clear();
}
