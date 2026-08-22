/**
 * Read-side services: everything that turns database rows into the shapes the
 * client renders.
 *
 * The subtle piece is currency. An expense is stored in whatever currency it
 * was paid in, plus `convertedAmount` in the group's currency. Balances have to
 * be computed in the group currency, which means every payer and split has to
 * be converted too - and the converted parts must still sum to exactly
 * `convertedAmount`. Converting each part independently would not guarantee
 * that, so instead the converted total is *apportioned* across the parts using
 * their original amounts as weights. That is exact by construction.
 */

import { prisma } from "@/lib/db";
import { computeBalances, type BalanceEvent, type BalanceSheet } from "@/lib/balances";
import { convertedBreakdown } from "@/lib/split";
import { DEFAULT_CATEGORY_ID } from "@/lib/categories";
import type {
  ActivityDto,
  AttachmentDto,
  BalanceSheetDto,
  CommentDto,
  ExpenseDto,
  GroupSummaryDto,
  PersonDto,
  SettlementDto,
  SplitMode,
} from "@/lib/types";
import type { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Query shapes
// ---------------------------------------------------------------------------

const expenseInclude = {
  payers: true,
  splits: true,
  items: { include: { shares: true }, orderBy: { sortOrder: "asc" } },
  attachments: {
    select: {
      id: true,
      filename: true,
      mimeType: true,
      size: true,
      width: true,
      height: true,
    },
  },
  _count: { select: { comments: true } },
} satisfies Prisma.ExpenseInclude;

type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;

export const EXPENSE_INCLUDE = expenseInclude;

// Re-exported because two route handlers import it from here. The definition
// moved to `lib/split` so the client can compute an optimistic balance with the
// same arithmetic the server uses.
export { convertedBreakdown, type ConvertedBreakdown } from "@/lib/split";

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

/** Loads every expense and settlement in a group and folds them into a sheet. */
export async function groupBalanceSheet(groupId: string): Promise<BalanceSheet> {
  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: { groupId, deletedAt: null },
      select: {
        id: true,
        convertedAmount: true,
        payers: { select: { personId: true, amount: true } },
        splits: { select: { personId: true, amount: true } },
      },
    }),
    prisma.settlement.findMany({
      where: { groupId, deletedAt: null },
      select: {
        id: true,
        fromPersonId: true,
        toPersonId: true,
        convertedAmount: true,
      },
    }),
  ]);

  const events: BalanceEvent[] = [];
  for (const expense of expenses) {
    const { paid, owed } = convertedBreakdown(expense);
    events.push({ kind: "expense", id: expense.id, paid, owed });
  }
  for (const settlement of settlements) {
    events.push({
      kind: "settlement",
      id: settlement.id,
      fromPersonId: settlement.fromPersonId,
      toPersonId: settlement.toPersonId,
      amount: settlement.convertedAmount,
    });
  }

  return computeBalances(events);
}

/**
 * Direct (non-group) balances between the viewer and everyone they have added.
 *
 * Bucketed by currency: two friends have no agreed settlement currency, so
 * "you owe Ravi 30 EUR and he owes you 400 INR" is the honest answer rather
 * than a made-up conversion.
 */
export async function directBalanceSheets(
  personId: string,
): Promise<Map<string, BalanceSheet>> {
  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: {
        groupId: null,
        deletedAt: null,
        OR: [{ payers: { some: { personId } } }, { splits: { some: { personId } } }],
      },
      select: {
        id: true,
        currency: true,
        amount: true,
        payers: { select: { personId: true, amount: true } },
        splits: { select: { personId: true, amount: true } },
      },
    }),
    prisma.settlement.findMany({
      where: {
        groupId: null,
        deletedAt: null,
        OR: [{ fromPersonId: personId }, { toPersonId: personId }],
      },
      select: {
        id: true,
        currency: true,
        amount: true,
        fromPersonId: true,
        toPersonId: true,
      },
    }),
  ]);

  const byCurrency = new Map<string, BalanceEvent[]>();
  const push = (currency: string, event: BalanceEvent) => {
    const list = byCurrency.get(currency) ?? [];
    list.push(event);
    byCurrency.set(currency, list);
  };

  for (const expense of expenses) {
    push(expense.currency, {
      kind: "expense",
      id: expense.id,
      paid: expense.payers.map((p) => ({ personId: p.personId, amount: p.amount })),
      owed: expense.splits
        .filter((s) => s.amount !== 0n)
        .map((s) => ({ personId: s.personId, amount: s.amount })),
    });
  }
  for (const settlement of settlements) {
    push(settlement.currency, {
      kind: "settlement",
      id: settlement.id,
      fromPersonId: settlement.fromPersonId,
      toPersonId: settlement.toPersonId,
      amount: settlement.amount,
    });
  }

  const sheets = new Map<string, BalanceSheet>();
  for (const [currency, events] of byCurrency) {
    sheets.set(currency, computeBalances(events));
  }
  return sheets;
}

