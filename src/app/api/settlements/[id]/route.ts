import { json, route } from "@/lib/api";
import { ForbiddenError, NotFoundError, requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";
import { recordActivity } from "@/server/write";
import { bumpLedgerQuery } from "@/server/ledger";

type Params = { params: Promise<{ id: string }> };

/**
 * Undoes a recorded payment.
 *
 * Usually because it was entered twice, sometimes because the transfer bounced.
 * Nothing is destroyed: the row is tombstoned and balances are always derived
 * from live rows, so the debt simply reappears everywhere it had cleared.
 *
 * A payment that squared up several ledgers at once comes back the same way it
 * went in — all of it. Deleting one row of a batch and leaving the rest would
 * mean a person had "half undone" a single transfer, with no screen anywhere
 * able to say which half.
 */
export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();

  const settlement = await prisma.settlement.findUnique({ where: { id } });
  if (!settlement) throw new NotFoundError("That payment is already gone.");

  if (settlement.groupId) {
    await requireGroupAccess(settlement.groupId, session.person.id);
  } else {
    const involved =
      settlement.fromPersonId === session.person.id ||
      settlement.toPersonId === session.person.id;
    if (!involved) throw new ForbiddenError("You can't undo that payment.");
  }

  // Already deleted is the state the caller asked for - an offline replay, or
  // a second tap - so it is a success rather than a 404.
  if (settlement.deletedAt) return json({ ok: true, removed: 0 });

  // The batch, or just this row when it stands alone.
  const siblings = settlement.batchId
    ? await prisma.settlement.findMany({
        where: { batchId: settlement.batchId, deletedAt: null },
      })
    : [settlement];

  // Every group in the batch has to be one the caller may write to, or a batch
  // would be a way to reach a ledger the single-row path refuses.
  for (const row of siblings) {
    if (row.id === settlement.id) continue;
    if (row.groupId) {
      await requireGroupAccess(row.groupId, session.person.id);
    } else if (
      row.fromPersonId !== session.person.id &&
      row.toPersonId !== session.person.id
    ) {
      throw new ForbiddenError("You can't undo that payment.");
    }
  }

  const deletedAt = new Date();
  await prisma.$transaction([
    prisma.settlement.updateMany({
      where: { id: { in: siblings.map((row) => row.id) } },
      data: { deletedAt },
    }),
    bumpLedgerQuery(siblings.map((row) => row.groupId)),
  ]);

  const total = siblings.reduce((sum, row) => sum + row.amount, 0n);
  await recordActivity({
    type: "settlement.deleted",
    actorPersonId: session.person.id,
    groupId: settlement.batchId ? null : settlement.groupId,
    // Tombstoned rather than destroyed, so this still resolves and the feed can
    // offer to restore it. For a batch it names the row that was tapped; the
    // restore takes the whole batch back, the same way the delete took it.
    settlementId: settlement.id,
    data: {
      amount: total.toString(),
      currency: settlement.currency,
      fromPersonId: settlement.fromPersonId,
      toPersonId: settlement.toPersonId,
      ...(settlement.batchId
        ? { batchId: settlement.batchId, ledgerCount: siblings.length }
        : {}),
    },
  });

  return json({ ok: true, removed: siblings.length });
});
