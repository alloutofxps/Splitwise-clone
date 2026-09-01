import { route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { toDecimalString } from "@/lib/money";
import { categoryById } from "@/lib/categories";

/**
 * A whole-account backup, as JSON.
 *
 * The CSV export next door is a *report*: one row per person per expense,
 * shaped for a pivot table, and lossy by design — it flattens split modes,
 * drops weights, and covers one group. This is the other thing an export can
 * be: everything the account touches, in the structure the app actually uses,
 * so a person can read their own history years after they stop using Divvy and
 * so a self-hoster can move a database without a migration script.
 *
 * Four rules make it trustworthy:
 *
 *   **Money stays a decimal string**, exactly as the API sends it. A JSON
 *   number is a float64, and a backup that rounds a large rupee balance on the
 *   way out is worse than no backup.
 *
 *   **Only what the caller can already see.** The scope is their groups, their
 *   direct expenses, their friends — never a group they left before an expense
 *   was filed, and never another person's private data. It is an export, not a
 *   privilege escalation with a Content-Disposition header.
 *
 *   **Soft-deleted rows are included and flagged.** "Where did that dinner go"
 *   is precisely the question a backup gets opened to answer.
 *
 *   **No attachment bytes.** Receipts would turn a 200 KB file into 40 MB of
 *   base64 that no text editor will open; they are listed with their metadata
 *   and a URL instead.
 */
export const GET = route(async () => {
  const session = await requireSession();
  const meId = session.person.id;

  const memberships = await prisma.membership.findMany({
    where: { personId: meId, leftAt: null },
    select: { groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);

  // A direct (groupless) expense is visible to whoever pays into or shares it.
  const visibleExpenses = {
    OR: [
      { groupId: { in: groupIds } },
      { groupId: null, payers: { some: { personId: meId } } },
      { groupId: null, splits: { some: { personId: meId } } },
    ],
  };

  const [me, groups, expenses, settlements, budgets, recurrences, friendships] =
    await Promise.all([
      prisma.person.findUniqueOrThrow({
        where: { id: meId },
        include: { paymentMethods: { orderBy: { sortOrder: "asc" } } },
      }),
      prisma.group.findMany({
        where: { id: { in: groupIds } },
        include: { memberships: { include: { person: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.expense.findMany({
        where: visibleExpenses,
        include: {
          payers: true,
          splits: true,
          items: { include: { shares: true }, orderBy: { sortOrder: "asc" } },
          comments: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
          attachments: {
            select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
          },
        },
        orderBy: { date: "asc" },
      }),
      prisma.settlement.findMany({
        where: {
          OR: [
            { groupId: { in: groupIds } },
            { groupId: null, fromPersonId: meId },
            { groupId: null, toPersonId: meId },
          ],
        },
        orderBy: { date: "asc" },
      }),
      prisma.budget.findMany({ where: { personId: meId }, orderBy: { createdAt: "asc" } }),
      prisma.recurrence.findMany({
        where: { OR: [{ groupId: { in: groupIds } }, { createdByPersonId: meId }] },
        orderBy: { createdAt: "asc" },
      }),
      prisma.friendship.findMany({
        where: { OR: [{ personAId: meId }, { personBId: meId }] },
        include: { personA: true, personB: true },
      }),
    ]);

  // One directory of everyone named anywhere in the file, so a reader never has
  // to guess who an id belongs to.
  const people = new Map<string, { id: string; name: string; isGhost: boolean }>();
  const remember = (person: { id: string; displayName: string; isGhost: boolean }) => {
    people.set(person.id, {
      id: person.id,
      name: person.displayName,
      isGhost: person.isGhost,
    });
  };
  remember(me);
  for (const group of groups) for (const m of group.memberships) remember(m.person);
  for (const friendship of friendships) {
    remember(friendship.personA);
    remember(friendship.personB);
  }

  const payload = {
    format: "divvy.backup",
    // Bumped whenever a field changes meaning, so an importer can refuse a file
    // it does not understand rather than misreading it.
    version: 1,
    exportedAt: new Date().toISOString(),
    account: {
      id: me.id,
      displayName: me.displayName,
      defaultCurrency: me.defaultCurrency,
      inviteCode: me.inviteCode,
      createdAt: me.createdAt.toISOString(),
      paymentMethods: me.paymentMethods.map((method) => ({
        kind: method.kind,
        label: method.label,
        value: method.value,
      })),
    },
    // Explicitly not in the file: the recovery key. Only its hash exists on the
    // server, and a backup that leaked a working credential into a downloads
    // folder would be a bad trade for a value the user was already shown once.
    people: [...people.values()],
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      emoji: group.emoji,
      kind: group.kind,
      currency: group.currency,
      simplifyDebts: group.simplifyDebts,
      archivedAt: group.archivedAt?.toISOString() ?? null,
      createdAt: group.createdAt.toISOString(),
      members: group.memberships.map((m) => ({
        personId: m.personId,
        role: m.role,
        nickname: m.nickname,
        joinedAt: m.joinedAt.toISOString(),
        leftAt: m.leftAt?.toISOString() ?? null,
      })),
    })),
    expenses: expenses.map((expense) => ({
      id: expense.id,
      groupId: expense.groupId,
      description: expense.description,
      notes: expense.notes,
      amount: toDecimalString(expense.amount, expense.currency),
      currency: expense.currency,
      exchangeRate: expense.exchangeRate,
      convertedAmount: toDecimalString(
        expense.convertedAmount,
        groupCurrency(groups, expense.groupId) ?? expense.currency,
      ),
      splitMode: expense.splitMode,
      category: categoryById(expense.categoryId).id,
      date: expense.date.toISOString(),
      createdBy: expense.createdByPersonId,
      deletedAt: expense.deletedAt?.toISOString() ?? null,
      payers: expense.payers.map((payer) => ({
        personId: payer.personId,
        amount: toDecimalString(payer.amount, expense.currency),
      })),
      splits: expense.splits.map((split) => ({
        personId: split.personId,
        amount: toDecimalString(split.amount, expense.currency),
        included: split.included,
        weight: split.weight,
        percent: split.percent,
        adjustment:
          split.adjustment === null
            ? null
            : toDecimalString(split.adjustment, expense.currency),
      })),
      items: expense.items.map((item) => ({
        name: item.name,
        amount: toDecimalString(item.amount, expense.currency),
        quantity: item.quantity,
        shares: item.shares.map((share) => ({
          personId: share.personId,
          weight: share.weight,
        })),
      })),
      comments: expense.comments.map((comment) => ({
        personId: comment.personId,
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
      })),
      attachments: expense.attachments.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        // Bytes live behind this, not in the file.
        url: `/api/attachments/${attachment.id}`,
      })),
    })),
    settlements: settlements.map((settlement) => ({
      id: settlement.id,
      groupId: settlement.groupId,
      fromPersonId: settlement.fromPersonId,
      toPersonId: settlement.toPersonId,
      amount: toDecimalString(settlement.amount, settlement.currency),
      currency: settlement.currency,
      exchangeRate: settlement.exchangeRate,
      date: settlement.date.toISOString(),
      note: settlement.note,
      method: settlement.method,
      deletedAt: settlement.deletedAt?.toISOString() ?? null,
    })),
    budgets: budgets.map((budget) => ({
      groupId: budget.groupId,
      categoryId: budget.categoryId,
      amount: toDecimalString(budget.amount, budget.currency),
      currency: budget.currency,
      period: budget.period,
    })),
    recurrences: recurrences.map((recurrence) => ({
      id: recurrence.id,
      groupId: recurrence.groupId,
      description: recurrence.description,
      amount: toDecimalString(recurrence.amount, recurrence.currency),
      currency: recurrence.currency,
      frequency: recurrence.frequency,
      interval: recurrence.interval,
      dayOfMonth: recurrence.dayOfMonth,
      startDate: recurrence.startDate.toISOString(),
      nextRunAt: recurrence.nextRunAt.toISOString(),
      endsAt: recurrence.endsAt?.toISOString() ?? null,
      active: recurrence.active,
    })),
    friends: friendships.map((friendship) => ({
      personId: friendship.personAId === meId ? friendship.personBId : friendship.personAId,
      since: friendship.createdAt.toISOString(),
    })),
  };

  const filename = `divvy-backup-${new Date().toISOString().slice(0, 10)}.json`;

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});

function groupCurrency(
  groups: { id: string; currency: string }[],
  groupId: string | null,
): string | null {
  if (!groupId) return null;
  return groups.find((group) => group.id === groupId)?.currency ?? null;
}
