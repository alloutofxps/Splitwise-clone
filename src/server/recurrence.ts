/**
 * Recurring expenses.
 *
 * Due occurrences are posted by a background job (`server/jobs.ts`) every
 * minute, and each is filed *dated correctly* - on the date it was due, not
 * the date the job happened to run - so a rent that posts late still lands on
 * the 1st. They used to be posted inside whichever home-screen request came
 * first, for every customer at once, which made each person's page load pay
 * for everybody's schedule.
 *
 * What changed, and why:
 *
 * - **Currency.** An occurrence was converted at a rate of exactly 1, so a
 *   10,000 JPY recurrence in a USD group posted as 10,000 USD. A recurrence
 *   now has to be in its group's currency (checked when it is created), and
 *   one that somehow is not is paused instead of posted.
 * - **Membership.** The template is frozen at creation, and kept charging
 *   people who had since left the group. An occurrence that names somebody
 *   no longer in the group now pauses the recurrence and says why.
 * - **Failures.** Any error - including a momentary "database busy" -
 *   switched a recurrence off for good, silently. Only a permanent problem
 *   pauses one now, with the reason shown in the group; a temporary one is
 *   simply retried on the next run.
 * - **Time zones.** Dates are worked out in the creator's own zone, so "the
 *   1st" is their 1st.
 * - **Races.** The schedule is advanced only if nobody else advanced it first,
 *   so two runs can never wind it backwards or double up.
 */

import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { log } from "@/lib/log";
import { daysInMonth, fromWallClock, wallClock } from "@/lib/zoned";
import { createExpense, recordActivity } from "./write";
import type { RecurrenceFrequency } from "@/lib/types";
import type { Recurrence } from "@prisma/client";

/** Occurrences one recurrence may post in a single run; the rest wait a minute. */
const MAX_PER_RUN = 31;

/** The most occurrences creating a recurrence may post at once by back-dating it. */
export const MAX_CATCHUP_ON_CREATE = 62;

/**
 * Advances a date by one period.
 *
 * Month arithmetic clamps rather than overflowing: a recurrence anchored on the
 * 31st falls on the 30th in April and the 28th in February, instead of silently
 * skipping to March 3rd the way naive `setMonth` does.
 *
 * With a `timeZone`, the arithmetic is done on the wall clock in that zone.
 * Without one it uses the runtime's local zone, which is what the original
 * recurrences (stored before zones were recorded, and treated as UTC) need.
 */
export function nextOccurrence(
  from: Date,
  frequency: RecurrenceFrequency,
  interval: number,
  anchorDay?: number | null,
  timeZone?: string,
): Date {
  const step = Math.max(1, interval);
  if (timeZone) return nextInZone(from, frequency, step, anchorDay, timeZone);

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

  const lastDayOfMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDayOfMonth));
  return target;
}

function nextInZone(
  from: Date,
  frequency: RecurrenceFrequency,
  step: number,
  anchorDay: number | null | undefined,
  timeZone: string,
): Date {
  const clock = wallClock(from, timeZone);

  const addDays = (days: number) => {
    const moved = new Date(Date.UTC(clock.year, clock.month - 1, clock.day + days));
    return fromWallClock(
      {
        ...clock,
        year: moved.getUTCFullYear(),
        month: moved.getUTCMonth() + 1,
        day: moved.getUTCDate(),
      },
      timeZone,
    );
  };

  const addMonthsInZone = (months: number) => {
    const total = clock.year * 12 + (clock.month - 1) + months;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    const day = Math.min(anchorDay ?? clock.day, daysInMonth(year, month));
    return fromWallClock({ ...clock, year, month, day }, timeZone);
  };

  switch (frequency) {
    case "WEEKLY":
      return addDays(7 * step);
    case "BIWEEKLY":
      return addDays(14 * step);
    case "MONTHLY":
      return addMonthsInZone(step);
    case "QUARTERLY":
      return addMonthsInZone(3 * step);
    case "YEARLY":
      return addMonthsInZone(12 * step);
    case "DAILY":
    default:
      return addDays(step);
  }
}

