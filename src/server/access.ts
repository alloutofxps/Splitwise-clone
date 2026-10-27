import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { Prisma, type Group, type Membership } from "@/generated/prisma/client";

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

/**
 * Every column of a group and of a membership, listed by hand so the access
 * check can ask for both in one question. Prisma asks two, one after the
 * other, even when told to include one in the other, and this check runs on
 * every group request.
 *
 * `satisfies` fails the type check, and `access.test.ts` fails, when either
 * table gains or loses a column and these lists aren't updated to match.
 */
export const GROUP_COLUMNS = {
  id: true,
  name: true,
  kind: true,
  emoji: true,
  color: true,
  currency: true,
  simplifyDebts: true,
  defaultSplit: true,
  inviteCode: true,
  inviteCodeActive: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  ledgerVersion: true,
} satisfies Record<keyof Group, true>;

export const MEMBERSHIP_COLUMNS = {
  id: true,
  groupId: true,
  personId: true,
  role: true,
  nickname: true,
  joinedAt: true,
  leftAt: true,
  lastReadActivityAt: true,
} satisfies Record<keyof Membership, true>;

/** `g."id" AS "g_id", ...`: each column under its table's prefix. */
function columns(table: "g" | "m", list: Record<string, true>) {
  return Prisma.raw(Object.keys(list).map((name) => `${table}."${name}" AS "${table}_${name}"`).join(", "));
}

/** The columns under one prefix, with the prefix taken off. */
function unprefix(row: Record<string, unknown>, table: "g" | "m", list: Record<string, true>) {
  return Object.fromEntries(Object.keys(list).map((name) => [name, row[`${table}_${name}`]]));
}

/**
 * Splits the one row the access question returns back into the group and your
 * membership. No row: the group doesn't exist. No membership id: you were never
 * in it. Exported for its test.
 */
export function readAccessRow(row: Record<string, unknown> | undefined): {
  group: Group | null;
  membership: Membership | null;
} {
  if (!row) return { group: null, membership: null };
  const group = unprefix(row, "g", GROUP_COLUMNS) as Group;
  const membership = row.m_id == null ? null : (unprefix(row, "m", MEMBERSHIP_COLUMNS) as Membership);
  return { group, membership };
}

export async function requireGroupAccess(
  groupId: string,
  personId: string,
): Promise<GroupAccess> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT ${columns("g", GROUP_COLUMNS)}, ${columns("m", MEMBERSHIP_COLUMNS)}
    FROM "Group" g
    LEFT JOIN "Membership" m ON m."groupId" = g."id" AND m."personId" = ${personId}
    WHERE g."id" = ${groupId}`;
  const { group, membership } = readAccessRow(rows[0]);
  if (!group) throw new NotFoundError("That group no longer exists.");
  if (!membership || membership.leftAt) {
    throw new ForbiddenError("You're not in that group.");
  }

  return { group, membership, isOwner: membership.role === "owner" };
}

export async function requireGroupOwner(
  groupId: string,
  personId: string,
): Promise<GroupAccess> {
  const access = await requireGroupAccess(groupId, personId);
  if (!access.isOwner) {
    throw new ForbiddenError("Only the person who made the group can do that.");
  }
  return access;
}

/** Active member ids, in a stable order for deterministic splits. */
async function groupMemberIds(groupId: string): Promise<string[]> {
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
  /**
   * People already on the expense being edited. They stay allowed after they
   * leave the group, or no old expense involving them could ever be corrected.
   */
  alreadyInvolved: string[] = [],
): Promise<void> {
  const unique = [...new Set(personIds)];
  if (unique.length === 0) throw new ForbiddenError("Nobody was included.");
  const grandfathered = new Set(alreadyInvolved);

  if (groupId) {
    const members = new Set(await groupMemberIds(groupId));
    const outsiders = unique.filter((id) => !members.has(id) && !grandfathered.has(id));
    if (outsiders.length > 0) {
      throw new ForbiddenError("Someone in that split isn't in the group.");
    }
    return;
  }

  const others = unique.filter((id) => id !== actorId && !grandfathered.has(id));
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
    throw new ForbiddenError("You can only split with friends you've added.");
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

/**
 * Whether two people are in at least one group together.
 *
 * A shared group is its own kind of connection: you can already see the
 * person's name, avatar and balance on every screen the group renders, so
 * gating a person-level view behind a separate friendship would hide a figure
 * the app is already showing — and it is exactly the people you share several
 * groups with, and never added directly, whose balances most need adding up.
 */
export async function sharesAGroup(a: string, b: string): Promise<boolean> {
  const group = await prisma.group.findFirst({
    where: {
      AND: [
        { memberships: { some: { personId: a, leftAt: null } } },
        { memberships: { some: { personId: b, leftAt: null } } },
      ],
    },
    select: { id: true },
  });
  return group !== null;
}

/**
 * Whether this person may see, and act on, one settlement row.
 *
 * A payment inside a group belongs to that group's ledger, so membership is
 * the test. A direct payment between two people belongs to the two of them.
 *
 * Kept here rather than inline at the call sites because the rule is used by
 * both the delete and the restore, and the two drifting apart is precisely how
 * a route ends up answering a request it should have refused.
 */
export async function requireSettlementAccess(
  settlement: { groupId: string | null; fromPersonId: string; toPersonId: string },
  personId: string,
): Promise<void> {
  if (settlement.groupId) {
    await requireGroupAccess(settlement.groupId, personId);
    return;
  }
  if (settlement.fromPersonId !== personId && settlement.toPersonId !== personId) {
    throw new ForbiddenError("You can't change that payment.");
  }
}