// ---------------------------------------------------------------------------
// DTO shaping
// ---------------------------------------------------------------------------

export function personDto(person: {
  id: string;
  displayName: string;
  avatarColor: string;
  avatarEmoji: string | null;
  isGhost: boolean;
}): PersonDto {
  return {
    id: person.id,
    displayName: person.displayName,
    avatarColor: person.avatarColor,
    avatarEmoji: person.avatarEmoji,
    isGhost: person.isGhost,
  };
}

export function balanceSheetDto(sheet: BalanceSheet, currency: string): BalanceSheetDto {
  return {
    currency,
    net: Object.fromEntries([...sheet.net].map(([id, value]) => [id, value.toString()])),
    pairwise: sheet.pairwise.map((e) => ({
      fromPersonId: e.fromPersonId,
      toPersonId: e.toPersonId,
      amount: e.amount.toString(),
    })),
    simplified: sheet.simplified.map((e) => ({
      fromPersonId: e.fromPersonId,
      toPersonId: e.toPersonId,
      amount: e.amount.toString(),
    })),
    totalSpend: sheet.totalSpend.toString(),
  };
}

export function attachmentDto(row: {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
}): AttachmentDto {
  return { ...row, url: `/api/attachments/${row.id}` };
}

/**
 * Shapes an expense for the client, including the two numbers the UI leads
 * with: the viewer's share, and whether they came out ahead or behind on it.
 */
export function expenseDto(expense: ExpenseRow, viewerId: string): ExpenseDto {
  const paid = expense.payers
    .filter((p) => p.personId === viewerId)
    .reduce((total, p) => total + p.amount, 0n);
  const share = expense.splits
    .filter((s) => s.personId === viewerId)
    .reduce((total, s) => total + s.amount, 0n);

  return {
    id: expense.id,
    groupId: expense.groupId,
    description: expense.description,
    notes: expense.notes,
    amount: expense.amount.toString(),
    currency: expense.currency,
    exchangeRate: expense.exchangeRate,
    convertedAmount: expense.convertedAmount.toString(),
    splitMode: expense.splitMode as SplitMode,
    categoryId: expense.categoryId ?? DEFAULT_CATEGORY_ID,
    date: expense.date.toISOString(),
    createdByPersonId: expense.createdByPersonId,
    recurrenceId: expense.recurrenceId,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
    payers: expense.payers.map((p) => ({
      personId: p.personId,
      amount: p.amount.toString(),
    })),
    splits: expense.splits.map((s) => ({
      personId: s.personId,
      amount: s.amount.toString(),
      included: s.included,
      weight: s.weight,
      percent: s.percent,
      adjustment: s.adjustment === null ? null : s.adjustment.toString(),
    })),
    items: expense.items.map((item) => ({
      id: item.id,
      name: item.name,
      amount: item.amount.toString(),
      quantity: item.quantity,
      sortOrder: item.sortOrder,
      participantIds: item.shares.map((s) => s.personId),
    })),
    attachments: expense.attachments.map(attachmentDto),
    commentCount: expense._count.comments,
    yourShare: share.toString(),
    yourNet: (paid - share).toString(),
  };
}

