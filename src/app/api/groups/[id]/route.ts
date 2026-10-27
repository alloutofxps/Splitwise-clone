import { z } from "zod";
import { currencyCode, json, readBody, route, text } from "@/lib/api";
import { ForbiddenError, requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { balanceSheetDto, groupBalanceSheet, groupMembershipsFor, groupSummaries } from "@/server/read";
import { requireGroupAccess, requireGroupOwner } from "@/server/access";
import { recordActivity } from "@/server/write";
import type { GroupDetailDto } from "@/lib/types";
import { ACCEPTED_COLORS, normalizeColor } from "@/lib/avatar";
import { defaultSplitProblem } from "@/lib/default-split";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  const { group } = await requireGroupAccess(id, session.person.id);

  // The same row Home shows for this group, so the two can't disagree about
  // what's unread, plus what only this screen needs.
  const [memberships, sheet] = await Promise.all([
    groupMembershipsFor(session.person.id, id),
    groupBalanceSheet(id),
  ]);
  const [summary] = await groupSummaries(session.person.id, {
    memberships,
    sheets: new Map([[id, sheet]]),
    seenAt: session.person.activitySeenAt ?? null,
  });
  // Left the group between the access check and now.
  if (!summary) throw new ForbiddenError("You're not in that group.");

  const detail: GroupDetailDto = {
    ...summary,
    createdAt: group.createdAt.toISOString(),
    balances: balanceSheetDto(sheet, group.currency),
  };

  return json({ group: detail });
});

const updateSchema = z.object({
  name: text(60, "The group name").optional(),
  kind: z.enum(["trip", "home", "couple", "event", "project", "other"]).optional(),
  emoji: z.string().trim().max(8).optional(),
  color: z.enum(ACCEPTED_COLORS).transform(normalizeColor).optional(),
  currency: currencyCode.optional(),
  simplifyDebts: z.boolean().optional(),
  archived: z.boolean().optional(),
  /** The usual split, or null to go back to splitting equally. */
  defaultSplit: z
    .object({
      mode: z.enum(["PERCENT", "SHARES"]),
      entries: z
        .array(z.object({ personId: z.string().max(80), value: z.number().finite().min(0).max(1_000_000) }))
        .min(1)
        .max(100),
    })
    .nullable()
    .optional(),
});

export const PATCH = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  const { group } = await requireGroupAccess(id, session.person.id);
  const input = await readBody(request, updateSchema);

  // Changing the settlement currency would invalidate every cached
  // `convertedAmount` in the group, so it is only allowed while the group is
  // still empty. After that the honest answer is "make a new group".
  if (input.currency && input.currency !== group.currency) {
    // Every row that carries an amount in the old currency counts - deleted
    // ones too, because restoring one would bring back a converted amount in
    // the wrong currency, and recurrences, which would keep posting in it.
    const [expenseCount, settlementCount, recurrenceCount] = await Promise.all([
      prisma.expense.count({ where: { groupId: id } }),
      prisma.settlement.count({ where: { groupId: id } }),
      prisma.recurrence.count({ where: { groupId: id } }),
    ]);
    if (expenseCount + settlementCount + recurrenceCount > 0) {
      throw new ValidationError(
        "You can only change the currency before any expenses are added.",
      );
    }
  }

  if (input.defaultSplit) {
    const members = await prisma.membership.findMany({
      where: { groupId: id, leftAt: null },
      select: { personId: true },
    });
    const problem = defaultSplitProblem(input.defaultSplit, members.map((m) => m.personId));
    if (problem) throw new ValidationError(problem);
  }

  const updated = await prisma.group.update({
    where: { id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.emoji ? { emoji: input.emoji } : {}),
      ...(input.color ? { color: input.color } : {}),
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.simplifyDebts !== undefined ? { simplifyDebts: input.simplifyDebts } : {}),
      ...(input.defaultSplit !== undefined
        ? {
            defaultSplit: input.defaultSplit
              ? JSON.stringify({
                  mode: input.defaultSplit.mode,
                  // Nobody at zero: they are simply not part of the usual split.
                  entries: input.defaultSplit.entries.filter((e) => e.value > 0),
                })
              : null,
          }
        : {}),
      ...(input.archived !== undefined
        ? { archivedAt: input.archived ? new Date() : null }
        : {}),
    },
  });

  /**
   * What actually changed, so the feed can say it.
   *
   * Compared against the values the group held before the update rather than
   * taken from the request body: a field can be sent carrying the value it
   * already had, and "renamed it to Lisbon 2026" is a lie when the name was
   * already that. Only archiving and the simplify toggle are worth naming in
   * both directions; the rest read the same either way.
   */
  const changes: string[] = [];
  if (input.name && input.name !== group.name) changes.push(`renamed it ${updated.name}`);
  if (input.emoji && input.emoji !== group.emoji) changes.push("changed the icon");
  if (input.color && input.color !== group.color) changes.push("changed the colour");
  if (input.kind && input.kind !== group.kind) changes.push("changed the type");
  if (input.currency && input.currency !== group.currency) {
    changes.push(`set the currency to ${updated.currency}`);
  }
  if (input.simplifyDebts !== undefined && input.simplifyDebts !== group.simplifyDebts) {
    changes.push(input.simplifyDebts ? "turned on Simplify debts" : "turned off Simplify debts");
  }
  if (input.defaultSplit !== undefined && JSON.stringify(input.defaultSplit) !== (group.defaultSplit ?? "null")) {
    changes.push(input.defaultSplit ? "changed the usual split" : "went back to splitting equally");
  }
  if (input.archived !== undefined && input.archived !== Boolean(group.archivedAt)) {
    changes.push(input.archived ? "archived it" : "unarchived it");
  }

  // Nothing actually moved — a no-op save should not fill the feed.
  if (changes.length === 0) return json({ ok: true });

  await recordActivity({
    type: "group.updated",
    actorPersonId: session.person.id,
    groupId: id,
    data: { groupName: updated.name, changes },
  });

  return json({ ok: true });
});

/**
 * Deletes a group outright, along with every expense in it.
 *
 * Only the owner, and only when the group has settled - deleting a group with
 * live balances destroys the record of who owes whom, which is exactly the
 * thing people open this app to find out.
 */
export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  await requireGroupOwner(id, session.person.id);

  const sheet = await groupBalanceSheet(id);
  const outstanding = [...sheet.net.values()].some((value) => value !== 0n);
  if (outstanding) {
    throw new ForbiddenError(
      "Everyone needs to be settled up before you delete the group. Or archive it to hide it and keep its history.",
    );
  }

  await prisma.group.delete({ where: { id } });
  return json({ ok: true });
});
