/**
 * Combining two real accounts that belong to one person.
 *
 * It happens because a link opens in the browser even with Divvy on the home
 * screen, and on an iPhone the two don't share a sign-in: someone tapping an
 * invite could end up a second person (findings item 60).
 *
 * This is `absorbGhost` with a higher bar. A placeholder has no owner, so a live
 * invite code is enough to claim one. An account has one, so the caller must be
 * signed in to the account that stays, and must prove they own the other one
 * with a sign-in code from it or its recovery key.
 *
 * As with a placeholder, nobody's balance changes: two names were always one
 * person, so every debt is the same debt, added up differently. What's different
 * is what a real account has and a placeholder doesn't. Its recovery key and
 * passkeys keep working and now open the account that stays, so a key saved
 * months ago still gets its owner in. Its devices stay signed in, as that
 * account.
 */

import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { signInCodeIn } from "@/lib/invite-code";
import { hashSecret } from "@/lib/codes";
import { personForRecoveryKey } from "@/lib/identity";
import { liveDeviceLink } from "@/server/device-link";
import { assertNoSelfPayment, moveRows, type MergeResult } from "@/server/merge";
import { bumpLedger } from "@/server/ledger";
import type { Person, Prisma } from "@/generated/prisma/client";

export interface OtherAccount {
  person: Person;
  /** The sign-in code that proved it, spent when the accounts are combined. */
  linkId?: string;
}

/**
 * Whose account this proof opens. Reads only, so showing what would move before
 * asking doesn't use up the code.
 */
export async function otherAccountFor(proof: string, meId: string): Promise<OtherAccount> {
  const text = proof.trim();
  const other: OtherAccount = text.startsWith("dvy_")
    ? { person: await personForRecoveryKey(text) }
    : await (async () => {
        const link = await liveDeviceLink(hashSecret(signInCodeIn(text)));
        return { person: link.person, linkId: link.id };
      })();

  if (other.person.id === meId) {
    throw new ConflictError("That's the account you're signed in to. Use a code from the other one.");
  }
  if (other.person.isGhost || other.person.deletedAt) {
    throw new NotFoundError("That account can't be combined.");
  }
  return other;
}

/** Bills between just the two: once they're one person, these mean nothing. */
function directBetween(a: string, b: string): Prisma.ExpenseWhereInput {
  const involves = (id: string): Prisma.ExpenseWhereInput => ({
    OR: [{ payers: { some: { personId: id } } }, { splits: { some: { personId: id } } }],
  });
  return { groupId: null, deletedAt: null, AND: [involves(a), involves(b)] };
}

/**
 * The cases that would have to invent money, refused before anything moves. Only
 * the person looking at them knows which of the two facts is wrong.
 */
export async function assertCanCombine(
  client: Prisma.TransactionClient | typeof prisma,
  keepId: string,
  otherId: string,
): Promise<void> {
  await assertNoSelfPayment(client, otherId, keepId);

  if ((await client.expense.count({ where: directBetween(keepId, otherId) })) > 0) {
    throw new ConflictError(
      "There's a bill between just these two accounts. Delete it first, or you'd owe yourself.",
    );
  }
  const repeating = await client.recurrence.count({
    where: {
      groupId: null,
      AND: [
        { OR: [{ payersJson: { contains: keepId } }, { splitsJson: { contains: keepId } }] },
        { OR: [{ payersJson: { contains: otherId } }, { splitsJson: { contains: otherId } }] },
      ],
    },
  });
  if (repeating > 0) {
    throw new ConflictError(
      "There's a repeating bill between just these two accounts. Stop it first, or you'd owe yourself.",
    );
  }
}

/** What would come across, to show before asking. */
export async function combinePreview(otherId: string) {
  const [groups, expenses] = await Promise.all([
    prisma.membership.count({ where: { personId: otherId, leftAt: null } }),
    prisma.expense.count({
      where: {
        deletedAt: null,
        OR: [
          { createdByPersonId: otherId },
          { payers: { some: { personId: otherId } } },
          { splits: { some: { personId: otherId } } },
        ],
      },
    }),
  ]);
  return { groups, expenses };
}

/**
 * Folds the other account into the one that stays. One transaction: a half-moved
 * account is a ledger that doesn't add up, and a failure leaves both as they were.
 */
export async function combineAccounts(
  keepId: string,
  otherId: string,
  linkId?: string,
): Promise<MergeResult & { groupIds: string[]; otherName: string }> {
  if (keepId === otherId) throw new ConflictError("That's already the same account.");

  return prisma.$transaction(async (tx) => {
    const [keep, other] = await Promise.all([
      tx.person.findUnique({ where: { id: keepId } }),
      tx.person.findUnique({ where: { id: otherId } }),
    ]);
    if (!keep || keep.isGhost || keep.deletedAt) throw new ForbiddenError("This account can't be combined.");
    if (!other || other.isGhost || other.deletedAt) throw new NotFoundError("That account can't be combined.");

    // Spent here, in the same transaction: two taps can't both use one code.
    if (linkId) {
      const spent = await tx.deviceLink.updateMany({
        where: { id: linkId, personId: otherId, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (spent.count === 0) throw new ConflictError("That code has already been used. Ask for a new one.");
    }

    await assertCanCombine(tx, keepId, otherId);

    const groupIds = (
      await tx.membership.findMany({ where: { personId: otherId }, select: { groupId: true } })
    ).map((row) => row.groupId);

    const moved = await moveRows(tx, otherId, keepId, groupIds, { direct: true });

    // What only a real account has. Credentials and devices move rather than
    // go, so nobody is locked out by having tidied up.
    await tx.credential.updateMany({ where: { personId: otherId }, data: { personId: keepId } });
    await tx.session.updateMany({ where: { personId: otherId }, data: { personId: keepId } });
    await tx.pushSubscription.updateMany({ where: { personId: otherId }, data: { personId: keepId } });
    await tx.deviceLink.deleteMany({ where: { personId: otherId } });
    await tx.expense.updateMany({ where: { lastEditedById: otherId }, data: { lastEditedById: keepId } });
    await tx.person.updateMany({ where: { createdByPersonId: otherId }, data: { createdByPersonId: keepId } });

    await bumpLedger(tx, groupIds);

    // Deleting a person takes their shares with them. Nothing should be left to
    // take, and if something is, this undoes the lot rather than lose money.
    const left = await Promise.all([
      tx.expensePayer.count({ where: { personId: otherId } }),
      tx.expenseSplit.count({ where: { personId: otherId } }),
      tx.expenseItemShare.count({ where: { personId: otherId } }),
      tx.membership.count({ where: { personId: otherId } }),
      tx.settlement.count({ where: { OR: [{ fromPersonId: otherId }, { toPersonId: otherId }, { createdByPersonId: otherId }] } }),
    ]);
    if (left.some((count) => count > 0)) throw new Error(`Combining left rows behind: ${left.join(",")}`);

    await tx.person.delete({ where: { id: otherId } });

    return { personId: keepId, moved, groupIds, otherName: other.displayName };
  });
}
