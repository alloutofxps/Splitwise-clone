import { json, route } from "@/lib/api";
import { NotFoundError, requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireSettlementAccess } from "@/server/access";
import { settlementDto } from "@/server/read";
import { recordActivity } from "@/server/write";
import { bumpLedgerQuery } from "@/server/ledger";

type Params = { params: Promise<{ id: string }> };

/**
 * Puts a deleted payment back.
 *
 * The mirror of the delete, batch and all: a payment that squared up several
 * ledgers at once went in as one event and several rows, came out the same way,
 * and returns the same way. Restoring one row of a batch and leaving the others
 * deleted would mean a transfer half-existed, with no screen able to say which
 * half — the same reason the delete takes the batch together.
 *
 * Access is checked per ledger rather than once, because a batch can span
 * groups and each of them has its own answer.
 */
export const POST = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();

  const settlement = await prisma.settlement.findUnique({ where: { id } });
  if (!settlement) throw new NotFoundError("That payment is gone.");

  // The row that was asked for is checked before anything is said about it,
  // including the idempotent reply below: "already restored" with the payment
  // attached still discloses the amount, the date and who paid whom. The batch
  // is checked separately further down, because restoring is the part that
  // touches ledgers this row alone does not speak for.
  await requireSettlementAccess(settlement, session.person.id);

  if (!settlement.deletedAt) {
    // Idempotent: a replayed outbox entry, or a second tap, should land on the
    // state that was asked for rather than fail.
    return json({ settlements: [settlementDto(settlement)] });
  }

  const siblings = settlement.batchId
    ? await prisma.settlement.findMany({
        where: { batchId: settlement.batchId, deletedAt: { not: null } },
      })
    : [settlement];

  // This also refuses a group deleted since then: putting a payment back into
  // nothing would leave a row no screen can reach.
  for (const row of siblings) {
    await requireSettlementAccess(row, session.person.id);
  }

  // Both people still have to be in the group: restoring a payment to someone
  // who has since left reopens a balance nobody in the group can see to fix.
  // They also have to be two people. Merging a placeholder can leave a deleted
  // payment from someone to themselves, and that one must stay deleted.
  // A removed placeholder comes back with it instead, as with expenses
  // (expenses/[id]/restore), since nobody can add one back by hand.
  const rejoining = new Set<string>();
  const inGroups = siblings.filter((row) => row.groupId !== null);
  if (inGroups.length > 0) {
    const memberships = await prisma.membership.findMany({
      where: {
        groupId: { in: inGroups.map((row) => row.groupId!) },
        personId: { in: inGroups.flatMap((row) => [row.fromPersonId, row.toPersonId]) },
      },
      select: { id: true, groupId: true, personId: true, leftAt: true, person: { select: { isGhost: true, deletedAt: true } } },
    });
    const byKey = new Map(memberships.map((m) => [`${m.groupId} ${m.personId}`, m]));
    const canBeHere = (groupId: string, personId: string) => {
      const m = byKey.get(`${groupId} ${personId}`);
      if (!m) return false;
      if (!m.leftAt) return true;
      if (!m.person.isGhost || m.person.deletedAt) return false;
      rejoining.add(m.id);
      return true;
    };
    const bothHere = (row: (typeof inGroups)[number]) =>
      row.fromPersonId !== row.toPersonId &&
      canBeHere(row.groupId!, row.fromPersonId) &&
      canBeHere(row.groupId!, row.toPersonId);
    if (!inGroups.every(bothHere)) {
      throw new ValidationError(
        "Someone on this payment has left the group. Add them back first.",
      );
    }
  }

  await prisma.$transaction([
    prisma.settlement.updateMany({
      where: { id: { in: siblings.map((row) => row.id) } },
      data: { deletedAt: null },
    }),
    prisma.membership.updateMany({ where: { id: { in: [...rejoining] } }, data: { leftAt: null } }),
    bumpLedgerQuery(siblings.map((row) => row.groupId)),
  ]);

  const restored = await prisma.settlement.findMany({
    where: { id: { in: siblings.map((row) => row.id) } },
  });

  const total = restored.reduce((sum, row) => sum + row.amount, 0n);
  await recordActivity({
    type: "settlement.restored",
    actorPersonId: session.person.id,
    groupId: settlement.batchId ? null : settlement.groupId,
    settlementId: settlement.id,
    data: {
      amount: total.toString(),
      currency: settlement.currency,
      fromPersonId: settlement.fromPersonId,
      toPersonId: settlement.toPersonId,
      ...(settlement.batchId
        ? { batchId: settlement.batchId, ledgerCount: restored.length }
        : {}),
    },
  });

  return json({ settlements: restored.map(settlementDto) });
});