/** How many occurrences fall between `start` and `until`, inclusive, capped. */
export function countOccurrences(
  start: Date,
  until: Date,
  frequency: RecurrenceFrequency,
  interval: number,
  anchorDay: number | null,
  timeZone: string,
  cap: number,
): number {
  let count = 0;
  let cursor = start;
  while (cursor <= until && count <= cap) {
    count++;
    cursor = nextOccurrence(cursor, frequency, interval, anchorDay, timeZone);
  }
  return count;
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

/** A problem that will not fix itself by trying again. */
function isPermanent(error: unknown): boolean {
  return (
    error instanceof ValidationError ||
    error instanceof ForbiddenError ||
    error instanceof ConflictError
  );
}

/** Switches a recurrence off and tells its group why. */
async function pause(recurrence: Recurrence, reason: string): Promise<void> {
  await prisma.recurrence.updateMany({
    where: { id: recurrence.id, active: true },
    data: { active: false, lastError: reason },
  });
  await recordActivity({
    type: "recurrence.paused",
    actorPersonId: recurrence.createdByPersonId,
    groupId: recurrence.groupId,
    data: { description: recurrence.description, reason },
  }).catch(() => {});
  log.info("recurrence paused", { recurrenceId: recurrence.id, reason });
}

/**
 * Why this recurrence cannot post right now, or null when it can.
 *
 * Checked against the world as it is when the occurrence falls due, not as it
 * was when the recurrence was created.
 */
async function blocker(recurrence: Recurrence, personIds: string[]): Promise<string | null> {
  if (recurrence.groupId) {
    const group = await prisma.group.findUnique({
      where: { id: recurrence.groupId },
      select: { currency: true },
    });
    if (!group) return "its group no longer exists";
    if (group.currency !== recurrence.currency) {
      return `it is in ${recurrence.currency} but the group uses ${group.currency}`;
    }
    const active = await prisma.membership.findMany({
      where: { groupId: recurrence.groupId, personId: { in: personIds }, leftAt: null },
      select: { personId: true },
    });
    if (active.length !== personIds.length) {
      const present = new Set(active.map((row) => row.personId));
      const missing = personIds.filter((id) => !present.has(id));
      const people = await prisma.person.findMany({
        where: { id: { in: missing } },
        select: { displayName: true },
      });
      const names = people.map((person) => person.displayName).join(", ") || "somebody";
      return `${names} left the group. Change the split and turn it back on.`;
    }
    return null;
  }

  const others = personIds.filter((id) => id !== recurrence.createdByPersonId);
  if (others.length === 0) return null;
  const friendships = await prisma.friendship.count({
    where: {
      OR: others.flatMap((id) => [
        { personAId: recurrence.createdByPersonId, personBId: id },
        { personAId: id, personBId: recurrence.createdByPersonId },
      ]),
    },
  });
  return friendships === others.length ? null : "someone in it is no longer your friend";
}

/** Posts what is due for one recurrence. Returns how many occurrences it filed. */
async function processRecurrence(recurrence: Recurrence, now: Date): Promise<number> {
  const payers = parseTemplate(recurrence.payersJson);
  const splits = parseTemplate(recurrence.splitsJson);
  if (payers.length === 0 || splits.length === 0) {
    await pause(recurrence, "its split couldn't be read");
    return 0;
  }

  const personIds = [
    ...new Set([
      ...payers.map((p) => p.personId),
      ...splits.filter((s) => BigInt(s.amount || "0") !== 0n).map((s) => s.personId),
    ]),
  ];
  const reason = await blocker(recurrence, personIds);
  if (reason) {
    await pause(recurrence, reason);
    return 0;
  }

  const timeZone = recurrence.timeZone || "UTC";
  let cursor = recurrence.nextRunAt;
  let posted = 0;
  let iterations = 0;
  let finished = false;

  while (cursor <= now && iterations < MAX_PER_RUN) {
    if (recurrence.endsAt && cursor > recurrence.endsAt) {
      finished = true;
      break;
    }

    try {
      const { created } = await createExpense({
        id: occurrenceExpenseId(recurrence.id, cursor),
        groupId: recurrence.groupId,
        description: recurrence.description,
        notes: recurrence.notes,
        amount: recurrence.amount,
        currency: recurrence.currency,
        exchangeRate: "1",
        settlementCurrency: recurrence.currency,
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

      // Only the run that actually wrote the row announces it.
      if (created) {
        await recordActivity({
          type: "recurrence.fired",
          actorPersonId: recurrence.createdByPersonId,
          groupId: recurrence.groupId,
          expenseId: occurrenceExpenseId(recurrence.id, cursor),
          data: {
            description: recurrence.description,
            amount: recurrence.amount.toString(),
            currency: recurrence.currency,
          },
        });
        posted++;
      }
    } catch (error) {
      if (isPermanent(error)) {
        await pause(recurrence, error instanceof Error ? error.message : "it couldn't be added");
        return posted;
      }
      // Busy database, network blip: leave the schedule where this occurrence
      // is, and the next run picks it up.
      log.warn("recurrence will retry", { recurrenceId: recurrence.id, error });
      break;
    }

    cursor = nextOccurrence(
      cursor,
      recurrence.frequency as RecurrenceFrequency,
      recurrence.interval,
      recurrence.dayOfMonth,
      timeZone,
    );
    iterations++;
  }

  if (recurrence.endsAt && cursor > recurrence.endsAt) finished = true;

  if (iterations > 0 || finished) {
    // Conditioned on the schedule still being where this run found it, so a
    // second runner that got there first is never rolled back.
    await prisma.recurrence.updateMany({
      where: { id: recurrence.id, nextRunAt: recurrence.nextRunAt },
      data: {
        nextRunAt: cursor,
        lastRunAt: iterations > 0 ? now : recurrence.lastRunAt,
        active: finished ? false : recurrence.active,
        lastError: null,
      },
    });
  }

  return posted;
}

export interface RunScope {
  /** Only recurrences this person can see: their groups, and their own direct ones. */
  personId?: string;
}

/**
 * Posts every occurrence that has come due.
 *
 * Without a scope this is the scheduler's job and covers everyone. With one,
 * it is a person asking for their own recurrences to be brought up to date -
 * it never touches anybody else's.
 *
 * Safe to call concurrently: each occurrence's expense id is derived from the
 * recurrence and the due date, so two callers racing produce the same primary
 * key and the second is absorbed by `createExpense`'s idempotency path.
 */
export async function runDueRecurrences(now = new Date(), scope: RunScope = {}): Promise<number> {
  let where: Record<string, unknown> = { active: true, nextRunAt: { lte: now } };

  if (scope.personId) {
    const memberships = await prisma.membership.findMany({
      where: { personId: scope.personId, leftAt: null },
      select: { groupId: true },
    });
    where = {
      ...where,
      OR: [
        { groupId: { in: memberships.map((m) => m.groupId) } },
        { groupId: null, createdByPersonId: scope.personId },
      ],
    };
  }

  const due = await prisma.recurrence.findMany({
    where,
    orderBy: { nextRunAt: "asc" },
    take: 500,
  });

  let posted = 0;
  for (const recurrence of due) {
    try {
      posted += await processRecurrence(recurrence, now);
    } catch (error) {
      // One broken recurrence must not stop the others from posting.
      log.error("recurrence run failed", { recurrenceId: recurrence.id, error });
    }
  }
  return posted;
}

/**
 * Deterministic id for one occurrence.
 *
 * Uses the calendar date rather than the timestamp so two callers computing it
 * a millisecond apart still agree.
 */
export function occurrenceExpenseId(recurrenceId: string, date: Date): string {
  const day = date.toISOString().slice(0, 10);
  return `rec_${recurrenceId}_${day}`;
}
