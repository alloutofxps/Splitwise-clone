import { json, readBody, route } from "@/lib/api";
import { ForbiddenError, NotFoundError, requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";
import { EXPENSE_INCLUDE, expenseDto } from "@/server/read";
import { describeChanges, recordActivity, updateExpense } from "@/server/write";
import { expenseInputSchema, prepareExpense } from "@/server/expense-input";

type Params = { params: Promise<{ id: string }> };

/**
 * Loads an expense the caller is entitled to see: anything in a group they are
 * in, or any direct expense they are personally part of.
 */
async function loadVisibleExpense(expenseId: string, personId: string) {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: EXPENSE_INCLUDE,
  });
  if (!expense || expense.deletedAt) throw new NotFoundError("That expense is gone.");

  if (expense.groupId) {
    await requireGroupAccess(expense.groupId, personId);
    return expense;
  }

  const involved =
    expense.createdByPersonId === personId ||
    expense.payers.some((p) => p.personId === personId) ||
    expense.splits.some((s) => s.personId === personId);
  if (!involved) throw new ForbiddenError("That expense is not yours to see.");

  return expense;
}

export const GET = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  const expense = await loadVisibleExpense(id, session.person.id);
  return json({ expense: expenseDto(expense, session.person.id) });
});

/**
 * Edits an expense.
 *
 * Anyone in the group can edit, not only whoever entered it - people fix each
 * other's typos constantly, and the activity feed records who changed what,
 * which is a better safeguard than a lock.
 */
export const PATCH = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  const before = await loadVisibleExpense(id, session.person.id);
  const input = await readBody(request, expenseInputSchema);

  // The group an expense belongs to is fixed. Moving one between groups would
  // silently rewrite two sets of balances, so the UI offers delete-and-re-add.
  const prepared = await prepareExpense(
    { ...input, groupId: before.groupId, friendId: null },
    session.person.id,
    id,
  );

  const after = await updateExpense(prepared);

  const changes = describeChanges(before, after);
  await recordActivity({
    type: "expense.updated",
    actorPersonId: session.person.id,
    groupId: after.groupId,
    expenseId: after.id,
    data: {
      description: after.description,
      amount: after.amount.toString(),
      currency: after.currency,
      changes,
    },
  });

  const full = await prisma.expense.findUnique({
    where: { id },
    include: EXPENSE_INCLUDE,
  });
  return json({ expense: expenseDto(full!, session.person.id) });
});

/**
 * Deletes an expense.
 *
 * Soft delete: the row stays so the activity feed can still say what was
 * removed, and so a mis-tap is recoverable from the database if it ever
 * matters. Balances ignore anything with `deletedAt` set.
 */
export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  const expense = await loadVisibleExpense(id, session.person.id);

  await prisma.expense.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await recordActivity({
    type: "expense.deleted",
    actorPersonId: session.person.id,
    groupId: expense.groupId,
    // The row is a tombstone, not a hole, so the reference still resolves — and
    // it is what lets the activity feed offer to put this back. Without it the
    // feed can tell you the expense was deleted and nothing else, which is the
    // one place somebody looks when they want it undone.
    expenseId: expense.id,
    data: {
      description: expense.description,
      amount: expense.amount.toString(),
      currency: expense.currency,
    },
  });

  return json({ ok: true });
});
