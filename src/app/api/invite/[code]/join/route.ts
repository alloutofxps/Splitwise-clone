import { z } from "zod";
import { json, readBody, route } from "@/lib/api";
import { NotFoundError, requireSession, ValidationError } from "@/lib/identity";
import { normalizeInviteCode } from "@/lib/codes";
import { prisma } from "@/lib/db";
import { friendshipPair } from "@/server/access";
import { personDto } from "@/server/read";
import { recordActivity } from "@/server/write";
import { CODE_LOOKUP, limitByAddress } from "@/server/rate-limit";

type Params = { params: Promise<{ code: string }> };

const schema = z.object({
  /**
   * The placeholder this person is claiming, if they recognised themselves in
   * the group's unclaimed list.
   */
  claimPersonId: z.string().optional(),
});

/**
 * Redeems an invite code: joins a group, or adds a friend.
 *
 * The interesting case is claiming a placeholder. Somebody has been splitting
 * dinners with a ghost called "Sam" for a week. Sam finally installs the app,
 * opens the link, and taps "that's me". Rather than adding a second member, we
 * merge: every expense, split and settlement already filed against the ghost
 * now belongs to Sam's real identity, and the ghost row disappears.
 *
 * Merging is done in a transaction and keyed on the ghost still being
 * unclaimed, so two people racing to claim the same Sam cannot both win.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  limitByAddress(request, "invite-join", CODE_LOOKUP);

  const { code } = await params;
  const session = await requireSession();
  const me = session.person;
  const normalized = normalizeInviteCode(code);
  const input = await readBody(request, schema.optional().default({}));

  const group = await prisma.group.findUnique({
    where: { inviteCode: normalized },
    include: { memberships: { where: { leftAt: null } } },
  });

  if (group) {
    if (!group.inviteCodeActive) {
      throw new NotFoundError("That invite link has been turned off.");
    }

    const already = group.memberships.find((m) => m.personId === me.id);
    if (already) return json({ kind: "group", groupId: group.id, alreadyMember: true });

    if (input.claimPersonId) {
      await mergeGhostInto(input.claimPersonId, me.id, group.id);
    } else {
      await prisma.membership.upsert({
        where: { groupId_personId: { groupId: group.id, personId: me.id } },
        create: { groupId: group.id, personId: me.id },
        update: { leftAt: null },
      });
    }

    // Everyone in a group is implicitly a contact, which is what makes direct
    // expenses with them possible afterwards.
    await connectToGroupMembers(me.id, group.id);

    await recordActivity({
      type: "member.joined",
      actorPersonId: me.id,
      groupId: group.id,
      data: { groupName: group.name },
    });

    return json({ kind: "group", groupId: group.id });
  }

  const person = await prisma.person.findUnique({ where: { inviteCode: normalized } });
  if (!person || person.isGhost) {
    throw new NotFoundError("That code does not match a group or a person.");
  }
  if (person.id === me.id) {
    throw new ValidationError("That is your own code.");
  }

  await prisma.friendship.upsert({
    where: { personAId_personBId: friendshipPair(me.id, person.id) },
    create: friendshipPair(me.id, person.id),
    update: {},
  });

  return json({ kind: "person", person: personDto(person) });
});

/**
 * Repoints every reference from a ghost to a real person, then deletes it.
 *
 * Each table needs its own pass because most of them carry a uniqueness
 * constraint on (parent, personId): if the claimer somehow already has a row on
 * the same expense, repointing blindly would violate it, so those cases are
 * merged by summing instead.
 */
