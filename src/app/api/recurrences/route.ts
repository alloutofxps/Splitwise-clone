import { z } from "zod";
import { currencyCode, dateInput, json, minorUnits, readBody, route, text } from "@/lib/api";
import { requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { SPLIT_MODES } from "@/lib/split";
import { RECURRENCE_FREQUENCIES } from "@/lib/types";
import { CATEGORY_BY_ID, DEFAULT_CATEGORY_ID } from "@/lib/categories";
import { assertCanInvolve, requireGroupAccess } from "@/server/access";
import { recurrenceDto } from "@/server/recurrence-dto";

const entrySchema = z.object({
  personId: z.string().min(1),
  amount: minorUnits("An amount"),
  included: z.boolean().optional(),
  weight: z.number().finite().nullable().optional(),
  percent: z.number().finite().nullable().optional(),
  adjustment: minorUnits("An adjustment").nullable().optional(),
});

const schema = z.object({
  groupId: z.string().nullable().optional(),
  description: text(140, "The description").refine((v) => v.length > 0, "Give it a description."),
  amount: minorUnits("The amount"),
  currency: currencyCode,
  categoryId: z.string().max(40).nullable().optional(),
  splitMode: z.enum(SPLIT_MODES).default("EQUAL"),
  notes: text(2000, "The note").nullable().optional(),
  payers: z.array(entrySchema).min(1),
  splits: z.array(entrySchema).min(1),
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  interval: z.number().int().min(1).max(52).default(1),
  startDate: dateInput,
  endsAt: dateInput.nullable().optional(),
});

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
 * each firing. If the rent splits three ways today and somebody moves out next
 * month, the recurrence keeps posting the old split until a human edits it -
 * which is the safe direction to fail, because silently re-splitting somebody's
 * rent behind their back is not something an app should do on its own.
 */
export const POST = route(async (request: Request) => {
  const session = await requireSession();
  const input = await readBody(request, schema);

  if (input.groupId) await requireGroupAccess(input.groupId, session.person.id);

  const involved = [
    ...input.payers.map((p) => p.personId),
    ...input.splits.map((s) => s.personId),
  ];
  await assertCanInvolve(involved, session.person.id, input.groupId ?? null);

  const paid = input.payers.reduce((total, p) => total + p.amount, 0n);
  const owed = input.splits.reduce((total, s) => total + s.amount, 0n);
  if (paid !== input.amount || owed !== input.amount) {
    throw new ValidationError("The payers and the split both have to add up to the total.");
  }

  const startDate = input.startDate;
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
      dayOfMonth:
        input.frequency === "MONTHLY" ||
        input.frequency === "QUARTERLY" ||
        input.frequency === "YEARLY"
          ? startDate.getDate()
          : null,
      startDate,
      nextRunAt: startDate,
      endsAt: input.endsAt ?? null,
      createdByPersonId: session.person.id,
    },
  });

  return json({ recurrence: recurrenceDto(recurrence) }, { status: 201 });
});
