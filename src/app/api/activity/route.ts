import { json, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
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
  const before = url.searchParams.get("before");

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
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      OR: [
        { groupId: { in: groupIds } },
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
    include: { group: { select: { name: true, emoji: true } } },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
  });

  const items = activities.map((activity) =>
    activityDto(activity, activity.groupId ? lastReadByGroup.get(activity.groupId) ?? null : null),
  );

  return json({
    items,
    nextCursor: items.length === PAGE_SIZE ? items[items.length - 1].createdAt : null,
  });
});