export function settlementDto(row: {
  id: string;
  groupId: string | null;
  fromPersonId: string;
  toPersonId: string;
  amount: bigint;
  currency: string;
  convertedAmount: bigint;
  date: Date;
  note: string | null;
  method: string | null;
  createdByPersonId: string;
  createdAt: Date;
}): SettlementDto {
  return {
    id: row.id,
    groupId: row.groupId,
    fromPersonId: row.fromPersonId,
    toPersonId: row.toPersonId,
    amount: row.amount.toString(),
    currency: row.currency,
    convertedAmount: row.convertedAmount.toString(),
    date: row.date.toISOString(),
    note: row.note,
    method: row.method,
    createdByPersonId: row.createdByPersonId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function commentDto(row: {
  id: string;
  expenseId: string;
  personId: string;
  body: string;
  createdAt: Date;
}): CommentDto {
  return {
    id: row.id,
    expenseId: row.expenseId,
    personId: row.personId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

export function activityDto(
  row: {
    id: string;
    groupId: string | null;
    type: string;
    actorPersonId: string;
    expenseId: string | null;
    settlementId: string | null;
    data: string;
    createdAt: Date;
    group?: { name: string; emoji: string } | null;
  },
  lastReadAt: Date | null,
): ActivityDto {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    // A malformed payload should degrade to a bare entry, not break the feed.
    data = {};
  }

  return {
    id: row.id,
    groupId: row.groupId,
    groupName: row.group?.name ?? (data.groupName as string) ?? null,
    groupEmoji: row.group?.emoji ?? null,
    type: row.type,
    actorPersonId: row.actorPersonId,
    expenseId: row.expenseId,
    settlementId: row.settlementId,
    data,
    createdAt: row.createdAt.toISOString(),
    isUnread: lastReadAt ? row.createdAt > lastReadAt : true,
  };
}

// ---------------------------------------------------------------------------
// Group summaries
// ---------------------------------------------------------------------------

/**
 * Builds the home-screen card for each of a person's groups.
 *
 * Deliberately batched: a naive version issues four queries per group, which is
 * fine for three groups and miserable for thirty.
 */
export async function groupSummaries(personId: string): Promise<GroupSummaryDto[]> {
  const memberships = await prisma.membership.findMany({
    where: { personId, leftAt: null },
    include: {
      group: {
        include: {
          memberships: {
            where: { leftAt: null },
            include: { person: true },
            orderBy: { joinedAt: "asc" },
          },
        },
      },
    },
  });

  const groupIds = memberships.map((m) => m.groupId);
  if (groupIds.length === 0) return [];

  const [latestActivity, unread] = await Promise.all([
    prisma.activity.groupBy({
      by: ["groupId"],
      where: { groupId: { in: groupIds } },
      _max: { createdAt: true },
    }),
    // Every group has its own read cursor, so this cannot be a single `count`
    // with one cutoff - but it does not need a query per group either. The OR
    // carries each group's cutoff as its own branch, and the groupBy collapses
    // the whole thing into one row per group.
    prisma.activity.groupBy({
      by: ["groupId"],
      where: {
        actorPersonId: { not: personId },
        OR: memberships.map((membership) => ({
          groupId: membership.groupId,
          createdAt: { gt: membership.lastReadActivityAt },
        })),
      },
      _count: { _all: true },
    }),
  ]);

  const lastActivityByGroup = new Map(
    latestActivity.map((row) => [row.groupId, row._max.createdAt]),
  );
  // A group with nothing unread produces no row at all, hence the ?? 0 below.
  const unreadByGroup = new Map(unread.map((row) => [row.groupId, row._count._all]));

  const sheets = await Promise.all(groupIds.map((id) => groupBalanceSheet(id)));

  return memberships.map((membership, index) => {
    const group = membership.group;
    const sheet = sheets[index];
    return {
      id: group.id,
      name: group.name,
      kind: group.kind,
      emoji: group.emoji,
      color: group.color,
      currency: group.currency,
      simplifyDebts: group.simplifyDebts,
      inviteCode: group.inviteCodeActive ? group.inviteCode : "",
      archivedAt: group.archivedAt?.toISOString() ?? null,
      memberCount: group.memberships.length,
      members: group.memberships.map((m) => personDto(m.person)),
      yourNet: (sheet.net.get(personId) ?? 0n).toString(),
      totalSpend: sheet.totalSpend.toString(),
      lastActivityAt: lastActivityByGroup.get(group.id)?.toISOString() ?? null,
      unreadCount: unreadByGroup.get(group.id) ?? 0,
    };
  });
}
