import { prisma } from "@/lib/db";
import type {
  DashboardDto,
  FriendDto,
  MeDto,
  PersonDto,
  SharedLedgerDto,
} from "@/lib/types";
import type { Person } from "@/generated/prisma/client";
import {
  directBalanceSheets,
  directUnreadCount,
  groupMembershipsFor,
  groupSummaries,
  pairwiseNet,
  personDto,
  plannedNet,
} from "./read";
import { groupSheets } from "./ledger";
import type { BalanceSheet } from "@/lib/balances";
import { getRate } from "./rates";
import { convert } from "@/lib/money";
import { biggestFirst } from "@/lib/shared-ledgers";

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
 * Everyone still in one of `groupIds` (the viewer's groups), other than the
 * viewer. Who is in them first, then those people by id: asked in one go
 * ("people in a group that has me in it"), the database checked every person
 * on Divvy.
 */
async function coMembersOf(personId: string, groupIds: string[]) {
  const others = await prisma.membership.findMany({
    where: { groupId: { in: groupIds }, leftAt: null, personId: { not: personId } },
    select: { personId: true },
  });
  return prisma.person.findMany({
    where: { id: { in: [...new Set(others.map((m) => m.personId))] } },
  });
}

/**
 * The friends list.
 *
 * A "friend" is anyone you share a ledger with - somebody you added by code, or
 * somebody in a group with you - and the figure beside their name is where the
 * two of you stand *in total*: every group you share, plus the direct ledger,
 * kept per currency.
 *
 * Group members belong here even when nobody exchanged codes. Restricting the
 * list to the friendship table meant an account whose whole life was one flat
 * share opened Friends to "No friends added yet" while owing four people money,
 * and the person you most need to square up with is rarely the one you happened
 * to add directly.
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
async function friendDtos(
  personId: string,
  /** The viewer's groups, from the caller's own lookup of them. */
  groupIds: string[],
  /** The viewer's group sheets, computed once per request by the caller. */
  groupSheets: Map<string, BalanceSheet> | Promise<Map<string, BalanceSheet>>,
): Promise<FriendDto[]> {
  const [friendships, coMembers] = await Promise.all([
    prisma.friendship.findMany({
      where: { OR: [{ personAId: personId }, { personBId: personId }] },
      include: { personA: true, personB: true },
    }),
    coMembersOf(personId, groupIds),
  ]);

  // Union, because the two overlap: somebody added by code who then joined your
  // flat group is one person, not two rows.
  const byId = new Map<string, (typeof coMembers)[number]>();
  const directFriends = new Set<string>();
  for (const friendship of friendships) {
    const other = friendship.personAId === personId ? friendship.personB : friendship.personA;
    byId.set(other.id, other);
    directFriends.add(other.id);
  }
  for (const person of coMembers) byId.set(person.id, person);

  const others = [...byId.values()];
  if (others.length === 0) return [];

  const [sheets, sharedMemberships, sheetsByGroup] = await Promise.all([
    directBalanceSheets(personId),
    // One query for every friend's shared groups rather than one per friend.
    // The list is small on a phone and enormous on a housemate account that has
    // been running for two years, which is exactly the account that notices.
    prisma.membership.findMany({
      where: {
        personId: { in: others.map((other) => other.id) },
        leftAt: null,
        groupId: { in: groupIds },
      },
      select: {
        personId: true,
        groupId: true,
        group: { select: { currency: true, name: true, emoji: true, simplifyDebts: true } },
      },
    }),
    groupSheets,
  ]);

  const sharedByFriend = new Map<
    string,
    { groupId: string; currency: string; name: string; emoji: string; simplify: boolean }[]
  >();
  for (const membership of sharedMemberships) {
    const entry = {
      groupId: membership.groupId,
      currency: membership.group.currency,
      name: membership.group.name,
      emoji: membership.group.emoji,
      simplify: membership.group.simplifyDebts,
    };
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
    const ledgers: SharedLedgerDto[] = [];

    for (const [currency, sheet] of sheets) {
      const value = pairwiseNet(sheet, personId, other.id);
      if (value === 0n) continue;
      directNet[currency] = value.toString();
      combined.set(currency, (combined.get(currency) ?? 0n) + value);
      ledgers.push({
        groupId: null,
        name: null,
        emoji: null,
        currency,
        net: value.toString(),
        planned: null,
      });
    }

    for (const { groupId, currency, name, emoji, simplify } of shared) {
      const sheet = sheetsByGroup.get(groupId);
      if (!sheet) continue;
      const value = pairwiseNet(sheet, personId, other.id);
      if (value === 0n) continue;
      combined.set(currency, (combined.get(currency) ?? 0n) + value);
      ledgers.push({
        groupId,
        name,
        emoji,
        currency,
        net: value.toString(),
        planned: plannedNet(sheet, personId, other.id, simplify, value),
      });
    }

    ledgers.sort(biggestFirst);

    const net: Record<string, string> = {};
    for (const [currency, value] of combined) {
      // A group where they owe you can cancel one where you owe them exactly.
      if (value !== 0n) net[currency] = value.toString();
    }

    friends.push({
      person: personDto(other),
      net,
      directNet,
      ledgers,
      sharedGroupIds: shared.map((entry) => entry.groupId),
      isFriend: directFriends.has(other.id),
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
  const seenAt = person.activitySeenAt ?? null;
  // Your groups are looked up once, and their sheets folded once, then handed
  // to both lists: the group list and the friends list ask different
  // questions of the same rows. Everything that doesn't need them starts
  // straight away rather than waiting for the sheets.
  const memberships = groupMembershipsFor(person.id);
  const groupIds = memberships.then((rows) => rows.map((row) => row.groupId));
  const sheets = groupIds.then(groupSheets);
  // Either list can finish without reading the sheets (no groups, nobody to
  // list), which would leave a failure there unhandled. One that matters still
  // reaches the caller through the list that reads them.
  sheets.catch(() => {});

  const [me, groups, friends, directUnread] = await Promise.all([
    meDto(person),
    memberships.then((rows) => groupSummaries(person.id, { memberships: rows, sheets, seenAt })),
    groupIds.then((ids) => friendDtos(person.id, ids, sheets)),
    directUnreadCount(person.id, seenAt),
  ]);

  // Roll every group and direct balance into one figure per currency. Groups
  // contribute in their own settlement currency; direct balances in theirs.
  const totals = new Map<string, bigint>();
  const add = (code: string, value: bigint) => {
    if (value === 0n) return;
    totals.set(code, (totals.get(code) ?? 0n) + value);
  };

  // Archived groups count too. Archiving hides a group from the list; it
  // does not settle it, and leaving its balance out made money that was still
  // owed vanish from the headline while the Friends page went on showing it.
  for (const group of groups) {
    add(group.currency, BigInt(group.yourNet));
  }
  // `directNet`, not `net`: a friend's headline figure now includes their share
  // of every group you share, and those groups are already in the loop above.
  // Adding the combined figure here would count every group debt twice.
  for (const friend of friends) {
    for (const [code, value] of Object.entries(friend.directNet)) add(code, BigInt(value));
  }

  // Group entries plus those outside any group, on the same rule as the feed's
  // dots, so the badge and the feed always agree.
  const unreadActivityCount =
    groups.reduce((total, g) => total + g.unreadCount, 0) + directUnread;

  // With balances in more than one currency, a rough single figure in the
  // person's own currency, so they can tell at a glance whether they are up or
  // down overall. Today's rate; left out if any rate is unavailable rather
  // than showing a total that silently skips a currency.
  let approxTotal: { currency: string; amount: string } | null = null;
  const live = [...totals].filter(([, value]) => value !== 0n);
  if (live.length > 1) {
    const target = person.defaultCurrency;
    const parts = await Promise.all(
      live.map(async ([code, value]) => {
        if (code === target) return value;
        const found = await getRate(code, target).catch(() => null);
        return found ? convert(value, code, target, found.rate) : null;
      }),
    );
    if (parts.every((part) => part !== null)) {
      approxTotal = { currency: target, amount: parts.reduce((t: bigint, v) => t + (v ?? 0n), 0n).toString() };
    }
  }

  return {
    me,
    totals: Object.fromEntries(
      live.map(([code, value]) => [code, value.toString()]),
    ),
    approxTotal,
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
  // You, everyone in a group you are or were in (whether or not they have
  // left it), and your friends. Collected as ids first: asked as one question
  // about every person, the database checked all of them.
  const [mine, friendships] = await Promise.all([
    prisma.membership.findMany({ where: { personId }, select: { groupId: true } }),
    prisma.friendship.findMany({
      where: { OR: [{ personAId: personId }, { personBId: personId }] },
      select: { personAId: true, personBId: true },
    }),
  ]);
  const inGroups = await prisma.membership.findMany({
    where: { groupId: { in: mine.map((m) => m.groupId) } },
    select: { personId: true },
  });
  const ids = new Set([
    personId,
    ...inGroups.map((m) => m.personId),
    ...friendships.flatMap((f) => [f.personAId, f.personBId]),
  ]);
  const people = await prisma.person.findMany({ where: { id: { in: [...ids] } } });
  return people.map(personDto);
}