async function mergeGhostInto(ghostId: string, personId: string, groupId: string) {
  await prisma.$transaction(async (tx) => {
    const ghost = await tx.person.findUnique({ where: { id: ghostId } });
    if (!ghost) throw new NotFoundError("That name has already been taken.");
    if (!ghost.isGhost) throw new ValidationError("Somebody has already claimed that name.");

    const membership = await tx.membership.findUnique({
      where: { groupId_personId: { groupId, personId: ghostId } },
    });
    if (!membership) throw new NotFoundError("That name is not in this group.");

    // Payers: sum on collision, otherwise repoint.
    for (const payer of await tx.expensePayer.findMany({ where: { personId: ghostId } })) {
      const existing = await tx.expensePayer.findUnique({
        where: { expenseId_personId: { expenseId: payer.expenseId, personId } },
      });
      if (existing) {
        await tx.expensePayer.update({
          where: { id: existing.id },
          data: { amount: existing.amount + payer.amount },
        });
        await tx.expensePayer.delete({ where: { id: payer.id } });
      } else {
        await tx.expensePayer.update({ where: { id: payer.id }, data: { personId } });
      }
    }

    for (const split of await tx.expenseSplit.findMany({ where: { personId: ghostId } })) {
      const existing = await tx.expenseSplit.findUnique({
        where: { expenseId_personId: { expenseId: split.expenseId, personId } },
      });
      if (existing) {
        await tx.expenseSplit.update({
          where: { id: existing.id },
          data: { amount: existing.amount + split.amount, included: true },
        });
        await tx.expenseSplit.delete({ where: { id: split.id } });
      } else {
        await tx.expenseSplit.update({ where: { id: split.id }, data: { personId } });
      }
    }

    for (const share of await tx.expenseItemShare.findMany({ where: { personId: ghostId } })) {
      const existing = await tx.expenseItemShare.findUnique({
        where: { itemId_personId: { itemId: share.itemId, personId } },
      });
      if (existing) await tx.expenseItemShare.delete({ where: { id: share.id } });
      else await tx.expenseItemShare.update({ where: { id: share.id }, data: { personId } });
    }

    await tx.settlement.updateMany({
      where: { fromPersonId: ghostId },
      data: { fromPersonId: personId },
    });
    await tx.settlement.updateMany({
      where: { toPersonId: ghostId },
      data: { toPersonId: personId },
    });
    await tx.settlement.updateMany({
      where: { createdByPersonId: ghostId },
      data: { createdByPersonId: personId },
    });
    await tx.expense.updateMany({
      where: { createdByPersonId: ghostId },
      data: { createdByPersonId: personId },
    });
    await tx.comment.updateMany({ where: { personId: ghostId }, data: { personId } });
    await tx.activity.updateMany({
      where: { actorPersonId: ghostId },
      data: { actorPersonId: personId },
    });
    await tx.recurrence.updateMany({
      where: { createdByPersonId: ghostId },
      data: { createdByPersonId: personId },
    });

    // A settlement that ends up pointing at the same person on both sides is
    // meaningless - it can only arise from the merge itself.
    await tx.settlement.deleteMany({
      where: { fromPersonId: personId, toPersonId: personId },
    });

    // Take over the ghost's group memberships, then remove the ghost.
    for (const ghostMembership of await tx.membership.findMany({
      where: { personId: ghostId },
    })) {
      const mine = await tx.membership.findUnique({
        where: {
          groupId_personId: { groupId: ghostMembership.groupId, personId },
        },
      });
      if (mine) {
        await tx.membership.update({ where: { id: mine.id }, data: { leftAt: null } });
        await tx.membership.delete({ where: { id: ghostMembership.id } });
      } else {
        await tx.membership.update({
          where: { id: ghostMembership.id },
          data: { personId, leftAt: null },
        });
      }
    }

    await tx.person.delete({ where: { id: ghostId } });
  });
}

/** Everyone already in the group becomes a contact of the new arrival. */
async function connectToGroupMembers(personId: string, groupId: string) {
  const members = await prisma.membership.findMany({
    where: { groupId, leftAt: null, personId: { not: personId } },
    include: { person: { select: { id: true, isGhost: true } } },
  });

  for (const member of members) {
    if (member.person.isGhost) continue;
    await prisma.friendship.upsert({
      where: { personAId_personBId: friendshipPair(personId, member.personId) },
      create: friendshipPair(personId, member.personId),
      update: {},
    });
  }
}
