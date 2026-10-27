import { json, route } from "@/lib/api";
import { clearIdentityCookie, requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { generateGhostCode } from "@/lib/codes";
import { directBalanceSheets, groupSheetsFor } from "@/server/read";

/**
 * Deletes the caller's account.
 *
 * Required by privacy law (GDPR, UK GDPR, India's DPDP Act) and by any app
 * store: a person has to be able to remove what the app holds about them.
 *
 * What a shared ledger makes subtle is that the *records* are not only theirs.
 * The dinner they split is also on three other people's books, so expenses and
 * payments stay - with the person shown as "Deleted user" - and everything
 * that is only about them goes: their name, emoji, payment handles, budgets,
 * passkeys, recovery key, devices, friendships and comments.
 *
 * Refused while they still owe or are owed anything. Deleting an account must
 * not be a way to walk away from a debt, or to strand somebody else's.
 */
export const DELETE = route(async () => {
  const session = await requireSession();
  const me = session.person.id;

  const [groupSheets, directSheets] = await Promise.all([
    groupSheetsFor(me),
    directBalanceSheets(me),
  ]);
  const unsettledGroups = [...groupSheets.values()].some((sheet) => (sheet.net.get(me) ?? 0n) !== 0n);
  const unsettledDirect = [...directSheets.values()].some((sheet) => (sheet.net.get(me) ?? 0n) !== 0n);
  if (unsettledGroups || unsettledDirect) {
    throw new ValidationError(
      "You need to settle up with everyone first. You still owe money, or someone owes you.",
    );
  }

  const now = new Date();
  const ownerships = await prisma.membership.findMany({
    where: { personId: me, role: "owner", leftAt: null },
    select: { groupId: true },
  });

  await prisma.$transaction(async (tx) => {
    // Hand each group they own to its longest-standing remaining member, so
    // no group is left with nobody able to manage it.
    if (ownerships.length > 0) {
      const candidates = await tx.membership.findMany({
        where: {
          groupId: { in: ownerships.map((row) => row.groupId) },
          leftAt: null,
          personId: { not: me },
          person: { isGhost: false, deletedAt: null },
        },
        orderBy: { joinedAt: "asc" },
        select: { id: true, groupId: true },
      });
      const successors = new Map<string, string>();
      for (const row of candidates) {
        if (!successors.has(row.groupId)) successors.set(row.groupId, row.id);
      }
      if (successors.size > 0) {
        await tx.membership.updateMany({
          where: { id: { in: [...successors.values()] } },
          data: { role: "owner" },
        });
      }
    }

    await tx.membership.updateMany({
      where: { personId: me, leftAt: null },
      data: { leftAt: now, role: "member" },
    });
    await tx.credential.deleteMany({ where: { personId: me } });
    await tx.session.deleteMany({ where: { personId: me } });
    await tx.deviceLink.deleteMany({ where: { personId: me } });
    await tx.paymentMethod.deleteMany({ where: { personId: me } });
    await tx.budget.deleteMany({ where: { personId: me } });
    await tx.friendship.deleteMany({ where: { OR: [{ personAId: me }, { personBId: me }] } });
    await tx.comment.updateMany({
      where: { personId: me, deletedAt: null },
      data: { deletedAt: now, body: "" },
    });
    // Direct repeating expenses are theirs alone; group ones pause themselves
    // now that they have left (see `server/recurrence.ts`).
    await tx.recurrence.deleteMany({ where: { createdByPersonId: me, groupId: null } });

    await tx.person.update({
      where: { id: me },
      data: {
        displayName: "Deleted user",
        avatarEmoji: null,
        avatarColor: "sand",
        // A fresh, unredeemable handle: the old personal code must stop
        // resolving to anyone.
        inviteCode: `deleted-${generateGhostCode().slice("ghost-".length)}`,
        deletedAt: now,
      },
    });
  });

  await clearIdentityCookie();
  return json({ ok: true });
});
