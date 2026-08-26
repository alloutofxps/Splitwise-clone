import { json, route } from "@/lib/api";
import { ForbiddenError, NotFoundError, requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";
import { EXPENSE_INCLUDE, expenseDto } from "@/server/read";
import { recordActivity } from "@/server/write";

type Params = { params: Promise<{ id: string }> };

/**
 * Puts a deleted expense back.
 *
 * Deleting is a tombstone, not a shredder, and balances are derived from live
 * rows — so undoing is only ever a matter of clearing `deletedAt` and letting
 * every figure recompute itself. The data to reverse the action was already
 * being kept; what was missing was any way to ask for it.
 *
 * The access check is deliberately written out here rather than reusing
 * `loadVisibleExpense`, which refuses a deleted row on purpose: for every other
 * route a tombstoned expense is gone, and only this one is entitled to see it.
 *
 * Restoring is not time-limited. The undo toast is where people will reach for
 * it, but "I deleted the wrong dinner last Tuesday" is the same mistake a
 * minute later or a week later, and a window would only decide which of those
 * two the app is willing to help with.
 */
export const POST = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: EXPENSE_INCLUDE,
  });
  if (!expense) throw new NotFoundError("That expense is gone.");
  if (!expense.deletedAt) {
    // Not an error worth failing a retry over: an outbox replay, or two taps on
    // one toast, should land on the state the user asked for.
    return json({ expense: expenseDto(expense, session.person.id) });
  }

  if (expense.groupId) {
    await requireGroupAccess(expense.groupId, session.person.id);
  } else {
    const involved =
      expense.createdByPersonId === session.person.id ||
      expense.payers.some((payer) => payer.personId === session.person.id) ||
      expense.splits.some((split) => split.personId === session.person.id);
    if (!involved) throw new ForbiddenError("That expense is not yours to restore.");
  }

  // A group that has since been deleted takes its expenses with it, and putting
  // one back into nothing would produce a row no screen can reach.
  if (expense.groupId) {
    const group = await prisma.group.findUnique({
      where: { id: expense.groupId },
      select: { id: true },
    });
    if (!group) throw new ValidationError("The group this belonged to is gone.");
  }

  const restored = await prisma.expense.update({
    where: { id },
    data: { deletedAt: null },
    include: EXPENSE_INCLUDE,
  });

  await recordActivity({
    type: "expense.restored",
    actorPersonId: session.person.id,
    groupId: restored.groupId,
    expenseId: restored.id,
    data: {
      description: restored.description,
      amount: restored.amount.toString(),
      currency: restored.currency,
    },
  });

  return json({ expense: expenseDto(restored, session.person.id) });
});
