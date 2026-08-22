import { json, route } from "@/lib/api";
import { ForbiddenError, NotFoundError, requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { areFriends } from "@/server/access";
import {
  EXPENSE_INCLUDE,
  balanceSheetDto,
  directBalanceSheets,
  expenseDto,
  personDto,
  settlementDto,
} from "@/server/read";

type Params = { params: Promise<{ id: string }> };

/**
 * One friend's page: the direct ledger between the two of you, per currency,
 * plus the shared groups where the rest of your money lives.
 *
 * Group balances are listed separately rather than folded in. Telling someone
 * "you owe me 90" when 60 of it is really the flat's electricity bill is how
 * you start an argument that the app was supposed to prevent.
 */
export const GET = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  const me = session.person.id;

  const person = await prisma.person.findUnique({ where: { id } });
  if (!person) throw new NotFoundError("That person is not here.");
  if (id !== me && !(await areFriends(me, id))) {
    throw new ForbiddenError("You have not added that person.");
  }

  const sheets = await directBalanceSheets(me);

  const balances = [...sheets]
    .map(([currency, sheet]) => ({
      currency,
      sheet: balanceSheetDto(sheet, currency),
      net: (sheet.net.get(me) ?? 0n).toString(),
    }))
    .filter((entry) => {
      // Only currencies where these two people actually have a position.
      const edges = sheets.get(entry.currency)!.pairwise;
      return edges.some(
        (e) =>
          (e.fromPersonId === me && e.toPersonId === id) ||
          (e.fromPersonId === id && e.toPersonId === me),
      );
    });

  const [expenses, settlements, sharedGroups] = await Promise.all([
    prisma.expense.findMany({
      where: {
        groupId: null,
        deletedAt: null,
        AND: [
          { OR: [{ payers: { some: { personId: me } } }, { splits: { some: { personId: me } } }] },
          { OR: [{ payers: { some: { personId: id } } }, { splits: { some: { personId: id } } }] },
        ],
      },
      include: EXPENSE_INCLUDE,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 60,
    }),
    prisma.settlement.findMany({
      where: {
        groupId: null,
        deletedAt: null,
        OR: [
          { fromPersonId: me, toPersonId: id },
          { fromPersonId: id, toPersonId: me },
        ],
      },
      orderBy: [{ date: "desc" }],
      take: 60,
    }),
    prisma.group.findMany({
      where: {
        AND: [
          { memberships: { some: { personId: me, leftAt: null } } },
          { memberships: { some: { personId: id, leftAt: null } } },
        ],
      },
      select: { id: true, name: true, emoji: true, currency: true, color: true },
    }),
  ]);

  const items = [
    ...expenses.map((expense) => ({
      kind: "expense" as const,
      date: expense.date.toISOString(),
      expense: expenseDto(expense, me),
    })),
    ...settlements.map((settlement) => ({
      kind: "settlement" as const,
      date: settlement.date.toISOString(),
      settlement: settlementDto(settlement),
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  return json({
    person: personDto(person),
    balances,
    items,
    sharedGroups,
  });
});

/**
 * Removes a friend.
 *
 * Refused while anything is outstanding: removing them would hide the only
 * record of the debt from both sides.
 */
export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  const me = session.person.id;

  const sheets = await directBalanceSheets(me);
  for (const [currency, sheet] of sheets) {
    const edge = sheet.pairwise.find(
      (e) =>
        (e.fromPersonId === me && e.toPersonId === id) ||
        (e.fromPersonId === id && e.toPersonId === me),
    );
    if (edge && edge.amount !== 0n) {
      throw new ForbiddenError(
        `You still have an unsettled ${currency} balance with them. Settle up first.`,
      );
    }
  }

  await prisma.friendship.deleteMany({
    where: {
      OR: [
        { personAId: me, personBId: id },
        { personAId: id, personBId: me },
      ],
    },
  });

  return json({ ok: true });
});
