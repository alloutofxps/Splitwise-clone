import { json, route } from "@/lib/api";
import { NotFoundError } from "@/lib/identity";
import { normalizeInviteCode } from "@/lib/codes";
import { prisma } from "@/lib/db";
import { personDto } from "@/server/read";
import { CODE_LOOKUP, limitByAddress } from "@/server/rate-limit";

type Params = { params: Promise<{ code: string }> };

/**
 * Previews an invite code without joining anything.
 *
 * This is what the join screen renders before the user commits: the group name,
 * who is already in it, and - importantly - which placeholder names are still
 * unclaimed, so the arriving user can say "the Sam you've been splitting with
 * is me" instead of becoming a second Sam.
 *
 * Deliberately readable without an identity, so a link opened from a chat works
 * before the app has been set up.
 */
export const GET = route(async (request: Request, { params }: Params) => {
  // The cheapest oracle in the app: it answers "is this a real code?" without
  // an identity. Limited hardest for that reason.
  limitByAddress(request, "invite-preview", CODE_LOOKUP);

  const { code } = await params;
  const normalized = normalizeInviteCode(code);

  const group = await prisma.group.findUnique({
    where: { inviteCode: normalized },
    include: {
      memberships: {
        where: { leftAt: null },
        include: { person: true },
        orderBy: { joinedAt: "asc" },
      },
      _count: { select: { expenses: true } },
    },
  });

  if (group) {
    if (!group.inviteCodeActive) {
      throw new NotFoundError("That invite link has been turned off.");
    }
    return json({
      kind: "group" as const,
      group: {
        id: group.id,
        name: group.name,
        emoji: group.emoji,
        color: group.color,
        kind: group.kind,
        currency: group.currency,
        memberCount: group.memberships.length,
        expenseCount: group._count.expenses,
        members: group.memberships.map((m) => personDto(m.person)),
        unclaimedMembers: group.memberships
          .filter((m) => m.person.isGhost)
          .map((m) => personDto(m.person)),
      },
    });
  }

  const person = await prisma.person.findUnique({
    where: { inviteCode: normalized },
  });
  if (person && !person.isGhost) {
    return json({ kind: "person" as const, person: personDto(person) });
  }

  throw new NotFoundError("That code does not match a group or a person.");
});
