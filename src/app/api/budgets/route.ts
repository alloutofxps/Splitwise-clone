import { z } from "zod";
import { currencyCode, json, minorUnits, readBody, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { CATEGORY_BY_ID } from "@/lib/categories";
import { convertedBreakdown } from "@/lib/split";
import { getRate } from "@/server/rates";
import { convert } from "@/lib/money";
import type { BudgetDto } from "@/lib/types";
import { ValidationError } from "@/lib/errors";
import { requireGroupAccess } from "@/server/access";

const MAX_BUDGETS = 50;
import { fromWallClock, isValidTimeZone, wallClock } from "@/lib/zoned";

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
export const GET = route(async (request: Request) => {
  const session = await requireSession();
  const personId = session.person.id;
  // The viewer's zone, so "this month" is their month. Falls back to UTC.
  const requested = new URL(request.url).searchParams.get("tz") ?? "";
  const timeZone = isValidTimeZone(requested) ? requested : "UTC";

  const budgets = await prisma.budget.findMany({ where: { personId } });
  if (budgets.length === 0) return json({ budgets: [] });

  const earliest = budgets
    .map((b) => periodStart(b.period, new Date(), timeZone))
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

  // Today's rate for every currency pair a budget needs, looked up once.
  // Spending in another currency used to be skipped without a word, so a euro
  // budget read zero for a whole trip paid in yen. Converting at today's rate
  // only ever touches the current period, and the result is marked approximate
  // so the screen can say so.
  const pairs = new Set<string>();
  for (const budget of budgets) {
    for (const expense of expenses) {
      const code = expense.group?.currency ?? expense.currency;
      if (code !== budget.currency) pairs.add(`${code}>${budget.currency}`);
    }
  }
  const rates = new Map<string, string | null>();
  await Promise.all(
    [...pairs].map(async (pair) => {
      const [from, to] = pair.split(">");
      const found = await getRate(from, to).catch(() => null);
      rates.set(pair, found?.rate ?? null);
    }),
  );

  const result: BudgetDto[] = budgets.map((budget) => {
    const start = periodStart(budget.period, new Date(), timeZone);
    let spent = 0n;
    const convertedFrom = new Set<string>();
    const uncounted = new Set<string>();

    for (const expense of expenses) {
      if (expense.date < start) continue;
      if (budget.groupId && expense.groupId !== budget.groupId) continue;
      if (budget.categoryId && expense.categoryId !== budget.categoryId) continue;

      const expenseCurrency = expense.group?.currency ?? expense.currency;
      const { owed } = convertedBreakdown(expense);
      const share = owed
        .filter((o) => o.personId === personId)
        .reduce((total, o) => total + o.amount, 0n);
      if (share === 0n) continue;

      if (expenseCurrency === budget.currency) {
        spent += share;
        continue;
      }
      const rate = rates.get(`${expenseCurrency}>${budget.currency}`);
      if (!rate) {
        uncounted.add(expenseCurrency);
        continue;
      }
      spent += convert(share, expenseCurrency, budget.currency, rate);
      convertedFrom.add(expenseCurrency);
    }

    return {
      id: budget.id,
      groupId: budget.groupId,
      categoryId: budget.categoryId,
      amount: budget.amount.toString(),
      currency: budget.currency,
      period: budget.period as BudgetDto["period"],
      spent: spent.toString(),
      convertedFrom: [...convertedFrom].sort(),
      uncounted: [...uncounted].sort(),
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
    // An empty id means no group, as leaving it out does. Kept as "" it
    // skipped the access check below and then failed as a foreign key: a 500
    // found by sending every route bad input (scripts/fuzz-routes.mjs).
    groupId: input.groupId || null,
    categoryId,
    period: input.period,
  };

  if (input.amount <= 0n) {
    await prisma.budget.deleteMany({ where: scope });
    return json({ ok: true, removed: true });
  }

  // A budget scoped to a group you are not in tracks nothing and names a group
  // id you should not be able to reference.
  if (scope.groupId) await requireGroupAccess(scope.groupId, session.person.id);

  // Replacing a budget does not add one, so the one being replaced is not counted.
  const existing = await prisma.budget.count({
    where: {
      personId: session.person.id,
      NOT: { groupId: scope.groupId, categoryId: scope.categoryId, period: scope.period },
    },
  });
  if (existing >= MAX_BUDGETS) {
    throw new ValidationError(`You can keep up to ${MAX_BUDGETS} budgets. Remove one first.`);
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

/**
 * Start of the current budget period, on the viewer's own calendar.
 *
 * This used the server's local time, which in a container is UTC - so for
 * somebody in India "this month" began at 05:30 on the 1st, and for somebody in
 * California the previous evening. Expenses near midnight landed in the wrong
 * month's budget.
 */
function periodStart(period: string, now: Date, timeZone: string): Date {
  const today = wallClock(now, timeZone);
  const midnight = (year: number, month: number, day: number) =>
    fromWallClock({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone);

  switch (period) {
    case "WEEKLY": {
      // Weeks start on Monday, which is what a shared household treats as one.
      const weekday = (new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() + 6) % 7;
      const monday = new Date(Date.UTC(today.year, today.month - 1, today.day - weekday));
      return midnight(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
    }
    case "YEARLY":
      return midnight(today.year, 1, 1);
    default:
      return midnight(today.year, today.month, 1);
  }
}
