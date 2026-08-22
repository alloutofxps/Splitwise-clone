import { z } from "zod";
import { currencyCode, json, minorUnits, readBody, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { CATEGORY_BY_ID } from "@/lib/categories";
import { convertedBreakdown } from "@/server/read";
import type { BudgetDto } from "@/lib/types";

const schema = z.object({
  groupId: z.string().nullable().optional(),
  categoryId: z.string().max(40).nullable().optional(),
  amount: minorUnits("The budget"),
  currency: currencyCode,
  period: z.enum(["WEEKLY", "MONTHLY", "YEARLY"]).default("MONTHLY"),
});

/**
 * Personal spending budgets.
 *
 * Tracked against *your share* of expenses, not the group's total: a budget is
 * a statement about your own money, and fronting the group's 400 hotel bill
 * should not blow up your accommodation budget when you are only in for 100.
 */
export const GET = route(async () => {
  const session = await requireSession();
  const personId = session.person.id;

  const budgets = await prisma.budget.findMany({ where: { personId } });
  if (budgets.length === 0) return json({ budgets: [] });

  const earliest = budgets
    .map((b) => periodStart(b.period, new Date()))
    .reduce((a, b) => (a < b ? a : b));

  const expenses = await prisma.expense.findMany({
    where: {
      deletedAt: null,
      date: { gte: earliest },
      splits: { some: { personId } },
    },
    select: {
      groupId: true,
      categoryId: true,
      date: true,
      currency: true,
      convertedAmount: true,
      payers: { select: { personId: true, amount: true } },
      splits: { select: { personId: true, amount: true } },
      group: { select: { currency: true } },
    },
  });

  const result: BudgetDto[] = budgets.map((budget) => {
    const start = periodStart(budget.period, new Date());
    let spent = 0n;

    for (const expense of expenses) {
      if (expense.date < start) continue;
      if (budget.groupId && expense.groupId !== budget.groupId) continue;
      if (budget.categoryId && expense.categoryId !== budget.categoryId) continue;

      // Only count expenses already denominated in the budget's currency.
      // Converting across a whole history with today's rate would report a
      // number that silently changes every time the market moves.
      const expenseCurrency = expense.group?.currency ?? expense.currency;
      if (expenseCurrency !== budget.currency) continue;

      const { owed } = convertedBreakdown(expense);
      spent += owed
        .filter((o) => o.personId === personId)
        .reduce((total, o) => total + o.amount, 0n);
    }

    return {
      id: budget.id,
      groupId: budget.groupId,
      categoryId: budget.categoryId,
      amount: budget.amount.toString(),
      currency: budget.currency,
      period: budget.period as BudgetDto["period"],
      spent: spent.toString(),
    };
  });

  return json({ budgets: result });
});

/** Creates or replaces a budget. Setting the amount to zero removes it. */
export const PUT = route(async (request: Request) => {
  const session = await requireSession();
  const input = await readBody(request, schema);

  const categoryId =
    input.categoryId && CATEGORY_BY_ID.has(input.categoryId) ? input.categoryId : null;

  const scope = {
    personId: session.person.id,
    groupId: input.groupId ?? null,
    categoryId,
    period: input.period,
  };

  if (input.amount <= 0n) {
    await prisma.budget.deleteMany({ where: scope });
    return json({ ok: true, removed: true });
  }

  // Not an upsert: the scope columns are nullable, and SQL treats NULL as
  // distinct from NULL, so a unique constraint over them would not actually
  // prevent a duplicate "all groups, all categories" budget. Replacing inside
  // a transaction gives the same guarantee without relying on one.
  await prisma.$transaction(async (tx) => {
    await tx.budget.deleteMany({ where: scope });
    await tx.budget.create({
      data: { ...scope, amount: input.amount, currency: input.currency },
    });
  });

  return json({ ok: true });
});

/** Start of the current budget period, in local time. */
function periodStart(period: string, now: Date): Date {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "WEEKLY": {
      // Weeks start on Monday, which is what a shared household treats as one.
      const weekday = (date.getDay() + 6) % 7;
      date.setDate(date.getDate() - weekday);
      return date;
    }
    case "YEARLY":
      return new Date(now.getFullYear(), 0, 1);
    default:
      return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}
