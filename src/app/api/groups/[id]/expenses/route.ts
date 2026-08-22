import { json, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";
import { beforeCursor, compareDesc, encodeCursor, parseCursor } from "@/server/cursor";
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
 * Two tables are merged into one page here, which puts three things under
 * obligation to agree with each other, or rows fall down the gap between pages:
 *
 *   1. each table's `orderBy` — (date desc, id desc);
 *   2. the merge comparator — `compareDesc`, on the same key;
 *   3. the cursor — the last emitted row's (date, id), and the filter derived
 *      from it in `beforeCursor`.
 *
 * The tiebreak on id is what makes the key a total order. Without it, several
 * expenses sharing a date - one evening out, entered together - can straddle a
 * page boundary and the ones trimmed off page one are then filtered out of page
 * two as well. See `server/cursor.ts`.
 *
 * Each table is asked for one row more than a page. That is what makes the
 * merged prefix trustworthy: the top N of the union equals the top N of the
 * union of each table's top N+1, so anything below the cut is reachable by
 * paging rather than lost.
 */
export const GET = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  await requireGroupAccess(id, session.person.id);

  const url = new URL(request.url);
  const cursor = parseCursor(url.searchParams.get("before"));
  const query = url.searchParams.get("q")?.trim();
  const categoryId = url.searchParams.get("category");
  const personId = url.searchParams.get("person");

  // Filters are ANDed rather than merged into one object. Two of them want an
  // `OR` key, and spreading both into a single literal silently drops the
  // first: searching "taxi" while filtered to one person used to return that
  // person's whole history.
  const expenseFilters: Record<string, unknown>[] = [
    ...beforeCursor("date", cursor),
    ...(query
      ? [{ OR: [{ description: { contains: query } }, { notes: { contains: query } }] }]
      : []),
    ...(categoryId ? [{ categoryId }] : []),
    ...(personId
      ? [
          {
            OR: [
              { payers: { some: { personId } } },
              { splits: { some: { personId, amount: { not: 0n } } } },
            ],
          },
        ]
      : []),
  ];

  const settlementFilters: Record<string, unknown>[] = [
    ...beforeCursor("date", cursor),
    ...(personId ? [{ OR: [{ fromPersonId: personId }, { toPersonId: personId }] }] : []),
  ];

  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: { groupId: id, deletedAt: null, AND: expenseFilters },
      include: EXPENSE_INCLUDE,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
    }),
    // Settlements are not searchable by description, so any active text filter
    // means the user is looking for an expense and settlements would be noise.
    query || categoryId
      ? Promise.resolve([])
      : prisma.settlement.findMany({
          where: { groupId: id, deletedAt: null, AND: settlementFilters },
          orderBy: [{ date: "desc" }, { id: "desc" }],
          take: PAGE_SIZE + 1,
        }),
  ]);

  const items = [
    ...expenses.map((expense) => ({
      kind: "expense" as const,
      id: expense.id,
      date: expense.date.toISOString(),
      expense: expenseDto(expense, session.person.id),
    })),
    ...settlements.map((settlement) => ({
      kind: "settlement" as const,
      id: settlement.id,
      date: settlement.date.toISOString(),
      settlement: settlementDto(settlement),
    })),
  ].sort(compareDesc);

  const page = items.slice(0, PAGE_SIZE);
  // Both tables were asked for PAGE_SIZE + 1, so a merged list longer than a
  // page is the only way more rows can exist: if it is shorter, each table
  // returned everything it had.
  const hasMore = items.length > PAGE_SIZE;
  const last = page[page.length - 1];

  return json({
    items: page,
    nextCursor: hasMore && last ? encodeCursor(last.date, last.id) : null,
  });
});
