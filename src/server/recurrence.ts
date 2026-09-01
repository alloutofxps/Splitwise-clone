/**
 * Recurring expenses.
 *
 * There is no cron in a self-hosted deployment, so due recurrences are fired
 * lazily whenever anybody opens the app. That means an expense posts a little
 * late rather than never, and it posts *dated correctly* - each occurrence is
 * filed on the date it was due, not the date somebody happened to open the app,
 * so a rent that fires four days late still lands on the 1st.
 *
 * Catch-up matters too: if nobody opens the app for two months, both months'
 * rent post, each on its own date.
 */

import { prisma } from "@/lib/db";
import { createExpense, recordActivity } from "./write";
import type { RecurrenceFrequency } from "@/lib/types";

/** Never post more than this many missed occurrences for one recurrence. */
const MAX_CATCHUP = 60;

/**
 * Advances a date by one period.
 *
 * Month arithmetic clamps rather than overflowing: a recurrence anchored on the
 * 31st falls on the 30th in April and the 28th in February, instead of silently
 * skipping to March 3rd the way naive `setMonth` does.
 */
export function nextOccurrence(
  from: Date,
  frequency: RecurrenceFrequency,
  interval: number,
  anchorDay?: number | null,
): Date {
  const step = Math.max(1, interval);
  const next = new Date(from.getTime());

  switch (frequency) {
    case "DAILY":
      next.setDate(next.getDate() + step);
      return next;
    case "WEEKLY":
      next.setDate(next.getDate() + 7 * step);
      return next;
    case "BIWEEKLY":
      next.setDate(next.getDate() + 14 * step);
      return next;
    case "MONTHLY":
      return addMonths(next, step, anchorDay);
    case "QUARTERLY":
      return addMonths(next, 3 * step, anchorDay);
    case "YEARLY":
      return addMonths(next, 12 * step, anchorDay);
    default:
      next.setDate(next.getDate() + step);
      return next;
  }
}

function addMonths(date: Date, months: number, anchorDay?: number | null): Date {
  const day = anchorDay ?? date.getDate();
  const target = new Date(date.getTime());

  // Move to the 1st first, so adding a month from the 31st cannot roll over
  // into the month after next.
  target.setDate(1);
  target.setMonth(target.getMonth() + months);

  const lastDayOfMonth = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  target.setDate(Math.min(day, lastDayOfMonth));
  return target;
}

interface TemplateEntry {
  personId: string;
  amount: string;
  included?: boolean;
  weight?: number | null;
  percent?: number | null;
  adjustment?: string | null;
}

function parseTemplate(value: string): TemplateEntry[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as TemplateEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Posts every occurrence that has come due, across every recurrence.
 *
 * Safe to call concurrently: each occurrence's expense id is derived
 * deterministically from the recurrence id and the due date, so two callers
 * racing produce the same primary key and the second one is absorbed by
 * `createExpense`'s idempotency path.
 */
export async function runDueRecurrences(now = new Date()): Promise<number> {
  const due = await prisma.recurrence.findMany({
    where: { active: true, nextRunAt: { lte: now } },
  });

  let posted = 0;

  for (const recurrence of due) {
    const group = recurrence.groupId
      ? await prisma.group.findUnique({ where: { id: recurrence.groupId } })
      : null;

    let cursor = recurrence.nextRunAt;
    let iterations = 0;

    while (cursor <= now && iterations < MAX_CATCHUP) {
      if (recurrence.endsAt && cursor > recurrence.endsAt) break;

      const occurrenceId = occurrenceExpenseId(recurrence.id, cursor);
      const payers = parseTemplate(recurrence.payersJson);
      const splits = parseTemplate(recurrence.splitsJson);

      if (payers.length === 0 || splits.length === 0) {
        // A template that cannot produce a valid expense is deactivated rather
        // than retried forever on every app open.
        await prisma.recurrence.update({
          where: { id: recurrence.id },
          data: { active: false },
        });
        break;
      }

      try {
        const { created } = await createExpense({
          id: occurrenceId,
          groupId: recurrence.groupId,
          description: recurrence.description,
          notes: recurrence.notes,
          amount: recurrence.amount,
          currency: recurrence.currency,
          exchangeRate: "1",
          settlementCurrency: group?.currency ?? recurrence.currency,
          splitMode: recurrence.splitMode,
          categoryId: recurrence.categoryId,
          date: new Date(cursor.getTime()),
          createdByPersonId: recurrence.createdByPersonId,
          recurrenceId: recurrence.id,
          payers: payers.map((p) => ({ personId: p.personId, amount: BigInt(p.amount) })),
          splits: splits.map((s) => ({
            personId: s.personId,
            amount: BigInt(s.amount),
            included: s.included ?? true,
            weight: s.weight ?? null,
            percent: s.percent ?? null,
            adjustment: s.adjustment ? BigInt(s.adjustment) : null,
          })),
          items: [],
          attachments: [],
        });

        // Two tabs opening the app at once both walk the same catch-up range,
        // and the second one is absorbed by the idempotency path above. Only
        // the run that actually wrote the row gets to announce it, otherwise
        // the feed shows rent posting twice on a month it posted once.
        if (created) {
          await recordActivity({
            type: "recurrence.fired",
            actorPersonId: recurrence.createdByPersonId,
            groupId: recurrence.groupId,
            expenseId: occurrenceId,
            data: {
              description: recurrence.description,
              amount: recurrence.amount.toString(),
              currency: recurrence.currency,
            },
          });
          posted++;
        }
      } catch (error) {
        // One broken recurrence must not stop the others from posting.
        console.error("[divvy] recurrence failed to post", recurrence.id, error);
        await prisma.recurrence.update({
          where: { id: recurrence.id },
          data: { active: false },
        });
        break;
      }

      cursor = nextOccurrence(
        cursor,
        recurrence.frequency as RecurrenceFrequency,
        recurrence.interval,
        recurrence.dayOfMonth,
      );
      iterations++;
    }

    const finished = Boolean(recurrence.endsAt && cursor > recurrence.endsAt);
    await prisma.recurrence.update({
      where: { id: recurrence.id },
      data: {
        nextRunAt: cursor,
        lastRunAt: iterations > 0 ? now : recurrence.lastRunAt,
        active: finished ? false : recurrence.active,
      },
    });
  }

  return posted;
}

/**
 * Deterministic id for one occurrence.
 *
 * Uses the calendar date rather than the timestamp so two callers computing it
 * in different timezones - or a millisecond apart - still agree.
 */
export function occurrenceExpenseId(recurrenceId: string, date: Date): string {
  const day = date.toISOString().slice(0, 10);
  return `rec_${recurrenceId}_${day}`;
}
