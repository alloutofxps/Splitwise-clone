import { prisma } from "@/lib/db";
import type { DashboardDto, FriendDto, MeDto, PersonDto } from "@/lib/types";
import type { Person } from "@prisma/client";
import {
  directBalanceSheets,
  groupSheetsFor,
  groupSummaries,
  pairwiseNet,
  personDto,
} from "./read";
import type { BalanceSheet } from "@/lib/balances";

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
 * A "friend" is anyone you have connected with directly, and the figure beside
 * their name is where the two of you stand *in total* - every group you share,
 * plus the direct ledger, kept per currency.
 *
 * It used to be the direct ledger alone, on the reasoning that group debts
 * belong to the group. That is right about where a debt is *settled* and wrong
 * about what this screen is for. The friends list is the answer to "how do I
 * stand with this person", and scoping it to the direct ledger made it report
 * "settled up" for somebody who owed two thousand euros in the only group the
 * two of them shared - which is not a nuance, it is the opposite of the truth.
 *
 * `directNet` keeps the old figure, because settling is still per-ledger and
 * the detail view has to be able to say which part of the total lives where.
 */
export async function friendDtos(
  personId: string,
  /** The viewer's group sheets, computed once per request by the caller. */
  groupSheets?: Map<string, BalanceSheet>,
): Promise<FriendDto[]> {
  const friendships = await prisma.friendship.findMany({
    where: { OR: [{ personAId: personId }, { personBId: personId }] },
    include: { personA: true, personB: true },
  });

  if (friendships.length === 0) return [];

  const others = friendships.map((friendship) =>
    friendship.personAId === personId ? friendship.personB : friendship.personA,
  );

  const [sheets, sharedMemberships, sheetsByGroup] = await Promise.all([
    directBalanceSheets(personId),
    // One query for every friend's shared groups rather than one per friend.
    // The list is small on a phone and enormous on a housemate account that has
    // been running for two years, which is exactly the account that notices.
    prisma.membership.findMany({
      where: {
        personId: { in: others.map((other) => other.id) },
        leftAt: null,
        group: { memberships: { some: { personId, leftAt: null } } },
      },
      select: { personId: true, groupId: true, group: { select: { currency: true } } },
    }),
    groupSheets ? Promise.resolve(groupSheets) : groupSheetsFor(personId),
  ]);

  const sharedByFriend = new Map<string, { groupId: string; currency: string }[]>();
  for (const membership of sharedMemberships) {
    const entry = { groupId: membership.groupId, currency: membership.group.currency };
    const list = sharedByFriend.get(membership.personId);
    if (list) list.push(entry);
    else sharedByFriend.set(membership.personId, [entry]);
  }

  const friends: FriendDto[] = [];
  for (const other of others) {
    const shared = sharedByFriend.get(other.id) ?? [];

    // Per currency throughout: a group contributes in its own settlement
    // currency, and adding a euro to a rupee would be a number nobody could
    // reconcile against anything.
    const combined = new Map<string, bigint>();
    const directNet: Record<string, string> = {};

    for (const [currency, sheet] of sheets) {
      const value = pairwiseNet(sheet, personId, other.id);
      if (value === 0n) continue;
      directNet[currency] = value.toString();
      combined.set(currency, (combined.get(currency) ?? 0n) + value);
    }

    for (const { groupId, currency } of shared) {
      const sheet = sheetsByGroup.get(groupId);
      if (!sheet) continue;
      const value = pairwiseNet(sheet, personId, other.id);
      if (value === 0n) continue;
      combined.set(currency, (combined.get(currency) ?? 0n) + value);
    }

    const net: Record<string, string> = {};
    for (const [currency, value] of combined) {
      // A group where they owe you can cancel one where you owe them exactly.
      if (value !== 0n) net[currency] = value.toString();
    }

    friends.push({
      person: personDto(other),
      net,
      directNet,
      sharedGroupIds: shared.map((entry) => entry.groupId),
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
  // Folded once and handed to both: the group list and the friends list ask
  // different questions of the same sheets, and computing them twice doubles
  // the queries over identical rows.
  const groupSheets = await groupSheetsFor(person.id);

  const [me, groups, friends] = await Promise.all([
    meDto(person),
    groupSummaries(person.id, groupSheets),
    friendDtos(person.id, groupSheets),
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
  // `directNet`, not `net`: a friend's headline figure now includes their share
  // of every group you share, and those groups are already in the loop above.
  // Adding the combined figure here would count every group debt twice.
  for (const friend of friends) {
    for (const [code, value] of Object.entries(friend.directNet)) add(code, BigInt(value));
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
