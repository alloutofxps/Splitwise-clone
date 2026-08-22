import { z } from "zod";
import { currencyCode, dateInput, json, minorUnits, readBody, route, text } from "@/lib/api";
import { requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { convert } from "@/lib/money";
import { newId } from "@/lib/ids";
import { areFriends, friendshipPair, requireGroupAccess } from "@/server/access";
import { settlementDto } from "@/server/read";
import { isUniqueViolation, recordActivity } from "@/server/write";

const schema = z.object({
  id: z.string().min(6).max(80).optional(),
  groupId: z.string().nullable().optional(),
  fromPersonId: z.string().min(1),
  toPersonId: z.string().min(1),
  amount: minorUnits("The amount"),
  currency: currencyCode,
  exchangeRate: z.string().regex(/^\d+(\.\d+)?$/).optional(),
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
  const input = await readBody(request, schema);

  if (input.fromPersonId === input.toPersonId) {
    throw new ValidationError("A payment needs two different people.");
  }
  if (input.amount <= 0n) {
    throw new ValidationError("A payment has to be more than zero.");
  }

  // The payer or the payee can record it, but a bystander cannot invent a
  // payment between two other people - except inside a group, where everyone
  // shares the ledger and settling on someone's behalf is normal.
  const isParticipant =
    input.fromPersonId === session.person.id || input.toPersonId === session.person.id;

  let settlementCurrency = input.currency;

  if (input.groupId) {
    const { group } = await requireGroupAccess(input.groupId, session.person.id);
    settlementCurrency = group.currency;

    const members = await prisma.membership.findMany({
      where: { groupId: input.groupId, leftAt: null },
      select: { personId: true },
    });
    const memberIds = new Set(members.map((m) => m.personId));
    if (!memberIds.has(input.fromPersonId) || !memberIds.has(input.toPersonId)) {
      throw new ValidationError("Both people have to be in the group.");
    }
  } else {
    if (!isParticipant) {
      throw new ValidationError("You can only record payments you are part of.");
    }
    const other =
      input.fromPersonId === session.person.id ? input.toPersonId : input.fromPersonId;
    if (!(await areFriends(session.person.id, other))) {
      throw new ValidationError("You can only settle up with people you have added.");
    }
    await prisma.friendship.upsert({
      where: { personAId_personBId: friendshipPair(session.person.id, other) },
      create: friendshipPair(session.person.id, other),
      update: {},
    });
  }

  if (settlementCurrency !== input.currency && !input.exchangeRate) {
    throw new ValidationError(
      `This group settles in ${settlementCurrency}, so an exchange rate is needed.`,
    );
  }

  const exchangeRate =
    settlementCurrency === input.currency ? "1" : (input.exchangeRate ?? "1");
  const convertedAmount = convert(
    input.amount,
    input.currency,
    settlementCurrency,
    exchangeRate,
  );

  const id = input.id ?? newId("stl");

  let settlement;
  let created = true;
  try {
    settlement = await prisma.settlement.create({
      data: {
        id,
        groupId: input.groupId ?? null,
        fromPersonId: input.fromPersonId,
        toPersonId: input.toPersonId,
        amount: input.amount,
        currency: input.currency,
        exchangeRate,
        convertedAmount,
        date: input.date ?? new Date(),
        note: input.note ?? null,
        method: input.method ?? null,
        createdByPersonId: session.person.id,
      },
    });
  } catch (error) {
    // Replayed from the offline outbox.
    if (!isUniqueViolation(error)) throw error;
    const existing = await prisma.settlement.findUnique({ where: { id } });
    if (!existing) throw error;
    settlement = existing;
    created = false;
  }

  if (created) {
    await recordActivity({
      type: "settlement.created",
      actorPersonId: session.person.id,
      groupId: settlement.groupId,
      settlementId: settlement.id,
      data: {
        amount: settlement.amount.toString(),
        currency: settlement.currency,
        fromPersonId: settlement.fromPersonId,
        toPersonId: settlement.toPersonId,
      },
    });
  }

  return json({ settlement: settlementDto(settlement) }, { status: 201 });
});
