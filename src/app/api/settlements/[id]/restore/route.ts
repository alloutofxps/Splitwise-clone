import { json, route } from "@/lib/api";
import { NotFoundError, requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireSettlementAccess } from "@/server/access";
import { settlementDto } from "@/server/read";
import { recordActivity } from "@/server/write";

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

  for (const row of siblings) {
    await requireSettlementAccess(row, session.person.id);
  }

  // A group deleted since then takes its payments with it, and putting one back
  // into nothing would leave a row no screen can reach.
  for (const row of siblings) {
    if (!row.groupId) continue;
    const group = await prisma.group.findUnique({
      where: { id: row.groupId },
      select: { id: true },
    });
    if (!group) throw new ValidationError("A group this payment belonged to is gone.");
  }

  await prisma.settlement.updateMany({
    where: { id: { in: siblings.map((row) => row.id) } },
    data: { deletedAt: null },
  });

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
