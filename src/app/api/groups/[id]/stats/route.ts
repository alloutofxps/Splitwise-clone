import { json, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";
import { EXPENSE_INCLUDE, convertedBreakdown, expenseDto } from "@/server/read";
import { DEFAULT_CATEGORY_ID } from "@/lib/categories";
import type { CategoryTotalDto, GroupStatsDto, MonthTotalDto } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

/**
 * Spending analytics for a group.
 *
 * Everything is reported in the group's settlement currency using each
 * expense's converted amount, so a trip that mixed euros and forints still adds
 * up to one comparable total.
 *
 * Two numbers per bucket, deliberately: the group's total spend and *your*
 * share of it. "We spent 2,400 on food" and "I spent 600 on food" are different
 * questions and people ask both.
 */
export const GET = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  const { group } = await requireGroupAccess(id, session.person.id);
  const viewerId = session.person.id;

  const expenses = await prisma.expense.findMany({
    where: { groupId: id, deletedAt: null },
    include: EXPENSE_INCLUDE,
    orderBy: { date: "asc" },
  });

  const byCategory = new Map<string, { total: bigint; yourShare: bigint; count: number }>();
  const byMonth = new Map<string, { total: bigint; yourShare: bigint }>();
  const byPerson = new Map<string, { paid: bigint; share: bigint }>();

  let totalSpend = 0n;
  let yourTotalShare = 0n;
  let yourTotalPaid = 0n;
  let largest: (typeof expenses)[number] | null = null;

  for (const expense of expenses) {
    const { paid, owed } = convertedBreakdown(expense);
    const amount = expense.convertedAmount;
    totalSpend += amount;

    const yourShare = owed
      .filter((o) => o.personId === viewerId)
      .reduce((total, o) => total + o.amount, 0n);
    const yourPaid = paid
      .filter((p) => p.personId === viewerId)
      .reduce((total, p) => total + p.amount, 0n);

    yourTotalShare += yourShare;
    yourTotalPaid += yourPaid;

    const categoryId = expense.categoryId ?? DEFAULT_CATEGORY_ID;
    const category = byCategory.get(categoryId) ?? { total: 0n, yourShare: 0n, count: 0 };
    category.total += amount;
    category.yourShare += yourShare;
    category.count += 1;
    byCategory.set(categoryId, category);

    const month = expense.date.toISOString().slice(0, 7);
    const monthEntry = byMonth.get(month) ?? { total: 0n, yourShare: 0n };
    monthEntry.total += amount;
    monthEntry.yourShare += yourShare;
    byMonth.set(month, monthEntry);

    for (const p of paid) {
      const person = byPerson.get(p.personId) ?? { paid: 0n, share: 0n };
      person.paid += p.amount;
      byPerson.set(p.personId, person);
    }
    for (const o of owed) {
      const person = byPerson.get(o.personId) ?? { paid: 0n, share: 0n };
      person.share += o.amount;
      byPerson.set(o.personId, person);
    }

    if (!largest || amount > largest.convertedAmount) largest = expense;
  }

  const categoryTotals: CategoryTotalDto[] = [...byCategory]
    .map(([categoryId, value]) => ({
      categoryId,
      total: value.total.toString(),
      yourShare: value.yourShare.toString(),
      count: value.count,
    }))
    .sort((a, b) => (BigInt(a.total) > BigInt(b.total) ? -1 : 1));

  // Fill gaps so a quiet month renders as a zero rather than vanishing and
  // making the trend line lie about its shape.
  const monthTotals: MonthTotalDto[] = fillMonthGaps(byMonth);

  const stats: GroupStatsDto = {
    currency: group.currency,
    totalSpend: totalSpend.toString(),
    yourTotalShare: yourTotalShare.toString(),
    yourTotalPaid: yourTotalPaid.toString(),
    expenseCount: expenses.length,
    byCategory: categoryTotals,
    byMonth: monthTotals,
    byPerson: [...byPerson].map(([personId, value]) => ({
      personId,
      paid: value.paid.toString(),
      share: value.share.toString(),
    })),
    largestExpense: largest ? expenseDto(largest, viewerId) : null,
    averageExpense:
      expenses.length > 0 ? (totalSpend / BigInt(expenses.length)).toString() : "0",
  };

  return json({ stats });
});

function fillMonthGaps(
  byMonth: Map<string, { total: bigint; yourShare: bigint }>,
): MonthTotalDto[] {
  const keys = [...byMonth.keys()].sort();
  if (keys.length === 0) return [];

  const result: MonthTotalDto[] = [];
  const [startYear, startMonth] = keys[0].split("-").map(Number);
  const [endYear, endMonth] = keys[keys.length - 1].split("-").map(Number);

  const cursor = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const end = new Date(Date.UTC(endYear, endMonth - 1, 1));

  // Guard against a pathological range (a typo'd date decades out) turning
  // into a chart with ten thousand points.
  let guard = 0;
  while (cursor <= end && guard++ < 600) {
    const key = cursor.toISOString().slice(0, 7);
    const entry = byMonth.get(key);
    result.push({
      month: key,
      total: (entry?.total ?? 0n).toString(),
      yourShare: (entry?.yourShare ?? 0n).toString(),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}
