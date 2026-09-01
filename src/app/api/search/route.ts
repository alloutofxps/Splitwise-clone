import { json, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { EXPENSE_INCLUDE, expenseDto } from "@/server/read";

/**
 * Search across every expense the caller can see.
 *
 * Another feature that is normally paywalled, which is odd: the whole reason to
 * keep six years of expenses is to be able to answer "what did we pay for that
 * boat again?".
 *
 * Matches description and notes, and understands a couple of filters typed
 * inline - `category:dining`, `group:<id>` - so power users can narrow without
 * a filter UI.
 */
export const GET = route(async (request: Request) => {
  const session = await requireSession();
  const url = new URL(request.url);
  const raw = (url.searchParams.get("q") ?? "").trim();

  if (raw.length < 2) return json({ items: [], query: raw });

  const filters: { categoryId?: string; groupId?: string } = {};
  const terms: string[] = [];

  for (const token of raw.split(/\s+/)) {
    const [key, value] = token.split(":");
    if (value && key === "category") filters.categoryId = value;
    else if (value && key === "group") filters.groupId = value;
    else terms.push(token);
  }

  const query = terms.join(" ").trim();

  const memberships = await prisma.membership.findMany({
    where: { personId: session.person.id, leftAt: null },
    select: { groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);

  const expenses = await prisma.expense.findMany({
    where: {
      deletedAt: null,
      // Scope to what this person is entitled to see, always.
      OR: [
        { groupId: { in: filters.groupId ? [filters.groupId].filter((id) => groupIds.includes(id)) : groupIds } },
        {
          groupId: null,
          OR: [
            { payers: { some: { personId: session.person.id } } },
            { splits: { some: { personId: session.person.id } } },
          ],
        },
      ],
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(query
        ? {
            OR: [{ description: { contains: query } }, { notes: { contains: query } }],
          }
        : {}),
    },
    include: EXPENSE_INCLUDE,
    orderBy: [{ date: "desc" }],
    take: 60,
  });

  const groups = await prisma.group.findMany({
    where: { id: { in: [...new Set(expenses.map((e) => e.groupId).filter(Boolean))] as string[] } },
    select: { id: true, name: true, emoji: true, currency: true },
  });

  return json({
    query: raw,
    items: expenses.map((expense) => expenseDto(expense, session.person.id)),
    groups,
  });
});
