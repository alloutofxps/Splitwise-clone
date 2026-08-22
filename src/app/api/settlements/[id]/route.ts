import { json, route } from "@/lib/api";
import { ForbiddenError, NotFoundError, requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";
import { recordActivity } from "@/server/write";

type Params = { params: Promise<{ id: string }> };

/** Undoes a recorded payment - usually because it was entered twice. */
export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();

  const settlement = await prisma.settlement.findUnique({ where: { id } });
  if (!settlement || settlement.deletedAt) {
    throw new NotFoundError("That payment is already gone.");
  }

  if (settlement.groupId) {
    await requireGroupAccess(settlement.groupId, session.person.id);
  } else {
    const involved =
      settlement.fromPersonId === session.person.id ||
      settlement.toPersonId === session.person.id;
    if (!involved) throw new ForbiddenError("That payment is not yours to undo.");
  }

  await prisma.settlement.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await recordActivity({
    type: "settlement.deleted",
    actorPersonId: session.person.id,
    groupId: settlement.groupId,
    data: {
      amount: settlement.amount.toString(),
      currency: settlement.currency,
      fromPersonId: settlement.fromPersonId,
      toPersonId: settlement.toPersonId,
    },
  });

  return json({ ok: true });
});
