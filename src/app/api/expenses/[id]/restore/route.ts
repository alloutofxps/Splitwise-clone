import { json, route } from "@/lib/api";
import { ForbiddenError, NotFoundError, requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";
import { EXPENSE_INCLUDE, expenseDto } from "@/server/read";
import { recordActivity } from "@/server/write";
import { bumpLedgerQuery } from "@/server/ledger";

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

  // Entitlement first, and before *any* reply — including the idempotent one
  // below. Answering "already restored" with the expense attached would hand a
  // stranger the description, the amount and everyone's share, which is the
  // whole record; that a request changes nothing does not make it a read
  // anybody may perform.
  if (expense.groupId) {
    await requireGroupAccess(expense.groupId, session.person.id);
  } else {
    const involved =
      expense.createdByPersonId === session.person.id ||
      expense.payers.some((payer) => payer.personId === session.person.id) ||
      expense.splits.some((split) => split.personId === session.person.id);
    if (!involved) throw new ForbiddenError("You can't bring that expense back.");
  }

  if (!expense.deletedAt) {
    // Not an error worth failing a retry over: an outbox replay, or two taps on
    // one toast, should land on the state the user asked for.
    return json({ expense: expenseDto(expense, session.person.id) });
  }

  // A group that has since been deleted takes its expenses with it, and putting
  // one back into nothing would produce a row no screen can reach.
  if (expense.groupId) {
    const group = await prisma.group.findUnique({
      where: { id: expense.groupId },
      select: { id: true },
    });
    if (!group) throw new ValidationError("The group this belonged to is gone.");

    // Restoring an expense hands everyone on it their share again. Somebody
    // who has since left the group settled up to leave it; bringing a debt
    // back behind their back would reopen a balance nobody can see to settle.
    const involved = [
      ...new Set([
        ...expense.payers.map((p) => p.personId),
        ...expense.splits.filter((s) => s.amount !== 0n).map((s) => s.personId),
      ]),
    ];
    const members = await prisma.membership.findMany({
      where: { groupId: expense.groupId, personId: { in: involved }, leftAt: null },
      select: { personId: true },
    });
    if (members.length !== involved.length) {
      throw new ValidationError(
        "Someone on this expense has left the group. Add them back first.",
      );
    }
  }

  const [restored] = await prisma.$transaction([
    prisma.expense.update({
      where: { id },
      data: { deletedAt: null },
      include: EXPENSE_INCLUDE,
    }),
    bumpLedgerQuery([expense.groupId]),
  ]);

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
