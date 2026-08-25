import { z } from "zod";
import { currencyCode, dateInput, minorUnits, text } from "@/lib/api";
import { ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { SPLIT_MODES } from "@/lib/split";
import { CATEGORY_BY_ID, DEFAULT_CATEGORY_ID } from "@/lib/categories";
import { assertCanInvolve } from "./access";
import { decodeDataUrl, type ExpenseWriteInput } from "./write";

export const expenseInputSchema = z.object({
  id: z.string().min(6).max(80).optional(),
  /**
   * The `updatedAt` the client last saw, for an edit.
   *
   * Optional so that a client which does not send it keeps working - and so
   * that a replayed offline edit, which may legitimately be working from an
   * older view, is not blocked by a race it cannot resolve on a plane.
   */
  expectedUpdatedAt: z.string().datetime().optional(),
  groupId: z.string().nullable().optional(),
  /** Set instead of groupId for a direct expense with one other person. */
  friendId: z.string().nullable().optional(),

  description: text(140, "The description"),
  notes: text(2000, "The note").nullable().optional(),
  amount: minorUnits("The amount"),
  currency: currencyCode,
  exchangeRate: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "The exchange rate has to be a positive number.")
    .optional(),

  splitMode: z.enum(SPLIT_MODES),
  categoryId: z.string().max(40).nullable().optional(),
  date: dateInput.optional(),

  payers: z
    .array(z.object({ personId: z.string().min(1), amount: minorUnits("A payment") }))
    .min(1, "Somebody has to have paid."),

  splits: z
    .array(
      z.object({
        personId: z.string().min(1),
        amount: minorUnits("A share"),
        included: z.boolean().optional(),
        weight: z.number().finite().nonnegative().nullable().optional(),
        percent: z.number().finite().nullable().optional(),
        adjustment: minorUnits("An adjustment").nullable().optional(),
      }),
    )
    .min(1, "Nobody is in this split."),

  items: z
    .array(
      z.object({
        name: text(100, "An item name"),
        amount: minorUnits("An item amount"),
        quantity: z.number().int().min(1).max(999).optional(),
        participantIds: z.array(z.string()).default([]),
      }),
    )
    .max(200)
    .optional(),

  attachments: z
    .array(
      z.object({
        filename: z.string().max(120).default("receipt"),
        mimeType: z.string().max(80),
        dataUrl: z.string().max(8_000_000),
      }),
    )
    .max(6)
    .optional(),
});

export type ExpenseInputParsed = z.infer<typeof expenseInputSchema>;

/**
 * Turns a validated request body into something the write layer can persist,
 * resolving the two things the client cannot be trusted to decide: which
 * currency the group settles in, and whether the caller is allowed to attach
 * debts to the people named in the split.
 */
export async function prepareExpense(
  input: ExpenseInputParsed,
  actorId: string,
  expenseId: string,
): Promise<ExpenseWriteInput> {
  const groupId = input.groupId ?? null;

  let settlementCurrency = input.currency;
  if (groupId) {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { currency: true },
    });
    if (!group) throw new ValidationError("That group no longer exists.");
    settlementCurrency = group.currency;
  }

  // Authorisation comes before anything that writes.
  //
  // This used to create the friendship first, on the theory that a first shared
  // dinner should not require adding each other as a separate step. That made
  // the check below self-satisfying: `assertCanInvolve` asks whether the two
  // people are connected, so manufacturing the connection first meant any
  // caller holding a person id - which is not a secret, it appears in every
  // group member list - could file a debt against a stranger. Friendship is
  // consent, and the only thing that establishes it is knowing someone's invite
  // code (see POST /api/friends).
  const involved = [
    ...input.payers.map((p) => p.personId),
    ...input.splits.filter((s) => s.amount !== 0n || s.included !== false).map((s) => s.personId),
  ];
  await assertCanInvolve(involved, actorId, groupId);

  const exchangeRate =
    settlementCurrency === input.currency ? "1" : (input.exchangeRate ?? "1");

  if (settlementCurrency !== input.currency && !input.exchangeRate) {
    throw new ValidationError(
      `This group settles in ${settlementCurrency}, so an exchange rate is needed for a ${input.currency} expense.`,
    );
  }

  const categoryId =
    input.categoryId && CATEGORY_BY_ID.has(input.categoryId)
      ? input.categoryId
      : DEFAULT_CATEGORY_ID;

  const attachments = (input.attachments ?? []).map((attachment) =>
    decodeDataUrl(attachment.dataUrl, attachment.filename),
  );

  return {
    id: expenseId,
    groupId,
    description: input.description,
    notes: input.notes ?? null,
    amount: input.amount,
    currency: input.currency,
    exchangeRate,
    settlementCurrency,
    splitMode: input.splitMode,
    categoryId,
    date: input.date ?? new Date(),
    createdByPersonId: actorId,
    expectedUpdatedAt: input.expectedUpdatedAt ? new Date(input.expectedUpdatedAt) : null,
    payers: input.payers.map((p) => ({ personId: p.personId, amount: p.amount })),
    splits: input.splits.map((s) => ({
      personId: s.personId,
      amount: s.amount,
      included: s.included ?? s.amount !== 0n,
      weight: s.weight ?? null,
      percent: s.percent ?? null,
      adjustment: s.adjustment ?? null,
    })),
    items: (input.items ?? []).map((item) => ({
      name: item.name,
      amount: item.amount,
      quantity: item.quantity ?? 1,
      participantIds: item.participantIds,
    })),
    attachments,
  };
}
