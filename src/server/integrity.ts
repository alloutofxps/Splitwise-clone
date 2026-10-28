/**
 * The daily check of the database itself (RULES.md D1 to D4).
 *
 * The questions `scripts/db-check.mjs` asks by hand, asked every day by the
 * scheduler: each is a count that must be 0. Most are rules that span rows,
 * which the database can't enforce for itself (a bill's shares adding up to
 * its total); the single-row ones it does refuse are asked again in case a
 * rule is ever dropped. Anything found makes the health check fail
 * (server/health.ts), so the uptime monitor emails the owner, and is logged
 * with its counts. Counts only: never a name, an amount or an id.
 *
 * Repeating expenses that are overdue or stopped are left to the script: the
 * first is the stalled-job alarm's to raise, the second is somebody's setting,
 * not damage.
 */

import { prisma } from "@/lib/db";
import { log } from "@/lib/log";
import { noteIntegrity } from "./health";

/** Label (as in scripts/db-check.mjs) to a query returning one count, n. */
export const INTEGRITY_CHECKS: Record<string, string> = {
  "bills whose shares don't add up to the total (live)": `
    SELECT COUNT(*) AS n FROM Expense e WHERE e.deletedAt IS NULL
      AND e.amount != (SELECT COALESCE(SUM(s.amount), 0) FROM ExpenseSplit s WHERE s.expenseId = e.id)`,
  "bills whose shares don't add up to the total (in the bin)": `
    SELECT COUNT(*) AS n FROM Expense e WHERE e.deletedAt IS NOT NULL
      AND e.amount != (SELECT COALESCE(SUM(s.amount), 0) FROM ExpenseSplit s WHERE s.expenseId = e.id)`,
  "bills whose payers don't add up to the total (live)": `
    SELECT COUNT(*) AS n FROM Expense e WHERE e.deletedAt IS NULL
      AND e.amount != (SELECT COALESCE(SUM(p.amount), 0) FROM ExpensePayer p WHERE p.expenseId = e.id)`,
  "bills whose payers don't add up to the total (in the bin)": `
    SELECT COUNT(*) AS n FROM Expense e WHERE e.deletedAt IS NOT NULL
      AND e.amount != (SELECT COALESCE(SUM(p.amount), 0) FROM ExpensePayer p WHERE p.expenseId = e.id)`,
  "bills of zero or less": `SELECT COUNT(*) AS n FROM Expense WHERE amount <= 0`,
  "negative shares or payments toward a bill": `
    SELECT (SELECT COUNT(*) FROM ExpenseSplit WHERE amount < 0) + (SELECT COUNT(*) FROM ExpensePayer WHERE amount < 0) AS n`,
  "bills in the group's own currency with a rate other than 1": `
    SELECT COUNT(*) AS n FROM Expense e JOIN "Group" g ON g.id = e.groupId
      WHERE e.currency = g.currency AND e.exchangeRate != '1'`,
  "bills at a rate of 1 whose converted total differs": `
    SELECT COUNT(*) AS n FROM Expense WHERE exchangeRate = '1' AND convertedAmount != amount`,
  "group bills sharing with someone never in the group": `
    SELECT COUNT(*) AS n FROM ExpenseSplit s JOIN Expense e ON e.id = s.expenseId
      WHERE e.groupId IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM Membership m WHERE m.groupId = e.groupId AND m.personId = s.personId)`,
  "group bills paid by someone never in the group": `
    SELECT COUNT(*) AS n FROM ExpensePayer p JOIN Expense e ON e.id = p.expenseId
      WHERE e.groupId IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM Membership m WHERE m.groupId = e.groupId AND m.personId = p.personId)`,
  "itemised bills with no items": `
    SELECT COUNT(*) AS n FROM Expense e WHERE e.splitMode = 'ITEMIZED' AND e.deletedAt IS NULL
      AND NOT EXISTS (SELECT 1 FROM ExpenseItem i WHERE i.expenseId = e.id)`,
  "payments of zero or less": `SELECT COUNT(*) AS n FROM Settlement WHERE amount <= 0`,
  "live payments from someone to themselves": `
    SELECT COUNT(*) AS n FROM Settlement WHERE deletedAt IS NULL AND fromPersonId = toPersonId`,
  "payments at a rate of 1 whose converted total differs": `
    SELECT COUNT(*) AS n FROM Settlement WHERE exchangeRate = '1' AND convertedAmount != amount`,
  "group payments involving someone never in the group": `
    SELECT COUNT(*) AS n FROM Settlement t WHERE t.groupId IS NOT NULL AND (
      NOT EXISTS (SELECT 1 FROM Membership m WHERE m.groupId = t.groupId AND m.personId = t.fromPersonId) OR
      NOT EXISTS (SELECT 1 FROM Membership m WHERE m.groupId = t.groupId AND m.personId = t.toPersonId))`,
  "dates saved as text instead of numbers": `
    SELECT (SELECT COUNT(*) FROM Expense WHERE typeof(date) != 'integer' OR typeof(createdAt) != 'integer')
         + (SELECT COUNT(*) FROM Settlement WHERE typeof(date) != 'integer' OR typeof(createdAt) != 'integer')
         + (SELECT COUNT(*) FROM Person WHERE typeof(createdAt) != 'integer') AS n`,
};

/** Each check's count, and the file's own checks. Only the non-zero ones. */
export async function checkIntegrity(): Promise<Record<string, number>> {
  const found: Record<string, number> = {};

  const [quick] = await prisma.$queryRawUnsafe<{ quick_check: string }[]>("PRAGMA quick_check");
  if (quick?.quick_check !== "ok") found["database file damaged (quick_check)"] = 1;
  const missing = await prisma.$queryRawUnsafe<unknown[]>("PRAGMA foreign_key_check");
  if (missing.length > 0) found["rows pointing at something missing (foreign keys)"] = missing.length;

  for (const [label, sql] of Object.entries(INTEGRITY_CHECKS)) {
    const [row] = await prisma.$queryRawUnsafe<{ n: bigint | number }[]>(sql);
    const n = Number(row?.n ?? 0);
    if (n > 0) found[label] = n;
  }
  return found;
}

/** The scheduled job: check, tell the health check, and log what was found. */
export async function runIntegrityCheck(): Promise<void> {
  const found = await checkIntegrity();
  noteIntegrity(found);
  if (Object.keys(found).length > 0) log.error("daily database check found problems", { found });
  else log.info("daily database check: no problems");
}
