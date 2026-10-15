import { z } from "zod";
import { currencyCode, dateInput, json, minorUnits, readBody, route, text } from "@/lib/api";
import { requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { SPLIT_MODES } from "@/lib/split";
import { RECURRENCE_FREQUENCIES } from "@/lib/types";
import { CATEGORY_BY_ID, DEFAULT_CATEGORY_ID } from "@/lib/categories";
import { isValidTimeZone, wallClock } from "@/lib/zoned";
import { assertCanInvolve, requireGroupAccess } from "@/server/access";
import { recurrenceDto } from "@/server/recurrence-dto";
import { countOccurrences, MAX_CATCHUP_ON_CREATE } from "@/server/recurrence";
import { limitByAccount, WRITE } from "@/server/rate-limit";

const entrySchema = z.object({
  personId: z.string().min(1).max(80),
  amount: minorUnits("An amount"),
  included: z.boolean().optional(),
  weight: z.number().finite().nonnegative().max(1_000_000).nullable().optional(),
  percent: z.number().finite().min(0).max(100).nullable().optional(),
  adjustment: minorUnits("An adjustment").nullable().optional(),
});

const schema = z.object({
  groupId: z.string().max(80).nullable().optional(),
  description: text(140, "The description").refine((v) => v.length > 0, "Give it a description."),
  amount: minorUnits("The amount"),
  currency: currencyCode,
  categoryId: z.string().max(40).nullable().optional(),
  splitMode: z.enum(SPLIT_MODES).default("EQUAL"),
  notes: text(2000, "The note").nullable().optional(),
  payers: z.array(entrySchema).min(1).max(100),
  splits: z.array(entrySchema).min(1).max(100),
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  interval: z.number().int().min(1).max(52).default(1),
  startDate: dateInput,
  endsAt: dateInput.nullable().optional(),
  /** The creator's IANA zone, so "the 1st" is their 1st. */
  timeZone: z.string().max(64).optional(),
});

const DAY = 86_400_000;
/** How far back a recurrence may start. Catching up beyond that is a typo. */
const MAX_PAST_DAYS = 366;
/** How far ahead it may start. */
const MAX_FUTURE_DAYS = 5 * 366;

export const GET = route(async (request: Request) => {
  const session = await requireSession();
  const url = new URL(request.url);
  const groupId = url.searchParams.get("groupId");

  const memberships = await prisma.membership.findMany({
    where: { personId: session.person.id, leftAt: null },
    select: { groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);

  const recurrences = await prisma.recurrence.findMany({
    where: groupId
      ? { groupId: groupIds.includes(groupId) ? groupId : "__denied__" }
      : {
          OR: [
            { groupId: { in: groupIds } },
            { groupId: null, createdByPersonId: session.person.id },
          ],
        },
    orderBy: { nextRunAt: "asc" },
  });

  return json({ recurrences: recurrences.map(recurrenceDto) });
});

/**
 * Creates a repeating expense.
 *
 * The split is frozen as a template at creation time rather than recomputed on
 * each firing. If somebody moves out, the recurrence pauses itself and says so
 * rather than silently re-splitting the rent behind anybody's back - or, as it
 * used to, carrying on charging the person who left.
 */
export const POST = route(async (request: Request) => {
  const session = await requireSession();
  limitByAccount(session.person.id, "recurrence-write", WRITE);
  const input = await readBody(request, schema);

  if (input.groupId) {
    const { group } = await requireGroupAccess(input.groupId, session.person.id);
    // Occurrences are filed in the group's own currency. A different one was
    // converted at a rate of exactly 1 - 10,000 JPY became 10,000 USD - and
    // there is no single rate that is right for every future month anyway.
    if (input.currency !== group.currency) {
      throw new ValidationError(
        `Repeating expenses in this group have to be in ${group.currency}, the group's currency.`,
      );
    }
  }

  const involved = [
    ...input.payers.map((p) => p.personId),
    ...input.splits.filter((s) => s.amount !== 0n || s.included !== false).map((s) => s.personId),
  ];
  await assertCanInvolve(involved, session.person.id, input.groupId ?? null);

  const errors: string[] = [];
  if (input.amount <= 0n) errors.push("The amount has to be more than zero.");
  const paid = input.payers.reduce((total, p) => total + p.amount, 0n);
  const owed = input.splits.reduce((total, s) => total + s.amount, 0n);
  if (paid !== input.amount || owed !== input.amount) {
    errors.push("The payers and the split both have to add up to the total.");
  }
  if (input.payers.some((p) => p.amount < 0n) || input.splits.some((s) => s.amount < 0n)) {
    errors.push("Amounts can't be below zero.");
  }
  if (new Set(input.payers.map((p) => p.personId)).size !== input.payers.length) {
    errors.push("The same person is listed as paying twice.");
  }
  if (new Set(input.splits.map((s) => s.personId)).size !== input.splits.length) {
    errors.push("The same person is listed in the split twice.");
  }

  const timeZone = input.timeZone && isValidTimeZone(input.timeZone) ? input.timeZone : "UTC";
  const now = Date.now();
  const startDate = input.startDate;
  if (startDate.getTime() < now - MAX_PAST_DAYS * DAY) {
    errors.push("A repeating expense can start at most a year in the past.");
  }
  if (startDate.getTime() > now + MAX_FUTURE_DAYS * DAY) {
    errors.push("A repeating expense has to start within the next five years.");
  }
  if (input.endsAt && input.endsAt < startDate) {
    errors.push("It can't end before it starts.");
  }
  if (errors.length > 0) throw new ValidationError(errors);

  const anchorsToDay =
    input.frequency === "MONTHLY" || input.frequency === "QUARTERLY" || input.frequency === "YEARLY";
  const dayOfMonth = anchorsToDay ? wallClock(startDate, timeZone).day : null;

  // A start date in the past posts every occurrence since. That is the point -
  // "rent since March" - but a daily expense back-dated a year would bury the
  // group in hundreds of rows, so the catch-up is bounded up front.
  const backlog = countOccurrences(
    startDate,
    new Date(Math.min(now, input.endsAt?.getTime() ?? now)),
    input.frequency,
    input.interval,
    dayOfMonth,
    timeZone,
    MAX_CATCHUP_ON_CREATE,
  );
  if (backlog > MAX_CATCHUP_ON_CREATE) {
    throw new ValidationError(
      `That start date would add more than ${MAX_CATCHUP_ON_CREATE} expenses at once. Pick a later start date.`,
    );
  }

  const recurrence = await prisma.recurrence.create({
    data: {
      groupId: input.groupId ?? null,
      description: input.description,
      amount: input.amount,
      currency: input.currency,
      categoryId:
        input.categoryId && CATEGORY_BY_ID.has(input.categoryId)
          ? input.categoryId
          : DEFAULT_CATEGORY_ID,
      splitMode: input.splitMode,
      notes: input.notes ?? null,
      payersJson: JSON.stringify(
        input.payers.map((p) => ({ personId: p.personId, amount: p.amount.toString() })),
      ),
      splitsJson: JSON.stringify(
        input.splits.map((s) => ({
          personId: s.personId,
          amount: s.amount.toString(),
          included: s.included ?? s.amount !== 0n,
          weight: s.weight ?? null,
          percent: s.percent ?? null,
          adjustment: s.adjustment ? s.adjustment.toString() : null,
        })),
      ),
      frequency: input.frequency,
      interval: input.interval,
      dayOfMonth,
      timeZone,
      startDate,
      nextRunAt: startDate,
      endsAt: input.endsAt ?? null,
      createdByPersonId: session.person.id,
    },
  });

  return json({ recurrence: recurrenceDto(recurrence) }, { status: 201 });
});
