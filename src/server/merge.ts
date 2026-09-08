/**
 * Absorbing a placeholder into the person it was standing in for.
 *
 * A placeholder is created the moment somebody types a name into a group, and
 * it starts collecting that person's share straight away. Usually the story
 * ends with `claimGhost`: the real person turns up with no account, says
 * "that's me", and the placeholder row is upgraded in place, so every expense
 * already filed against it simply becomes theirs.
 *
 * The case this file exists for is the other one. The person already has an
 * account — they were added by a friend last month, or they joined the group
 * from a link — and now there are two of them: a real account and a stale
 * placeholder holding a slice of the ledger. `claimGhost` cannot help, because
 * there is nothing left to claim; the account exists. Somebody has to say the
 * two rows are one person, and every row that names the placeholder has to move
 * across.
 *
 * The whole point of the move is that nobody's balance changes. Merging is an
 * assertion about identity, not about money: it says two names were always one
 * person, so every debt those names carry is the same debt it was, just added
 * up differently. Anything that could quietly break that — a payment recorded
 * between the two, a share the placeholder holds that the real person also
 * holds — is either combined arithmetically or refused outright. Nothing here
 * discards a row.
 *
 * Two callers, one set of mechanics. `absorbGhost` is the move itself and
 * takes no view on who asked; the invite-join route calls it directly, because
 * redeeming a live invite code and pointing at a placeholder in that group is
 * already the whole permission story. `mergeGhostInto` wraps it in the policy
 * the standalone endpoint needs, where the caller is a third party saying two
 * *other* rows are one person. They were separate implementations for a while,
 * and the second one drifted: it forgot `settlement.createdByPersonId` and
 * every recurrence template, either of which is a foreign key onto a row about
 * to be deleted.
 */

import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/identity";
import { sharesAGroup, areFriends } from "@/server/access";
import type { Prisma } from "@prisma/client";

/** One entry of a recurrence's stored payer or split template. */
interface TemplateEntry {
  personId: string;
  amount?: string;
  included?: boolean;
  weight?: number | null;
  percent?: number | null;
  adjustment?: string | null;
}

export interface MergeResult {
  /** The surviving person's id — always `intoPersonId`. */
  personId: string;
  /** What moved, so the caller can say something truthful afterwards. */
  moved: {
    memberships: number;
    payers: number;
    splits: number;
    itemShares: number;
    settlements: number;
    comments: number;
    activities: number;
    expensesCreated: number;
    recurrences: number;
  };
}

/**
 * Whether the caller is entitled to say these two rows are one person.
 *
 * Merging rewrites who owes what across every group the placeholder appears
 * in, so the bar is higher than "can see the name". The caller has to share a
 * group with the placeholder — meaning they are in the ledger it belongs to —
 * and has to actually know the real person, by a group or by friendship. That
 * second half is what stops somebody folding a placeholder into a stranger's
 * account and handing them a debt they never agreed to.
 */
async function assertMayMerge(actorId: string, ghostId: string, intoId: string): Promise<void> {
  if (!(await sharesAGroup(actorId, ghostId))) {
    throw new ForbiddenError("You are not in a group with that placeholder.");
  }
  if (intoId === actorId) return;
  if ((await sharesAGroup(actorId, intoId)) || (await areFriends(actorId, intoId))) return;
  throw new ForbiddenError("You can only merge a placeholder into somebody you already know.");
}

/**
 * Refuses the cases where merging would have to invent or destroy money.
 *
 * A payment recorded between the placeholder and the person would become a
 * payment from somebody to themselves, which is not a thing that can happen. It
 * means one of the two facts is wrong — either they are not the same person, or
 * that settlement was filed against the wrong name — and only the person
 * looking at it knows which. Guessing here would move a balance silently, so
 * the merge stops and says what to fix.
 */
async function assertNoSelfPayment(tx: Tx, ghostId: string, intoId: string): Promise<void> {
  const between = await tx.settlement.count({
    where: {
      deletedAt: null,
      OR: [
        { fromPersonId: ghostId, toPersonId: intoId },
        { fromPersonId: intoId, toPersonId: ghostId },
      ],
    },
  });
  if (between > 0) {
    throw new ConflictError(
      "There is a payment recorded between those two. Delete it first, then merge — keeping it would mean somebody paid themselves.",
    );
  }
}

