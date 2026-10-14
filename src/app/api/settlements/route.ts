import { z } from "zod";
import {
  currencyCode,
  dateInput,
  exchangeRateInput,
  json,
  MAX_MINOR_UNITS,
  minorUnits,
  readBody,
  route,
  text,
} from "@/lib/api";
import { ConflictError, requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { convert } from "@/lib/money";
import { newId } from "@/lib/ids";
import { areFriends, requireGroupAccess } from "@/server/access";
import { groupBalanceSheet, settlementDto } from "@/server/read";
import { bumpLedgerQuery } from "@/server/ledger";
import { checkRateIsPlausible } from "@/server/rates";
import { limitByAccount, WRITE } from "@/server/rate-limit";
import { pairKey, serialize } from "@/server/mutex";
import { isUniqueViolation, recordActivity } from "@/server/write";

const schema = z.object({
  id: z.string().min(6).max(80).regex(/^[A-Za-z0-9_-]+$/, "That id is not valid.").optional(),
  groupId: z.string().max(80).nullable().optional(),
  fromPersonId: z.string().min(1).max(80),
  toPersonId: z.string().min(1).max(80),
  amount: minorUnits("The amount"),
  currency: currencyCode,
  exchangeRate: exchangeRateInput.optional(),
  date: dateInput.optional(),
  note: text(500, "The note").nullable().optional(),
  method: text(40, "The payment method").nullable().optional(),
});

/**
 * Records a payment between two people.
 *
 * Divvy never moves money. This says "Ravi handed Priya 40 in cash" or "the
 * UPI transfer went through", and the balance moves to match. Keeping the app
 * out of the payment rail is what lets every feature be free: there is nothing
 * to take a cut of and nothing to be liable for.
 */
export const POST = route(async (request: Request) => {
  const session = await requireSession();
  limitByAccount(session.person.id, "settlement-write", WRITE);
  const input = await readBody(request, schema);
  const me = session.person.id;

  if (input.fromPersonId === input.toPersonId) {
    throw new ValidationError("A payment needs two different people.");
  }
  if (input.amount <= 0n) {
    throw new ValidationError("A payment has to be more than zero.");
  }

  const isParticipant = input.fromPersonId === me || input.toPersonId === me;
  const groupId = input.groupId ?? null;
  const id = input.id ?? newId("stl");

  // A replay of something already filed is answered before any check that
  // depends on the balance - which the original has, by now, already moved.
  const replay = await existingReplay(id, me, groupId);
  if (replay) return json({ settlement: settlementDto(replay) }, { status: 200 });

  let settlementCurrency = input.currency;

  if (groupId) {
    const { group } = await requireGroupAccess(groupId, me);
    settlementCurrency = group.currency;

    const members = await prisma.membership.findMany({
      where: { groupId, leftAt: null },
      select: { personId: true },
    });
    const memberIds = new Set(members.map((m) => m.personId));
    if (!memberIds.has(input.fromPersonId) || !memberIds.has(input.toPersonId)) {
      throw new ValidationError("Both people have to be in the group.");
    }
  } else {
    // The payer or the payee can record a direct payment; nobody else can.
    if (!isParticipant) {
      throw new ValidationError("You can only record payments you are part of.");
    }
    const other = input.fromPersonId === me ? input.toPersonId : input.fromPersonId;
    // No implicit friendship here: a person id is not consent.
    if (!(await areFriends(me, other))) {
      throw new ValidationError("You can only settle up with people you have added.");
    }
  }

  if (settlementCurrency !== input.currency && !input.exchangeRate) {
    throw new ValidationError(
      `This group settles in ${settlementCurrency}, so an exchange rate is needed.`,
    );
  }

  const exchangeRate =
    settlementCurrency === input.currency ? "1" : (input.exchangeRate ?? "1");
  if (settlementCurrency !== input.currency) {
    await checkRateIsPlausible(input.currency, settlementCurrency, exchangeRate);
  }
  const convertedAmount = convert(input.amount, input.currency, settlementCurrency, exchangeRate);
  if (convertedAmount <= 0n || convertedAmount > MAX_MINOR_UNITS) {
    throw new ValidationError("That exchange rate produces an amount that cannot be stored.");
  }

  /*
   * Recording a payment on somebody else's behalf.
   *
   * Inside a group that is normal - one person squares the books for the
   * table - but it used to be unlimited, so any member could record "Bob paid
   * Alice 1,000,000" and erase every debt in the group without either of them
   * knowing. A third party may now record at most what the payer actually owes
   * and the payee is actually owed; anything beyond that is for the two people
   * themselves to record.
   */
  const key = groupId ? `group:${groupId}` : pairKey(input.fromPersonId, input.toPersonId);
  return serialize(key, async () => {
    if (groupId && !isParticipant) {
      const sheet = await groupBalanceSheet(groupId);
      const payerOwes = -(sheet.net.get(input.fromPersonId) ?? 0n);
      const payeeIsOwed = sheet.net.get(input.toPersonId) ?? 0n;
      const ceiling = payerOwes < payeeIsOwed ? payerOwes : payeeIsOwed;
      if (ceiling <= 0n || convertedAmount > ceiling) {
        throw new ValidationError(
          "You can record a payment between two other people only up to what is actually owed. Ask one of them to record the rest.",
        );
      }
    }

    let settlement;
    try {
      [settlement] = await prisma.$transaction([
        prisma.settlement.create({
          data: {
            id,
            groupId,
            fromPersonId: input.fromPersonId,
            toPersonId: input.toPersonId,
            amount: input.amount,
            currency: input.currency,
            exchangeRate,
            convertedAmount,
            date: input.date ?? new Date(),
            note: input.note ?? null,
            method: input.method ?? null,
            createdByPersonId: me,
          },
        }),
        bumpLedgerQuery([groupId]),
      ]);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Lost a race with our own replay - or the id belongs to somebody else.
      const existing = await existingReplay(id, me, groupId);
      if (existing) return json({ settlement: settlementDto(existing) }, { status: 200 });
      throw new ConflictError("That id is already in use. Try again.");
    }

    await recordActivity({
      type: "settlement.created",
      actorPersonId: me,
      groupId: settlement.groupId,
      settlementId: settlement.id,
      data: {
        amount: settlement.amount.toString(),
        currency: settlement.currency,
        fromPersonId: settlement.fromPersonId,
        toPersonId: settlement.toPersonId,
      },
    });

    return json({ settlement: settlementDto(settlement) }, { status: 201 });
  });
});

/**
 * The row with this id, if it is the caller's own earlier submission of the
 * same payment. A row with this id that somebody else filed is not returned:
 * answering with it would let anyone read any payment by quoting its id.
 */
async function existingReplay(id: string, me: string, groupId: string | null) {
  const existing = await prisma.settlement.findUnique({ where: { id } });
  if (!existing) return null;
  if (existing.createdByPersonId !== me || existing.groupId !== groupId) {
    throw new ConflictError("That id is already in use. Try again.");
  }
  return existing;
}
