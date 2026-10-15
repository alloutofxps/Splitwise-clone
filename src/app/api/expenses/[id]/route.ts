import { json, readBody, route } from "@/lib/api";
import { ForbiddenError, NotFoundError, requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";
import { EXPENSE_INCLUDE, expenseDto } from "@/server/read";
import { describeChanges, recordActivity, updateExpense } from "@/server/write";
import { EXPENSE_BODY_LIMIT, expenseInputSchema, prepareExpense } from "@/server/expense-input";
import { bumpLedgerQuery } from "@/server/ledger";
import { limitByAccount, WRITE } from "@/server/rate-limit";

type Params = { params: Promise<{ id: string }> };

/**
 * Loads an expense the caller is entitled to see: anything in a group they are
 * in, or any direct expense they are personally part of.
 *
 * `includeDeleted` is for the delete itself, so deleting twice - which the
 * offline outbox does on a replay - answers "done" rather than "not found".
 */
async function loadVisibleExpense(
  expenseId: string,
  personId: string,
  { includeDeleted = false }: { includeDeleted?: boolean } = {},
) {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: EXPENSE_INCLUDE,
  });
  if (!expense || (expense.deletedAt && !includeDeleted)) {
    throw new NotFoundError("That expense is gone.");
  }

  if (expense.groupId) {
    await requireGroupAccess(expense.groupId, personId);
    return expense;
  }

  const involved =
    expense.createdByPersonId === personId ||
    expense.payers.some((p) => p.personId === personId) ||
    expense.splits.some((s) => s.personId === personId);
  if (!involved) throw new ForbiddenError("You can't see that expense.");

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
 * which is a better safeguard than a lock. What nobody can do is overwrite an
 * edit they never saw: `updateExpense` requires the version the editor started
 * from.
 */
export const PATCH = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  limitByAccount(session.person.id, "expense-write", WRITE);
  const before = await loadVisibleExpense(id, session.person.id);
  const input = await readBody(request, expenseInputSchema, { maxBytes: EXPENSE_BODY_LIMIT });

  // The group an expense belongs to is fixed - the composer shows the scope as
  // a label when editing. Moving one would silently rewrite two ledgers.
  const prepared = await prepareExpense(
    { ...input, groupId: before.groupId, friendId: null },
    session.person.id,
    id,
    {
      personIds: [
        ...before.payers.map((p) => p.personId),
        ...before.splits.map((s) => s.personId),
      ],
    },
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
 * removed, and so a mis-tap can be undone. Balances ignore anything with
 * `deletedAt` set.
 */
export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  const expense = await loadVisibleExpense(id, session.person.id, { includeDeleted: true });

  // Already gone is the state the caller asked for.
  if (expense.deletedAt) return json({ ok: true });

  await prisma.$transaction([
    prisma.expense.update({
      where: { id },
      data: { deletedAt: new Date() },
    }),
    bumpLedgerQuery([expense.groupId]),
  ]);

  await recordActivity({
    type: "expense.deleted",
    actorPersonId: session.person.id,
    groupId: expense.groupId,
    // The row is a tombstone, not a hole, so the reference still resolves -
    // and it is what lets the activity feed offer to put this back.
    expenseId: expense.id,
    data: {
      description: expense.description,
      amount: expense.amount.toString(),
      currency: expense.currency,
    },
  });

  return json({ ok: true });
});
