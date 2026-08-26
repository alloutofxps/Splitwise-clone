import { z } from "zod";
import { currencyCode, dateInput, json, minorUnits, readBody, route, text } from "@/lib/api";
import { requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { areFriends } from "@/server/access";
import { settlementDto, sharedLedgers } from "@/server/read";
import { isUniqueViolation, recordActivity } from "@/server/write";

const schema = z.object({
  /** Ties the rows together so they read, and delete, as one payment. */
  batchId: z.string().min(6).max(80).optional(),
  /** The other party. Direction per ledger is the server's to decide. */
  personId: z.string().min(1),
  currency: currencyCode,
  date: dateInput.optional(),
  note: text(500, "The note").nullable().optional(),
  method: text(40, "The payment method").nullable().optional(),
  rows: z
    .array(
      z.object({
        id: z.string().min(6).max(80),
        groupId: z.string().nullable(),
        amount: minorUnits("The amount"),
      }),
    )
    .min(1)
    .max(50),
});

/**
 * One payment that squares up several ledgers at once.
 *
 * Two people accumulate debt in more than one place — a trip, a flat, the
 * takeaway last Tuesday — and they settle it the way people actually do, with
 * a single transfer for the net. Recording that as one row somewhere would
 * corrupt every group it touched: the others in the Lisbon group would see
 * money arrive that never entered their ledger, or worse, not see the debt
 * clear at all.
 *
 * So the transfer is one *event* and several *entries*. Each ledger gets a row
 * for exactly what was outstanding in it, in its own settlement currency, in
 * the direction that ledger actually ran — which can differ row to row, since
 * squaring up with somebody who owes you for the trip and whom you owe for the
 * rent means paying down debts that point opposite ways. Every group's books
 * stay internally correct and auditable by its own members, and the `batchId`
 * is what lets the app show the whole thing as the single payment it was.
 *
 * The client sends amounts, never directions: direction is derived here from
 * the ledger as it stands, so a stale screen cannot invert a debt.
 */
export const POST = route(async (request: Request) => {
  const session = await requireSession();
  const me = session.person.id;
  const input = await readBody(request, schema);

  if (input.personId === me) {
    throw new ValidationError("A payment needs two different people.");
  }

  const person = await prisma.person.findUnique({ where: { id: input.personId } });
  if (!person) throw new ValidationError("That person is not here.");

  // A shared group is consent enough; outside one, the friendship has to exist
  // already. Creating it here would let a person id — which appears in every
  // member list — stand in for the invite code that is meant to be the consent.
  const ledgers = await sharedLedgers(me, input.personId);
  if (ledgers.length === 0 && !(await areFriends(me, input.personId))) {
    throw new ValidationError("You can only settle up with people you have added.");
  }

  const byGroup = new Map(
    ledgers
      .filter((ledger) => ledger.currency === input.currency)
      .map((ledger) => [ledger.groupId ?? "", ledger] as const),
  );

  const planned = input.rows.map((row) => {
    const ledger = byGroup.get(row.groupId ?? "");
    if (!ledger) {
      throw new ValidationError(
        "One of those ledgers has nothing outstanding in it any more. Reopen the sheet to see where you stand.",
      );
    }
    if (row.amount <= 0n) {
      throw new ValidationError("A payment has to be more than zero.");
    }

    const outstanding = BigInt(ledger.net);
    const magnitude = outstanding < 0n ? -outstanding : outstanding;
    if (row.amount > magnitude) {
      throw new ValidationError(
        "That is more than is outstanding in one of those ledgers. Reopen the sheet to see where you stand.",
      );
    }

    // Positive means they owe the viewer, so they are the one paying.
    const theyOweMe = outstanding > 0n;
    return {
      id: row.id,
      groupId: row.groupId,
      fromPersonId: theyOweMe ? input.personId : me,
      toPersonId: theyOweMe ? me : input.personId,
      amount: row.amount,
    };
  });

  const batchId = input.batchId ?? newId("btc");
  const date = input.date ?? new Date();

  // All or nothing. A half-applied settlement leaves the two of you disagreeing
  // about what was paid, which is the one thing a shared ledger must never do.
  let created = true;
  let rows;
  try {
    rows = await prisma.$transaction(
      planned.map((row) =>
        prisma.settlement.create({
          data: {
            id: row.id,
            batchId,
            groupId: row.groupId,
            fromPersonId: row.fromPersonId,
            toPersonId: row.toPersonId,
            amount: row.amount,
            currency: input.currency,
            // Each row is already in its own ledger's currency, having been
            // built from that ledger's outstanding figure.
            exchangeRate: "1",
            convertedAmount: row.amount,
            date,
            note: input.note ?? null,
            method: input.method ?? null,
            createdByPersonId: me,
          },
        }),
      ),
    );
  } catch (error) {
    // Replayed from the offline outbox: the ids are the client's, so the whole
    // batch collides and the existing one is the right answer.
    if (!isUniqueViolation(error)) throw error;
    rows = await prisma.settlement.findMany({
      where: { id: { in: planned.map((row) => row.id) } },
    });
    if (rows.length === 0) throw error;
    created = false;
  }

  if (created) {
    // One activity entry for one payment. A row per ledger here would report
    // three payments where the user made one.
    const total = planned.reduce((sum, row) => sum + row.amount, 0n);
    await recordActivity({
      type: "settlement.created",
      actorPersonId: me,
      groupId: null,
      settlementId: rows[0]?.id,
      data: {
        amount: total.toString(),
        currency: input.currency,
        fromPersonId: planned[0].fromPersonId,
        toPersonId: planned[0].toPersonId,
        batchId,
        ledgerCount: planned.length,
      },
    });
  }

  return json(
    { batchId, settlements: rows.map(settlementDto) },
    { status: created ? 201 : 200 },
  );
});
