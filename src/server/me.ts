import { prisma } from "@/lib/db";
import type { DashboardDto, FriendDto, MeDto, PersonDto } from "@/lib/types";
import type { Person } from "@prisma/client";
import { directBalanceSheets, groupSummaries, personDto } from "./read";

export async function meDto(person: Person): Promise<MeDto> {
  const paymentMethods = await prisma.paymentMethod.findMany({
    where: { personId: person.id },
    orderBy: { sortOrder: "asc" },
  });

  return {
    ...personDto(person),
    defaultCurrency: person.defaultCurrency,
    inviteCode: person.inviteCode,
    createdAt: person.createdAt.toISOString(),
    paymentMethods: paymentMethods.map((m) => ({
      id: m.id,
      kind: m.kind,
      label: m.label,
      value: m.value,
      sortOrder: m.sortOrder,
    })),
  };
}

/**
 * The friends list.
 *
 * A "friend" is anyone you have connected with directly. Their balance is the
 * direct, non-group ledger only - group debts belong to the group, and rolling
 * the two together is how you end up telling someone they owe you money that is
 * actually the group's problem.
 */
export async function friendDtos(personId: string): Promise<FriendDto[]> {
  const friendships = await prisma.friendship.findMany({
    where: { OR: [{ personAId: personId }, { personBId: personId }] },
    include: { personA: true, personB: true },
  });

  if (friendships.length === 0) return [];

  const sheets = await directBalanceSheets(personId);

  const friends: FriendDto[] = [];
  for (const friendship of friendships) {
    const other =
      friendship.personAId === personId ? friendship.personB : friendship.personA;

    const net: Record<string, string> = {};
    for (const [currency, sheet] of sheets) {
      // The edge between exactly these two people, in this currency.
      const edge = sheet.pairwise.find(
        (e) =>
          (e.fromPersonId === personId && e.toPersonId === other.id) ||
          (e.fromPersonId === other.id && e.toPersonId === personId),
      );
      if (!edge) continue;
      const value = edge.toPersonId === personId ? edge.amount : -edge.amount;
      if (value !== 0n) net[currency] = value.toString();
    }

    const sharedGroups = await prisma.membership.findMany({
      where: {
        personId: other.id,
        leftAt: null,
        group: { memberships: { some: { personId, leftAt: null } } },
      },
      select: { groupId: true },
    });

    friends.push({
      person: personDto(other),
      net,
      sharedGroupIds: sharedGroups.map((g) => g.groupId),
      lastActivityAt: null,
    });
  }

  friends.sort((a, b) => {
    const aOwing = Object.keys(a.net).length > 0 ? 0 : 1;
    const bOwing = Object.keys(b.net).length > 0 ? 0 : 1;
    if (aOwing !== bOwing) return aOwing - bOwing;
    return a.person.displayName.localeCompare(b.person.displayName);
  });

  return friends;
}

export async function dashboardDto(person: Person): Promise<DashboardDto> {
  const [me, groups, friends] = await Promise.all([
    meDto(person),
    groupSummaries(person.id),
    friendDtos(person.id),
  ]);

  // Roll every group and direct balance into one figure per currency. Groups
  // contribute in their own settlement currency; direct balances in theirs.
  const totals = new Map<string, bigint>();
  const add = (code: string, value: bigint) => {
    if (value === 0n) return;
    totals.set(code, (totals.get(code) ?? 0n) + value);
  };

  for (const group of groups) {
    if (group.archivedAt) continue;
    add(group.currency, BigInt(group.yourNet));
  }
  for (const friend of friends) {
    for (const [code, value] of Object.entries(friend.net)) add(code, BigInt(value));
  }

  const unreadActivityCount = groups.reduce((total, g) => total + g.unreadCount, 0);

  return {
    me,
    totals: Object.fromEntries(
      [...totals].filter(([, value]) => value !== 0n).map(([code, value]) => [code, value.toString()]),
    ),
    groups,
    friends,
    unreadActivityCount,
  };
}

/**
 * Everyone the viewer can see, for rendering names and avatars anywhere in the
 * app without a lookup per row.
 */
export async function visiblePeople(personId: string): Promise<PersonDto[]> {
  const people = await prisma.person.findMany({
    where: {
      OR: [
        { id: personId },
        { memberships: { some: { group: { memberships: { some: { personId } } } } } },
        { friendshipsA: { some: { personBId: personId } } },
        { friendshipsB: { some: { personAId: personId } } },
      ],
    },
  });
  return people.map(personDto);
}
