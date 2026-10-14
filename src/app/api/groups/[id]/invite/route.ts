import { z } from "zod";
import { json, readBody, route } from "@/lib/api";
import { ForbiddenError, requireSession, uniqueGroupCode } from "@/lib/identity";
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
  const { group: current, isOwner } = await requireGroupAccess(id, session.person.id);
  const { action } = await readBody(request, schema);

  /*
   * Anyone can close the door: disabling or rotating is what you do the moment
   * a link turns up in the wrong chat, and it should not wait for the owner.
   * Opening it is the owner's call - otherwise one member could undo the
   * owner's "nobody else joins" by switching the link straight back on.
   */
  if (action === "enable" && !isOwner) {
    throw new ForbiddenError("Only whoever created the group can turn the invite link back on.");
  }

  const data =
    action === "rotate"
      ? {
          inviteCode: await uniqueGroupCode(),
          // A member rotating a switched-off link gets a fresh code that stays
          // off; only the owner's rotate also re-opens it.
          inviteCodeActive: isOwner ? true : current.inviteCodeActive,
        }
      : { inviteCodeActive: action === "enable" };

  const group = await prisma.group.update({ where: { id }, data });

  return json({
    inviteCode: group.inviteCodeActive ? group.inviteCode : "",
    inviteCodeActive: group.inviteCodeActive,
  });
});
