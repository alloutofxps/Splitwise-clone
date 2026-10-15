import { z } from "zod";
import { currencyCode, dateInput, exchangeRateInput, minorUnits, text } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { SPLIT_MODES } from "@/lib/split";
import { CATEGORY_BY_ID, DEFAULT_CATEGORY_ID } from "@/lib/categories";
import { areFriends, assertCanInvolve } from "./access";
import { computeBalances } from "@/lib/balances";
import { decodeDataUrl, MAX_ATTACHMENT_BYTES, type ExpenseWriteInput } from "./write";
import { checkRateIsPlausible } from "./rates";

export const MAX_ATTACHMENTS = 6;

/**
 * The largest body an expense request may have: six receipts at the 4 MB cap,
 * base64-inflated by a third, plus the expense itself. Everything else in the
 * API is held to `DEFAULT_BODY_LIMIT`.
 */
export const EXPENSE_BODY_LIMIT = Math.ceil(MAX_ATTACHMENTS * MAX_ATTACHMENT_BYTES * 1.37) + 256 * 1024;

/** Receipt storage per group, and for direct expenses per person. */
const GROUP_ATTACHMENT_QUOTA = 250 * 1024 * 1024;
const PERSON_ATTACHMENT_QUOTA = 100 * 1024 * 1024;

export const expenseInputSchema = z.object({
  id: z.string().min(6).max(80).regex(/^[A-Za-z0-9_-]+$/, "Something went wrong. Please try again.").optional(),
  /**
   * The `updatedAt` the client last saw. Required for an edit (the route
   * checks); ignored on a create.
   */
  expectedUpdatedAt: z.string().datetime().optional(),
  groupId: z.string().max(80).nullable().optional(),
  /** Set instead of groupId for a direct expense with one other person. */
  friendId: z.string().max(80).nullable().optional(),

  description: text(140, "The description"),
  notes: text(2000, "The note").nullable().optional(),
  amount: minorUnits("The amount"),
  currency: currencyCode,
  exchangeRate: exchangeRateInput.optional(),

  splitMode: z.enum(SPLIT_MODES),
  categoryId: z.string().max(40).nullable().optional(),
  date: dateInput.optional(),

  payers: z
    .array(z.object({ personId: z.string().min(1).max(80), amount: minorUnits("A payment") }))
    .min(1, "Pick who paid.")
    .max(100),

  splits: z
    .array(
      z.object({
        personId: z.string().min(1).max(80),
        amount: minorUnits("A share"),
        included: z.boolean().optional(),
        weight: z.number().finite().nonnegative().nullable().optional(),
        percent: z.number().finite().nullable().optional(),
        adjustment: minorUnits("An adjustment").nullable().optional(),
      }),
    )
    .min(1, "Nobody is in this split.")
    .max(100),

  items: z
    .array(
      z.object({
        name: text(100, "An item name"),
        amount: minorUnits("An item amount"),
        quantity: z.number().int().min(1).max(999).optional(),
        participantIds: z.array(z.string().max(80)).max(100).default([]),
      }),
    )
    .max(200)
    .optional(),

  attachments: z
    .array(
      z.object({
        filename: z.string().max(120).default("receipt"),
        mimeType: z.string().max(80),
        dataUrl: z.string().max(Math.ceil(MAX_ATTACHMENT_BYTES * 1.37) + 100),
      }),
    )
    .max(MAX_ATTACHMENTS)
    .optional(),
});

export type ExpenseInputParsed = z.infer<typeof expenseInputSchema>;

/**
 * Turns a validated request body into something the write layer can persist,
 * resolving the things the client cannot be trusted to decide: which currency
 * the group settles in, whether the caller may attach debts to the people
 * named, whether the rate is plausible, and whether there is room for the
 * receipts.
 *
 * `existing` is the expense being edited, if any. People already on it may
 * stay on it after they leave the group - otherwise every old expense
 * involving a former housemate became impossible to correct.
 */
export async function prepareExpense(
  input: ExpenseInputParsed,
  actorId: string,
  expenseId: string,
  existing?: { personIds: string[] },
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

  // Authorisation comes before anything that writes. Friendship is consent,
  // and the only thing that establishes it is knowing someone's invite code -
  // so no route creates one implicitly on the way to filing a debt.
  const involved = [
    ...input.payers.map((p) => p.personId),
    ...input.splits.filter((s) => s.amount !== 0n || s.included !== false).map((s) => s.personId),
  ];
  await assertCanInvolve(involved, actorId, groupId, existing?.personIds ?? []);

  // Outside a group, every debt an expense creates has to be between two
  // friends. With several friends and several payers, one friend can end up
  // owing another; if those two are not friends on Divvy, neither could see
  // or settle that debt. A group is where people who don't know each other
  // share costs.
  if (!groupId) {
    const { pairwise } = computeBalances([
      {
        kind: "expense",
        id: "check",
        paid: input.payers.map((p) => ({ personId: p.personId, amount: p.amount })),
        owed: input.splits
          .filter((s) => s.amount !== 0n)
          .map((s) => ({ personId: s.personId, amount: s.amount })),
      },
    ]);
    for (const edge of pairwise) {
      if (edge.fromPersonId === actorId || edge.toPersonId === actorId) continue;
      if (await areFriends(edge.fromPersonId, edge.toPersonId)) continue;
      const people = await prisma.person.findMany({
        where: { id: { in: [edge.fromPersonId, edge.toPersonId] } },
        select: { displayName: true },
      });
      const [a, b] = people.map((p) => p.displayName);
      throw new ValidationError(
        `${a ?? "Two people"} and ${b ?? "someone"} aren't friends on Divvy, so one can't owe the other outside a group. Make a group for this, or pick one person who paid.`,
      );
    }
  }

  if (settlementCurrency !== input.currency && !input.exchangeRate) {
    throw new ValidationError(
      `This group uses ${settlementCurrency}, so add an exchange rate for this ${input.currency} expense.`,
    );
  }

  const exchangeRate =
    settlementCurrency === input.currency ? "1" : (input.exchangeRate ?? "1");
  if (exchangeRate !== "1" || settlementCurrency !== input.currency) {
    await checkRateIsPlausible(input.currency, settlementCurrency, exchangeRate);
  }

  const categoryId =
    input.categoryId && CATEGORY_BY_ID.has(input.categoryId)
      ? input.categoryId
      : DEFAULT_CATEGORY_ID;

  const attachments = (input.attachments ?? []).map((attachment) =>
    decodeDataUrl(attachment.dataUrl, attachment.filename),
  );
  if (attachments.length > 0) {
    await assertAttachmentQuota(
      groupId,
      actorId,
      attachments.reduce((total, a) => total + a.data.byteLength, 0),
    );
  }

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

/**
 * Receipts live in the database, so without a ceiling one person - or one
 * script - could fill the disk, at which point SQLite refuses *every* write
 * for every customer.
 */
async function assertAttachmentQuota(groupId: string | null, actorId: string, adding: number) {
  const used = await prisma.attachment.aggregate({
    _sum: { size: true },
    where: groupId
      ? { expense: { groupId } }
      : { expense: { groupId: null, createdByPersonId: actorId } },
  });
  const quota = groupId ? GROUP_ATTACHMENT_QUOTA : PERSON_ATTACHMENT_QUOTA;
  if ((used._sum.size ?? 0) + adding > quota) {
    throw new ValidationError(
      groupId
        ? "This group has run out of space for receipts. Remove some old ones first."
        : "You have run out of space for receipts. Remove some old ones first.",
    );
  }
}
