import { z } from "zod";
import { json, readBody, route } from "@/lib/api";
import { requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { areFriends, requireGroupAccess } from "@/server/access";
import { groupBalanceSheet } from "@/server/read";
import { limitByAddress, NUDGE } from "@/server/rate-limit";
import { recordActivity } from "@/server/write";

const schema = z.object({
  personId: z.string().min(1),
  groupId: z.string().nullable().optional(),
});

/**
 * Nudges somebody who owes you.
 *
 * Splitwise sends this as an email or a push notification. Divvy has neither
 * available: there are no email addresses in the schema at all - that is the
 * point of the identity model - and web push needs a deployed HTTPS origin
 * plus a VAPID keypair, which a self-hosted app cannot assume. So a nudge lands
 * where the person is already looking: their activity feed, marked unread like
 * everything else.
 *
 * The rules are deliberately narrow, because "remind" is the one feature in an
 * expense app that can be turned into harassment:
 *
 *   - you can only nudge about a debt that actually exists, computed from the
 *     ledger rather than taken from the request;
 *   - only the person owed can send it;
 *   - once a day per person, per group.
 *
 * The last one is the important one. A reminder that can be sent forty times is
 * not a reminder.
 */
export const POST = route(async (request: Request) => {
  limitByAddress(request, "nudge", NUDGE);

  const session = await requireSession();
  const me = session.person.id;
  const input = await readBody(request, schema);

  if (input.personId === me) {
    throw new ValidationError("You cannot nudge yourself.");
  }

  const groupId = input.groupId ?? null;

  if (groupId) {
    await requireGroupAccess(groupId, me);
    const membership = await prisma.membership.findUnique({
      where: { groupId_personId: { groupId, personId: input.personId } },
    });
    if (!membership || membership.leftAt) {
      throw new ValidationError("They are not in that group.");
    }
  } else if (!(await areFriends(me, input.personId))) {
    throw new ValidationError("You can only nudge people you have added.");
  }

  const debtor = await prisma.person.findUnique({ where: { id: input.personId } });
  if (!debtor) throw new ValidationError("That person no longer exists.");
  if (debtor.isGhost) {
    // A placeholder has no device to be reminded on, and telling the sender it
    // worked would be a lie.
    throw new ValidationError(
      `${debtor.displayName} has not joined yet, so there is nowhere to send this.`,
    );
  }

  // The debt is read from the ledger, never from the request: a client that
  // asks to nudge somebody who owes nothing gets a refusal rather than an
  // activity entry claiming a debt that does not exist.
  const owed = await amountOwedToMe(groupId, input.personId, me);
  if (owed <= 0n) {
    throw new ValidationError(`${debtor.displayName} does not owe you anything right now.`);
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.activity.findFirst({
    where: {
      type: "nudge.sent",
      actorPersonId: me,
      groupId,
      createdAt: { gt: since },
      targetPersonId: input.personId,
    },
  });
  if (recent) {
    throw new ValidationError(
      `You already reminded ${debtor.displayName} today. Give them a chance.`,
    );
  }

  const currency = groupId
    ? (await prisma.group.findUnique({ where: { id: groupId }, select: { currency: true } }))
        ?.currency ?? session.person.defaultCurrency
    : session.person.defaultCurrency;

  await recordActivity({
    type: "nudge.sent",
    actorPersonId: me,
    groupId,
    targetPersonId: input.personId,
    data: {
      otherPersonId: input.personId,
      amount: owed.toString(),
      currency,
    },
  });

  return json({ ok: true, amount: owed.toString(), currency }, { status: 201 });
});

/** What `personId` owes `me`, in the group's currency or the direct ledger. */
async function amountOwedToMe(
  groupId: string | null,
  personId: string,
  me: string,
): Promise<bigint> {
  if (groupId) {
    const sheet = await groupBalanceSheet(groupId);
    const edge = sheet.pairwise.find(
      (e) => e.fromPersonId === personId && e.toPersonId === me,
    );
    return edge?.amount ?? 0n;
  }

  const { directBalanceSheets } = await import("@/server/read");
  const sheets = await directBalanceSheets(me);
  let total = 0n;
  for (const [, sheet] of sheets) {
    const edge = sheet.pairwise.find(
      (e) => e.fromPersonId === personId && e.toPersonId === me,
    );
    if (edge) total += edge.amount;
  }
  return total;
}
