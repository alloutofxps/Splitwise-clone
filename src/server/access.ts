import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/identity";
import type { Group, Membership } from "@prisma/client";

/**
 * Access control, such as it is.
 *
 * Membership is the only permission concept: if you are in a group you can see
 * and edit everything in it, including expenses somebody else entered. That
 * matches how the app is actually used - four friends on a trip fixing each
 * other's typos - and every edit is written to the activity feed, so the
 * safeguard is visibility rather than restriction.
 *
 * The one asymmetry is destructive group-level actions (deleting the group,
 * removing a member), which stay with whoever created it.
 */

export interface GroupAccess {
  group: Group;
  membership: Membership;
  isOwner: boolean;
}

export async function requireGroupAccess(
  groupId: string,
  personId: string,
): Promise<GroupAccess> {
  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) throw new NotFoundError("That group no longer exists.");

  const membership = await prisma.membership.findUnique({
    where: { groupId_personId: { groupId, personId } },
  });
  if (!membership || membership.leftAt) {
    throw new ForbiddenError("You are not a member of that group.");
  }

  return { group, membership, isOwner: membership.role === "owner" };
}

export async function requireGroupOwner(
  groupId: string,
  personId: string,
): Promise<GroupAccess> {
  const access = await requireGroupAccess(groupId, personId);
  if (!access.isOwner) {
    throw new ForbiddenError("Only whoever created the group can do that.");
  }
  return access;
}

/** Active member ids, in a stable order for deterministic splits. */
export async function groupMemberIds(groupId: string): Promise<string[]> {
  const memberships = await prisma.membership.findMany({
    where: { groupId, leftAt: null },
    select: { personId: true },
    orderBy: { joinedAt: "asc" },
  });
  return memberships.map((m) => m.personId);
}

/**
 * Checks the caller may file an expense against a set of people.
 *
 * In a group: everyone must be a member. Outside a group: everyone must be the
 * caller or one of their friends, which stops a stranger with a person id from
 * attaching debts to someone who never agreed to it.
 */
export async function assertCanInvolve(
  personIds: string[],
  actorId: string,
  groupId: string | null,
): Promise<void> {
  const unique = [...new Set(personIds)];
  if (unique.length === 0) throw new ForbiddenError("Nobody was included.");

  if (groupId) {
    const members = new Set(await groupMemberIds(groupId));
    const outsiders = unique.filter((id) => !members.has(id));
    if (outsiders.length > 0) {
      throw new ForbiddenError("Somebody in that split is not in the group.");
    }
    return;
  }

  const others = unique.filter((id) => id !== actorId);
  if (others.length === 0) return;

  const friendships = await prisma.friendship.findMany({
    where: {
      OR: others.flatMap((id) => [
        { personAId: actorId, personBId: id },
        { personAId: id, personBId: actorId },
      ]),
    },
  });

  const connected = new Set(
    friendships.flatMap((f) => [f.personAId, f.personBId]).filter((id) => id !== actorId),
  );
  const strangers = others.filter((id) => !connected.has(id));
  if (strangers.length > 0) {
    throw new ForbiddenError("You can only split directly with people you have added.");
  }
}

/** Canonical friendship ordering, so a pair only ever has one row. */
export function friendshipPair(a: string, b: string): { personAId: string; personBId: string } {
  return a < b ? { personAId: a, personBId: b } : { personAId: b, personBId: a };
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const found = await prisma.friendship.findUnique({
    where: { personAId_personBId: friendshipPair(a, b) },
  });
  return Boolean(found);
}
