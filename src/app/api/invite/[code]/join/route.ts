import { z } from "zod";
import { json, readBody, route } from "@/lib/api";
import { NotFoundError, requireSession, ValidationError } from "@/lib/identity";
import { normalizeInviteCode } from "@/lib/codes";
import { prisma } from "@/lib/db";
import { friendshipPair } from "@/server/access";
import { absorbGhost } from "@/server/merge";
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
      // The code proves they were invited; naming a placeholder that is in
      // this group is what makes it theirs to claim. `absorbGhost` re-checks
      // inside its transaction that the row is still an unclaimed placeholder,
      // so two people racing for the same "Sam" cannot both win.
      const inGroup = await prisma.membership.findUnique({
        where: { groupId_personId: { groupId: group.id, personId: input.claimPersonId } },
      });
      if (!inGroup) throw new NotFoundError("That name is not in this group.");
      await absorbGhost(input.claimPersonId, me.id);
    }

    // Either way they end up an active member: after a claim the placeholder's
    // membership row has become theirs, but it could have been marked as left,
    // and joining is not the moment to inherit that.
    await prisma.membership.upsert({
      where: { groupId_personId: { groupId: group.id, personId: me.id } },
      create: { groupId: group.id, personId: me.id },
      update: { leftAt: null },
    });

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
