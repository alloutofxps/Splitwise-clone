import { z } from "zod";
import { json, readBody, route, text } from "@/lib/api";
import { ForbiddenError, NotFoundError, requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";
import { commentDto } from "@/server/read";
import { recordActivity } from "@/server/write";

type Params = { params: Promise<{ id: string }> };

async function assertCanSee(expenseId: string, personId: string) {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: { payers: true, splits: true },
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
  await assertCanSee(id, session.person.id);

  const comments = await prisma.comment.findMany({
    where: { expenseId: id, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });

  return json({ comments: comments.map(commentDto) });
});

const schema = z.object({
  body: text(2000, "That comment").refine((v) => v.length > 0, "Say something first."),
});

/**
 * Comments are where the argument about who had the extra round actually
 * happens, so they get their own feed entry rather than being silent.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  const expense = await assertCanSee(id, session.person.id);
  const input = await readBody(request, schema);

  const comment = await prisma.comment.create({
    data: { expenseId: id, personId: session.person.id, body: input.body },
  });

  await recordActivity({
    type: "comment.created",
    actorPersonId: session.person.id,
    groupId: expense.groupId,
    expenseId: id,
    data: {
      description: expense.description,
      // A short preview keeps the feed readable without opening the expense.
      preview: input.body.slice(0, 90),
    },
  });

  return json({ comment: commentDto(comment) }, { status: 201 });
});
