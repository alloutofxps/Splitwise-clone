import { json, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { beforeCursor, encodeCursor, parseCursor } from "@/server/cursor";
import { activityDto, feedScope } from "@/server/read";

const PAGE_SIZE = 50;

/**
 * The global activity feed: everything that happened in any of your groups,
 * plus direct expenses you are part of.
 *
 * Unread state is per-group and lives on the membership row, so opening one
 * group does not silently mark another one read.
 */
export const GET = route(async (request: Request) => {
  const session = await requireSession();
  const url = new URL(request.url);
  const cursor = parseCursor(url.searchParams.get("before"));

  const memberships = await prisma.membership.findMany({
    where: { personId: session.person.id, leftAt: null },
    select: { groupId: true, lastReadActivityAt: true },
  });

  const groupIds = memberships.map((m) => m.groupId);
  const lastReadByGroup = new Map(
    memberships.map((m) => [m.groupId, m.lastReadActivityAt]),
  );

  const activities = await prisma.activity.findMany({
    where: {
      // (createdAt, id), not createdAt alone. A single app-open can write
      // several activity rows inside the same millisecond - a recurrence
      // catching up on three months does exactly that - and a bare `lt` cursor
      // drops every one of them but the first at a page boundary.
      AND: beforeCursor("createdAt", cursor),
      // The same scope as the unread badge (see feedScope in server/read.ts):
      // a reminder is shown only to its sender and recipient, everything else
      // in a group to the group, and entries outside groups to the people on
      // them.
      OR: feedScope(session.person.id, groupIds),
    },
    include: {
      group: { select: { name: true, emoji: true } },
      // Whether the thing a deletion entry points at is *still* deleted. An
      // Undo on a row somebody already undid would do nothing and say nothing,
      // which is worse than no button at all.
      // Who shared it, for an expense outside any group: the row has no group
      // name to give it context, so it says who it was with instead.
      expense: { select: { deletedAt: true, groupId: true, splits: { select: { personId: true } } } },
      settlement: { select: { deletedAt: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
  });

  const page = activities.slice(0, PAGE_SIZE);
  const hasMore = activities.length > PAGE_SIZE;

  const items = page.map((activity) =>
    activityDto(
      activity,
      activity.groupId ? lastReadByGroup.get(activity.groupId) ?? null : null,
      { id: session.person.id, activitySeenAt: session.person.activitySeenAt ?? null },
    ),
  );

  const last = page[page.length - 1];

  return json({
    items,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  });
});