/**
 * Rewrites a recurrence template so the placeholder's entry becomes the real
 * person's, combining the two if both appear.
 *
 * Returns null when nothing referred to the placeholder, so the caller can skip
 * the write rather than rewriting every template in the database.
 */
export function remapTemplate(raw: string, ghostId: string, intoId: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const entries = parsed as TemplateEntry[];
  if (!entries.some((entry) => entry?.personId === ghostId)) return null;

  const merged: TemplateEntry[] = [];
  const byPerson = new Map<string, TemplateEntry>();

  for (const entry of entries) {
    const personId = entry.personId === ghostId ? intoId : entry.personId;
    const existing = byPerson.get(personId);

    if (!existing) {
      const copy = { ...entry, personId };
      byPerson.set(personId, copy);
      merged.push(copy);
      continue;
    }

    // Both names carried a share of the same template. One person cannot hold
    // two shares, so the shares add up — which is what keeps the generated
    // expense summing to the same total it did before.
    existing.amount = addMinor(existing.amount, entry.amount);
    existing.adjustment = addMinor(existing.adjustment, entry.adjustment) ?? null;
    existing.weight = addNumber(existing.weight, entry.weight);
    existing.percent = addNumber(existing.percent, entry.percent);
    existing.included = Boolean(existing.included) || Boolean(entry.included);
  }

  return JSON.stringify(merged);
}

/** Adds two decimal-string minor-unit amounts, tolerating absent ones. */
function addMinor(a: string | null | undefined, b: string | null | undefined): string | undefined {
  if (a == null && b == null) return undefined;
  const left = a == null ? 0n : BigInt(a);
  const right = b == null ? 0n : BigInt(b);
  return (left + right).toString();
}

