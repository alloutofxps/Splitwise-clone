import { z } from "zod";
import { currencyCode, dateInput, json, minorUnits, readBody, route, text } from "@/lib/api";
import { ConflictError, requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { areFriends } from "@/server/access";
import { settlementDto, sharedLedgers } from "@/server/read";
import { bumpLedgerQuery } from "@/server/ledger";
import { pairKey, serialize } from "@/server/mutex";
import { limitByAccount, WRITE } from "@/server/rate-limit";
import { isUniqueViolation, recordActivity } from "@/server/write";

const idPattern = /^[A-Za-z0-9_-]+$/;

const schema = z.object({
  /** Ties the rows together so they read, and delete, as one payment. */
  batchId: z.string().min(6).max(80).regex(idPattern).optional(),
  /** The other party. Direction per ledger is the server's to decide. */
  personId: z.string().min(1).max(80),
  currency: currencyCode,
  date: dateInput.optional(),
  note: text(500, "The note").nullable().optional(),
  method: text(40, "The payment method").nullable().optional(),
  rows: z
    .array(
      z.object({
        id: z.string().min(6).max(80).regex(idPattern),
        groupId: z.string().max(80).nullable(),
        amount: minorUnits("The amount"),
      }),
    )
    .min(1)
    .max(50),
});

/**
 * One payment that squares up several ledgers at once.
 *
 * Two people accumulate debt in more than one place - a trip, a flat, the
 * takeaway last Tuesday - and they settle it with a single transfer. Each
 * ledger gets a row for exactly what was outstanding in it, in its own
 * currency, in the direction that ledger actually ran, and the `batchId` is
 * what lets the app show the whole thing as the single payment it was.
 *
 * The client sends amounts, never directions: direction is derived here from
 * the ledger as it stands, so a stale screen cannot invert a debt.
 */
export const POST = route(async (request: Request) => {
  const session = await requireSession();
  const me = session.person.id;
  limitByAccount(me, "settlement-write", WRITE);
  const input = await readBody(request, schema);

  if (input.personId === me) {
    throw new ValidationError("A payment needs two different people.");
  }
  if (new Set(input.rows.map((row) => row.id)).size !== input.rows.length) {
    throw new ValidationError("Each row of a payment needs its own id.");
  }
  if (new Set(input.rows.map((row) => row.groupId ?? "")).size !== input.rows.length) {
    throw new ValidationError("A ledger can only appear once in a payment.");
  }

  const person = await prisma.person.findUnique({ where: { id: input.personId } });
  if (!person || person.deletedAt) throw new ValidationError("That person is not here.");

  const batchId = input.batchId ?? newId("btc");

  // One settle-up between these two people at a time: the outstanding amounts
  // are read and then written, and two devices interleaving those steps used
  // to settle the same debt twice.
  return serialize(pairKey(me, input.personId), async () => {
    // A replay of a batch already filed is answered with it - but only to the
    // person who filed it. Rows somebody else owns are not disclosed.
    const already = await prisma.settlement.findMany({
      where: { id: { in: input.rows.map((row) => row.id) } },
    });
    if (already.length > 0) {
      const mine = already.every(
        (row) => row.createdByPersonId === me && row.batchId === batchId,
      );
      if (!mine || already.length !== input.rows.length) {
        throw new ConflictError("That payment id is already in use. Try again.");
      }
      return json({ batchId, settlements: already.map(settlementDto) }, { status: 200 });
    }

    // A shared group is consent enough; outside one, the friendship has to
    // exist already. Creating it here would let a person id stand in for the
    // invite code that is meant to be the consent.
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

    const date = input.date ?? new Date();

    // All or nothing. A half-applied settlement leaves the two of you
    // disagreeing about what was paid.
    let rows;
    try {
      rows = await prisma.$transaction([
        ...planned.map((row) =>
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
        bumpLedgerQuery(planned.map((row) => row.groupId)),
      ]);
      rows = rows.slice(0, planned.length) as Awaited<
        ReturnType<typeof prisma.settlement.create>
      >[];
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("That payment id is already in use. Try again.");
      }
      throw error;
    }

    // One activity entry for one payment. A row per ledger would report three
    // payments where the user made one.
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

    return json({ batchId, settlements: rows.map(settlementDto) }, { status: 201 });
  });
});
