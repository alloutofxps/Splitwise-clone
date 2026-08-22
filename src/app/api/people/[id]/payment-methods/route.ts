import { json, route } from "@/lib/api";
import { ForbiddenError, requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { areFriends } from "@/server/access";

type Params = { params: Promise<{ id: string }> };

/**
 * Somebody's payment handles, for the settle-up screen.
 *
 * Readable by people who share a group or a direct connection with them, and
 * nobody else. A UPI id or IBAN is not secret exactly, but it is not something
 * to hand to any caller who knows a person id either.
 */
export const GET = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();

  if (id !== session.person.id) {
    const connected = await areFriends(session.person.id, id);
    const sharesGroup = connected
      ? true
      : (await prisma.membership.count({
          where: {
            personId: id,
            leftAt: null,
            group: { memberships: { some: { personId: session.person.id, leftAt: null } } },
          },
        })) > 0;

    if (!sharesGroup) throw new ForbiddenError("You do not share a group with them.");
  }

  const paymentMethods = await prisma.paymentMethod.findMany({
    where: { personId: id },
    orderBy: { sortOrder: "asc" },
  });

  return json({ paymentMethods });
});
