import { json, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";
import { EXPENSE_INCLUDE, expenseDto, settlementDto } from "@/server/read";

type Params = { params: Promise<{ id: string }> };

const PAGE_SIZE = 40;

/**
 * The group ledger: expenses and settlements interleaved in date order.
 *
 * They belong in one list because that is how the group experienced them - a
 * dinner, a dinner, "Ravi paid Priya 40", another dinner. Splitting settlements
 * into a separate tab makes it much harder to answer "wait, did that get paid
 * back?".
 *
 * Cursor pagination on (date, id) rather than offset, so inserting an expense
 * dated last week does not shuffle rows across page boundaries mid-scroll.
 */
export const GET = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  await requireGroupAccess(id, session.person.id);

  const url = new URL(request.url);
  const cursorDate = url.searchParams.get("before");
  const query = url.searchParams.get("q")?.trim();
  const categoryId = url.searchParams.get("category");
  const personId = url.searchParams.get("person");

  const dateFilter = cursorDate ? { date: { lt: new Date(cursorDate) } } : {};

  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: {
        groupId: id,
        deletedAt: null,
        ...dateFilter,
        ...(query
          ? {
              OR: [
                { description: { contains: query } },
                { notes: { contains: query } },
              ],
            }
          : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(personId
          ? {
              OR: [
                { payers: { some: { personId } } },
                { splits: { some: { personId, amount: { not: 0n } } } },
              ],
            }
          : {}),
      },
      include: EXPENSE_INCLUDE,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: PAGE_SIZE,
    }),
    // Settlements are not searchable by description, so any active text filter
    // means the user is looking for an expense and settlements would be noise.
    query || categoryId
      ? Promise.resolve([])
      : prisma.settlement.findMany({
          where: {
            groupId: id,
            deletedAt: null,
            ...dateFilter,
            ...(personId
              ? { OR: [{ fromPersonId: personId }, { toPersonId: personId }] }
              : {}),
          },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: PAGE_SIZE,
        }),
  ]);

  const items = [
    ...expenses.map((expense) => ({
      kind: "expense" as const,
      date: expense.date.toISOString(),
      expense: expenseDto(expense, session.person.id),
    })),
    ...settlements.map((settlement) => ({
      kind: "settlement" as const,
      date: settlement.date.toISOString(),
      settlement: settlementDto(settlement),
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // Both queries took a full page, so the merged list is only trustworthy up to
  // the shorter one's horizon. Trim to a page and let the client ask for more.
  const page = items.slice(0, PAGE_SIZE);
  const hasMore = items.length > PAGE_SIZE || expenses.length === PAGE_SIZE;

  return json({
    items: page,
    nextCursor: hasMore && page.length > 0 ? page[page.length - 1].date : null,
  });
});
