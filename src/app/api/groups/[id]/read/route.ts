import { json, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";

type Params = { params: Promise<{ id: string }> };

/** Marks the group's activity as seen up to now. */
export const POST = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  await requireGroupAccess(id, session.person.id);

  await prisma.membership.update({
    where: { groupId_personId: { groupId: id, personId: session.person.id } },
    data: { lastReadActivityAt: new Date() },
  });

  return json({ ok: true });
});
