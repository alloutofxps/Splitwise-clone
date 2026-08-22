import { json, route } from "@/lib/api";
import { ForbiddenError, requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";
import { groupBalanceSheet } from "@/server/read";
import { recordActivity } from "@/server/write";

type Params = { params: Promise<{ id: string; personId: string }> };

/**
 * Removes somebody from a group.
 *
 * Refused while they still have a balance, because removing them would delete
 * the only record that the debt exists. The UI offers to settle them up first.
 *
 * A member who has expenses but nets to zero is marked as left rather than
 * deleted, so historical expenses keep rendering their name.
 */
export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id, personId } = await params;
  const session = await requireSession();
  const { group, isOwner } = await requireGroupAccess(id, session.person.id);

  const target = await prisma.person.findUnique({ where: { id: personId } });
  if (!target) return json({ ok: true });

  // You can always remove yourself; removing anybody else is the owner's call,
  // except for placeholders, which belong to whoever is tidying up.
  const removingSelf = personId === session.person.id;
  if (!removingSelf && !isOwner && !target.isGhost) {
    throw new ForbiddenError("Only whoever created the group can remove other people.");
  }

  const sheet = await groupBalanceSheet(id);
  const balance = sheet.net.get(personId) ?? 0n;
  if (balance !== 0n) {
    throw new ForbiddenError(
      removingSelf
        ? "Settle your balance in this group before leaving it."
        : `${target.displayName} still has a balance here. Settle up first.`,
    );
  }

  const involvement = await prisma.expense.count({
    where: {
      groupId: id,
      deletedAt: null,
      OR: [{ payers: { some: { personId } } }, { splits: { some: { personId } } }],
    },
  });

  if (involvement > 0) {
    await prisma.membership.update({
      where: { groupId_personId: { groupId: id, personId } },
      data: { leftAt: new Date() },
    });
  } else {
    await prisma.membership.delete({
      where: { groupId_personId: { groupId: id, personId } },
    });
    // A placeholder that was never used anywhere else is just clutter.
    if (target.isGhost) {
      const otherMemberships = await prisma.membership.count({ where: { personId } });
      if (otherMemberships === 0) {
        await prisma.person.delete({ where: { id: personId } });
      }
    }
  }

  await recordActivity({
    type: removingSelf ? "member.left" : "member.removed",
    actorPersonId: session.person.id,
    groupId: id,
    data: { otherPersonId: personId, groupName: group.name },
  });

  return json({ ok: true });
});
