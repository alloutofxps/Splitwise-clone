import { json, route } from "@/lib/api";
import { ForbiddenError, NotFoundError, requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { areFriends, friendshipPair, sharesAGroup } from "@/server/access";
import { compareDesc } from "@/server/cursor";
import {
  EXPENSE_INCLUDE,
  balanceSheetDto,
  directBalanceSheets,
  expenseDto,
  personDto,
  settlementDto,
  sharedLedgers,
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
  if (!person) throw new NotFoundError("We couldn't find that person.");
  // A shared group counts as much as a friendship here: the group already
  // shows you this person and what they owe, so refusing to total it up across
  // their groups hides arithmetic rather than protecting anything.
  if (id !== me && !(await areFriends(me, id)) && !(await sharesAGroup(me, id))) {
    throw new ForbiddenError("You haven't added that person.");
  }

  const [sheets, ledgers] = await Promise.all([
    directBalanceSheets(me),
    // Every ledger the two of you share, so the page can state the real total
    // and show what it is made of. Listing the groups without their amounts
    // told you a balance existed somewhere and left you to go and find it.
    sharedLedgers(me, id),
  ]);

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

  const sharedGroups = await prisma.group.findMany({
    where: {
      AND: [
        { memberships: { some: { personId: me, leftAt: null } } },
        { memberships: { some: { personId: id, leftAt: null } } },
      ],
    },
    select: { id: true, name: true, emoji: true, currency: true, color: true },
  });
  // All shared history, not only what's outside groups (DESIGN-PLAN 3.7): the
  // direct ledger plus every expense and payment in a shared group that
  // involves both of you. The page filters by group.
  const where = [{ groupId: null }, { groupId: { in: sharedGroups.map((group) => group.id) } }];

  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: {
        OR: where,
        deletedAt: null,
        AND: [
          { OR: [{ payers: { some: { personId: me } } }, { splits: { some: { personId: me } } }] },
          { OR: [{ payers: { some: { personId: id } } }, { splits: { some: { personId: id } } }] },
        ],
      },
      include: EXPENSE_INCLUDE,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    prisma.settlement.findMany({
      where: {
        deletedAt: null,
        AND: [
          { OR: where },
          {
            OR: [
              { fromPersonId: me, toPersonId: id },
              { fromPersonId: id, toPersonId: me },
            ],
          },
        ],
      },
      orderBy: [{ date: "desc" }],
      take: 60,
    }),
  ]);

  // Same shape as the group ledger, id included: this list is not paged today,
  // but the two are read through one `LedgerEntry` type and a row without an id
  // would be the thing that breaks on the day it is.
  const items = [
    ...expenses.map((expense) => ({
      kind: "expense" as const,
      id: expense.id,
      date: expense.date.toISOString(),
      expense: expenseDto(expense, me),
    })),
    ...settlements.map((settlement) => ({
      kind: "settlement" as const,
      id: settlement.id,
      date: settlement.date.toISOString(),
      settlement: settlementDto(settlement),
    })),
  ].sort(compareDesc);

  // The combined position per currency: what the friends list shows, and the
  // figure a cross-ledger settlement is built from.
  const combined: Record<string, string> = {};
  for (const ledger of ledgers) {
    const total = (BigInt(combined[ledger.currency] ?? "0") + BigInt(ledger.net)).toString();
    combined[ledger.currency] = total;
  }
  for (const [currency, value] of Object.entries(combined)) {
    if (value === "0") delete combined[currency];
  }

  return json({
    person: personDto(person),
    balances,
    combined,
    ledgers,
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

  // Every ledger, not just the direct one. The guard exists so that removing
  // somebody cannot hide the only record of a debt from both sides, and a debt
  // in a shared group hides just as well as a direct one.
  const outstanding = (await sharedLedgers(me, id)).filter((ledger) => ledger.net !== "0");
  if (outstanding.length > 0) {
    const where = outstanding[0].name ?? "between you two";
    throw new ForbiddenError(
      outstanding.length === 1
        ? `You still have an unsettled ${outstanding[0].currency} balance with them in ${where}. Settle up first.`
        : `You still have unsettled balances with them in ${outstanding.length} places. Settle up first.`,
    );
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

/**
 * Adds someone you already share a group with as a friend, so you can split
 * things with just them as well.
 *
 * Only people you share a group with: anyone else needs their code, which is
 * how they agree to it. Not someone who isn't on Divvy yet (there is nobody to
 * be friends with), and not yourself.
 */
export const POST = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  const me = session.person.id;
  if (id === me) throw new ForbiddenError("That's you.");

  const person = await prisma.person.findUnique({ where: { id } });
  if (!person || person.deletedAt) throw new NotFoundError("We couldn't find them.");
  if (person.isGhost) throw new ForbiddenError("They aren't on Divvy yet, so they can't be added as a friend.");
  if (!(await sharesAGroup(me, id))) {
    throw new ForbiddenError("You can only add people you share a group with. Ask for their code instead.");
  }

  await prisma.friendship.upsert({
    where: { personAId_personBId: friendshipPair(me, id) },
    create: friendshipPair(me, id),
    update: {},
  });
  return json({ ok: true });
});
