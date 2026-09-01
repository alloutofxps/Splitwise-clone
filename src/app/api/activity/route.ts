import { json, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { beforeCursor, encodeCursor, parseCursor } from "@/server/cursor";
import { activityDto } from "@/server/read";

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
      OR: [
        // A nudge concerns two people even when the debt is a group one, so it
        // is addressed rather than broadcast: only its sender and its recipient
        // ever see it. Listed first so the group clause below cannot leak one
        // into everybody else's feed.
        { targetPersonId: session.person.id },
        {
          groupId: { in: groupIds },
          // Everything else in a group is group-wide by nature.
          targetPersonId: null,
        },
        { actorPersonId: session.person.id, targetPersonId: { not: null } },
        // Direct expenses have no group, so they are matched through the
        // expense's own participants.
        {
          groupId: null,
          expense: {
            OR: [
              { payers: { some: { personId: session.person.id } } },
              { splits: { some: { personId: session.person.id } } },
            ],
          },
        },
        {
          groupId: null,
          settlement: {
            OR: [
              { fromPersonId: session.person.id },
              { toPersonId: session.person.id },
            ],
          },
        },
      ],
    },
    include: {
      group: { select: { name: true, emoji: true } },
      // Whether the thing a deletion entry points at is *still* deleted. An
      // Undo on a row somebody already undid would do nothing and say nothing,
      // which is worse than no button at all.
      expense: { select: { deletedAt: true } },
      settlement: { select: { deletedAt: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
  });

  const page = activities.slice(0, PAGE_SIZE);
  const hasMore = activities.length > PAGE_SIZE;

  const items = page.map((activity) =>
    activityDto(activity, activity.groupId ? lastReadByGroup.get(activity.groupId) ?? null : null),
  );

  const last = page[page.length - 1];

  return json({
    items,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  });
});
