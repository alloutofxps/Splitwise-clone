import { z } from "zod";
import { json, readBody, route } from "@/lib/api";
import { requireSession, uniqueGroupCode } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  /** Turn the link off entirely, or rotate it to a fresh code. */
  action: z.enum(["rotate", "disable", "enable"]),
});

/**
 * Manages the group's invite link.
 *
 * The code is the only thing standing between a stranger and the group's
 * expenses, so it needs to be revocable: someone posts the link in the wrong
 * chat, you rotate it and re-share.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  await requireGroupAccess(id, session.person.id);
  const { action } = await readBody(request, schema);

  const data =
    action === "rotate"
      ? { inviteCode: await uniqueGroupCode(), inviteCodeActive: true }
      : { inviteCodeActive: action === "enable" };

  const group = await prisma.group.update({ where: { id }, data });

  return json({
    inviteCode: group.inviteCodeActive ? group.inviteCode : "",
    inviteCodeActive: group.inviteCodeActive,
  });
});