/** Adds two optional weights or percentages, keeping null when both are null. */
function addNumber(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

/**
 * Folds `ghostId` into `intoPersonId`, with no view on who asked.
 *
 * This is the mechanical half: the identity checks that always hold wherever
 * the merge is initiated from, and then the move. Callers own the question of
 * *who* may say these two rows are one person — for the invite-join route that
 * is a live invite code plus a placeholder in that group, and for the merge
 * endpoint it is `assertMayMerge` below.
 *
 * Every table that names a person is walked, not just the ones that carry
 * money: an expense whose author is deleted takes the expense with it, and a
 * membership left behind would show the group a person who no longer exists.
 * The unique constraints are the interesting part — `(expenseId, personId)` on
 * payers and splits, `(itemId, personId)` on item shares, `(groupId, personId)`
 * on membership — because each one is a place where the two rows can already
 * both exist. Where the row carries an amount the two are summed, which is
 * exactly balance-conserving; where it does not, the surviving person's row is
 * kept and the placeholder's dropped.
 *
 * The whole thing runs in one transaction: a half-moved placeholder is a
 * ledger that does not add up.
 */
export async function absorbGhost(ghostId: string, intoPersonId: string): Promise<MergeResult> {
  if (ghostId === intoPersonId) {
    throw new ConflictError("That placeholder is already that person.");
  }

  return prisma.$transaction(async (tx) => {
    const [ghost, into] = await Promise.all([
      tx.person.findUnique({
        where: { id: ghostId },
        include: { credentials: { select: { id: true }, take: 1 } },
      }),
      tx.person.findUnique({ where: { id: intoPersonId } }),
    ]);

    if (!ghost) throw new NotFoundError("That placeholder no longer exists.");
    if (!into) throw new NotFoundError("That person no longer exists.");

    // Only a placeholder may be dissolved. Two real accounts are two real
    // people with their own recovery keys and their own devices, and merging
    // them would delete one of them out from under whoever is holding it.
    //
    // Read inside the transaction on purpose: two people racing to claim the
    // same placeholder both pass a check made outside it, and the loser would
    // then merge a row the winner had already dissolved.
    if (!ghost.isGhost || ghost.credentials.length > 0) {
      throw new ForbiddenError(
        "That is a real account, not a placeholder. It cannot be merged away.",
      );
    }
    if (into.isGhost) {
      throw new ForbiddenError("A placeholder can only be merged into a real account.");
    }

    await assertNoSelfPayment(tx, ghostId, intoPersonId);

    const moved = {
      memberships: 0,
      payers: 0,
      splits: 0,
      itemShares: 0,
      settlements: 0,
      comments: 0,
      activities: 0,
      expensesCreated: 0,
      recurrences: 0,
    };

    moved.memberships = await moveMemberships(tx, ghostId, intoPersonId);
    moved.payers = await movePayers(tx, ghostId, intoPersonId);
    moved.splits = await moveSplits(tx, ghostId, intoPersonId);
    moved.itemShares = await moveItemShares(tx, ghostId, intoPersonId);

    const from = await tx.settlement.updateMany({
      where: { fromPersonId: ghostId },
      data: { fromPersonId: intoPersonId },
    });
    const to = await tx.settlement.updateMany({
      where: { toPersonId: ghostId },
      data: { toPersonId: intoPersonId },
    });
    moved.settlements = from.count + to.count;

    // The author of a payment is a foreign key like any other, and the row it
    // points at is about to be deleted.
    await tx.settlement.updateMany({
      where: { createdByPersonId: ghostId },
      data: { createdByPersonId: intoPersonId },
    });

    moved.comments = (
      await tx.comment.updateMany({ where: { personId: ghostId }, data: { personId: intoPersonId } })
    ).count;

    const actor = await tx.activity.updateMany({
      where: { actorPersonId: ghostId },
      data: { actorPersonId: intoPersonId },
    });
    const target = await tx.activity.updateMany({
      where: { targetPersonId: ghostId },
      data: { targetPersonId: intoPersonId },
    });
    moved.activities = actor.count + target.count;

    moved.expensesCreated = (
      await tx.expense.updateMany({
        where: { createdByPersonId: ghostId },
        data: { createdByPersonId: intoPersonId },
      })
    ).count;

    await tx.recurrence.updateMany({
      where: { createdByPersonId: ghostId },
      data: { createdByPersonId: intoPersonId },
    });
    moved.recurrences = await moveRecurrenceTemplates(tx, ghostId, intoPersonId);

    // A placeholder has no budgets or payment methods of its own — it has never
    // signed in — but the rows are person-owned and cheap to carry across,
    // and leaving them would delete them with the row.
    await tx.budget.updateMany({ where: { personId: ghostId }, data: { personId: intoPersonId } });
    await tx.paymentMethod.updateMany({
      where: { personId: ghostId },
      data: { personId: intoPersonId },
    });

    await moveFriendships(tx, ghostId, intoPersonId);

    await tx.person.delete({ where: { id: ghostId } });

    return { personId: intoPersonId, moved };
  });
}

/**
 * The merge as a third party performs it: "that placeholder is actually them."
 *
 * Distinct from the invite-join path, where the person doing the merging is the
 * one being merged into and has just proved it with a code. Here somebody is
 * making a claim about two other people, so who they are matters.
 */
export async function mergeGhostInto(
  actorId: string,
  ghostId: string,
  intoPersonId: string,
): Promise<MergeResult> {
  await assertMayMerge(actorId, ghostId, intoPersonId);
  return absorbGhost(ghostId, intoPersonId);
}

type Tx = Prisma.TransactionClient;

/**
 * Membership carries no money, so where both rows exist the placeholder's is
 * simply dropped — but its `joinedAt` is kept when it is the earlier of the
 * two, because that is when this person's history in the group actually starts.
 */
async function moveMemberships(tx: Tx, ghostId: string, intoId: string): Promise<number> {
  const rows = await tx.membership.findMany({ where: { personId: ghostId } });
  let moved = 0;

  for (const row of rows) {
    const existing = await tx.membership.findUnique({
      where: { groupId_personId: { groupId: row.groupId, personId: intoId } },
    });

    if (!existing) {
      await tx.membership.update({ where: { id: row.id }, data: { personId: intoId } });
      moved += 1;
      continue;
    }

    if (row.joinedAt < existing.joinedAt || (existing.leftAt !== null && row.leftAt === null)) {
      await tx.membership.update({
        where: { id: existing.id },
        data: {
          joinedAt: row.joinedAt < existing.joinedAt ? row.joinedAt : existing.joinedAt,
          leftAt: row.leftAt === null ? null : existing.leftAt,
        },
      });
    }
    await tx.membership.delete({ where: { id: row.id } });
  }

  return moved;
}

/** Two payers on one expense become one payer who put down the sum. */
async function movePayers(tx: Tx, ghostId: string, intoId: string): Promise<number> {
  const rows = await tx.expensePayer.findMany({ where: { personId: ghostId } });
  let moved = 0;

  for (const row of rows) {
    const existing = await tx.expensePayer.findUnique({
      where: { expenseId_personId: { expenseId: row.expenseId, personId: intoId } },
    });

    if (!existing) {
      await tx.expensePayer.update({ where: { id: row.id }, data: { personId: intoId } });
    } else {
      await tx.expensePayer.update({
        where: { id: existing.id },
        data: { amount: existing.amount + row.amount },
      });
      await tx.expensePayer.delete({ where: { id: row.id } });
    }
    moved += 1;
  }

  return moved;
}

/**
 * Two shares of one expense become one share of the sum.
 *
 * The split's descriptive fields are summed alongside the amount so an
 * itemised or percentage split still describes the amount it produced. Summing
 * percentages is right for the same reason summing amounts is: the two names
 * held 30% and 20% of a bill that one person was always paying 50% of.
 */
async function moveSplits(tx: Tx, ghostId: string, intoId: string): Promise<number> {
  const rows = await tx.expenseSplit.findMany({ where: { personId: ghostId } });
  let moved = 0;

  for (const row of rows) {
    const existing = await tx.expenseSplit.findUnique({
      where: { expenseId_personId: { expenseId: row.expenseId, personId: intoId } },
    });

    if (!existing) {
      await tx.expenseSplit.update({ where: { id: row.id }, data: { personId: intoId } });
    } else {
      await tx.expenseSplit.update({
        where: { id: existing.id },
        data: {
          amount: existing.amount + row.amount,
          included: existing.included || row.included,
          weight: addNumber(existing.weight, row.weight),
          percent: addNumber(existing.percent, row.percent),
          adjustment: (existing.adjustment ?? 0n) + (row.adjustment ?? 0n),
        },
      });
      await tx.expenseSplit.delete({ where: { id: row.id } });
    }
    moved += 1;
  }

  return moved;
}

/** Two shares of one receipt line become one share of the combined weight. */
async function moveItemShares(tx: Tx, ghostId: string, intoId: string): Promise<number> {
  const rows = await tx.expenseItemShare.findMany({ where: { personId: ghostId } });
  let moved = 0;

  for (const row of rows) {
    const existing = await tx.expenseItemShare.findUnique({
      where: { itemId_personId: { itemId: row.itemId, personId: intoId } },
    });

    if (!existing) {
      await tx.expenseItemShare.update({ where: { id: row.id }, data: { personId: intoId } });
    } else {
      await tx.expenseItemShare.update({
        where: { id: existing.id },
        data: { weight: existing.weight + row.weight },
      });
      await tx.expenseItemShare.delete({ where: { id: row.id } });
    }
    moved += 1;
  }

  return moved;
}

/**
 * A placeholder cannot have friends of its own, but it can appear on the other
 * side of one if it was ever claimed and un-claimed by a migration. Rows are
 * moved where the pair does not already exist, and dropped where it does or
 * where the move would befriend the person with themselves.
 */
async function moveFriendships(tx: Tx, ghostId: string, intoId: string): Promise<void> {
  const rows = await tx.friendship.findMany({
    where: { OR: [{ personAId: ghostId }, { personBId: ghostId }] },
  });

  for (const row of rows) {
    const other = row.personAId === ghostId ? row.personBId : row.personAId;
    if (other === intoId) {
      await tx.friendship.delete({ where: { id: row.id } });
      continue;
    }

    const [personAId, personBId] = intoId < other ? [intoId, other] : [other, intoId];
    const existing = await tx.friendship.findUnique({
      where: { personAId_personBId: { personAId, personBId } },
    });
    if (existing) {
      await tx.friendship.delete({ where: { id: row.id } });
    } else {
      await tx.friendship.update({ where: { id: row.id }, data: { personAId, personBId } });
    }
  }
}

/** Rewrites every recurrence template that names the placeholder. */
async function moveRecurrenceTemplates(tx: Tx, ghostId: string, intoId: string): Promise<number> {
  const rows = await tx.recurrence.findMany({
    select: { id: true, payersJson: true, splitsJson: true },
  });
  let touched = 0;

  for (const row of rows) {
    const payersJson = remapTemplate(row.payersJson, ghostId, intoId);
    const splitsJson = remapTemplate(row.splitsJson, ghostId, intoId);
    if (payersJson === null && splitsJson === null) continue;

    await tx.recurrence.update({
      where: { id: row.id },
      data: {
        ...(payersJson === null ? {} : { payersJson }),
        ...(splitsJson === null ? {} : { splitsJson }),
      },
    });
    touched += 1;
  }

  return touched;
}
