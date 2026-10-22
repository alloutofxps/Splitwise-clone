import { prisma } from "@/lib/db";
import { getSession } from "@/lib/identity";
import { areFriends, sharesAGroup } from "@/server/access";

/*
 * What a group's or a person's screen is called in the browser and by screen
 * readers: "Lisbon 2026 · Divvy". Worked out on the server, so the name is
 * there as the screen arrives (set later in the browser, Next's own name for
 * the route could land after it and win).
 *
 * The same rules as the data itself: a name only for someone who may see it.
 * Anyone else gets null, and the route's general name ("Group") stands.
 */

/** The group's name, for one of its members. */
export async function groupPageName(groupId: string): Promise<string | null> {
  const session = await getSession();
  if (!session) return null;
  const membership = await prisma.membership.findUnique({
    where: { groupId_personId: { groupId, personId: session.person.id } },
    select: { leftAt: true, group: { select: { name: true } } },
  });
  return membership && !membership.leftAt ? membership.group.name : null;
}

/** A person's name, for someone who has added them or shares a group with them. */
export async function personPageName(personId: string): Promise<string | null> {
  const session = await getSession();
  if (!session) return null;
  const me = session.person.id;
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { displayName: true } });
  if (!person) return null;
  if (personId !== me && !(await areFriends(me, personId)) && !(await sharesAGroup(me, personId))) return null;
  return person.displayName;
}
