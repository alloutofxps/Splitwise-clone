import { z } from "zod";
import { currencyCode, json, readBody, route, text } from "@/lib/api";
import { ForbiddenError, requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { balanceSheetDto, groupBalanceSheet, personDto } from "@/server/read";
import { requireGroupAccess, requireGroupOwner } from "@/server/access";
import { recordActivity } from "@/server/write";
import type { GroupDetailDto } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  const { group, membership } = await requireGroupAccess(id, session.person.id);

  const [memberships, sheet, lastActivity, unreadCount] = await Promise.all([
    prisma.membership.findMany({
      where: { groupId: id, leftAt: null },
      include: { person: true },
      orderBy: { joinedAt: "asc" },
    }),
    groupBalanceSheet(id),
    prisma.activity.findFirst({
      where: { groupId: id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.activity.count({
      where: {
        groupId: id,
        createdAt: { gt: membership.lastReadActivityAt },
        actorPersonId: { not: session.person.id },
      },
    }),
  ]);

  const detail: GroupDetailDto = {
    id: group.id,
    name: group.name,
    kind: group.kind,
    emoji: group.emoji,
    color: group.color,
    currency: group.currency,
    simplifyDebts: group.simplifyDebts,
    inviteCode: group.inviteCodeActive ? group.inviteCode : "",
    archivedAt: group.archivedAt?.toISOString() ?? null,
    createdAt: group.createdAt.toISOString(),
    memberCount: memberships.length,
    members: memberships.map((m) => personDto(m.person)),
    yourNet: (sheet.net.get(session.person.id) ?? 0n).toString(),
    totalSpend: sheet.totalSpend.toString(),
    lastActivityAt: lastActivity?.createdAt.toISOString() ?? null,
    unreadCount,
    balances: balanceSheetDto(sheet, group.currency),
  };

  return json({ group: detail });
});

const updateSchema = z.object({
  name: text(60, "The group name").optional(),
  kind: z.string().trim().max(20).optional(),
  emoji: z.string().trim().max(8).optional(),
  color: z.string().trim().max(20).optional(),
  currency: currencyCode.optional(),
  simplifyDebts: z.boolean().optional(),
  archived: z.boolean().optional(),
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
    const expenseCount = await prisma.expense.count({
      where: { groupId: id, deletedAt: null },
    });
    if (expenseCount > 0) {
      throw new ValidationError(
        "The group currency can only change while the group has no expenses.",
      );
    }
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
    changes.push(input.simplifyDebts ? "turned on debt simplification" : "turned off debt simplification");
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
      "Settle the group up before deleting it, or archive it instead to keep the history.",
    );
  }

  await prisma.group.delete({ where: { id } });
  return json({ ok: true });
});
