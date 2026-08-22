import { json, readBody, route } from "@/lib/api";
import { requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";
import { EXPENSE_INCLUDE, expenseDto } from "@/server/read";
import { createExpense, recordActivity } from "@/server/write";
import { expenseInputSchema, prepareExpense } from "@/server/expense-input";
import { newId } from "@/lib/ids";

/**
 * Files an expense.
 *
 * The client supplies the id so a mutation replayed from the offline outbox
 * lands on the same row rather than filing the dinner twice. `createExpense`
 * returns the existing record on a key collision, which makes this endpoint
 * safe to retry indefinitely.
 */
export const POST = route(async (request: Request) => {
  const session = await requireSession();
  const input = await readBody(request, expenseInputSchema);

  if (input.groupId) {
    await requireGroupAccess(input.groupId, session.person.id);
  } else if (!input.friendId) {
    throw new ValidationError("An expense needs a group or a person to be with.");
  }

  const expenseId = input.id ?? newId("exp");
  const prepared = await prepareExpense(input, session.person.id, expenseId);

  const { record, created } = await createExpense(prepared);

  // Only announce a genuinely new expense: a replayed offline mutation would
  // otherwise post a duplicate line into everyone's feed.
  if (created) {
    await recordActivity({
      type: "expense.created",
      actorPersonId: session.person.id,
      groupId: record.groupId,
      expenseId: record.id,
      data: {
        description: record.description,
        amount: record.amount.toString(),
        currency: record.currency,
      },
    });
  }

  const full = await prisma.expense.findUnique({
    where: { id: record.id },
    include: EXPENSE_INCLUDE,
  });

  return json({ expense: expenseDto(full!, session.person.id) }, { status: 201 });
});
