import { json, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError, requireSession } from "@/lib/identity";

type Params = { params: Promise<{ id: string }> };

/**
 * Revokes one passkey or one signed-in device.
 *
 * Scoped to the caller's own rows by the `personId` in the where clause rather
 * than by a check afterwards, so there is no arrangement of ids that deletes
 * somebody else's credential.
 *
 * Refuses to remove the last way in. Someone tidying up their device list
 * should not be able to lock themselves out of their own ledger with a tap,
 * and "you have nothing else to sign in with" is a better answer than an
 * account that can only be reached by starting over.
 */
export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  const personId = session.person.id;

  const credential = await prisma.credential.findFirst({ where: { id, personId } });
  if (credential) {
    if (credential.kind === "recovery") {
      throw new ValidationError(
        "The recovery key cannot be removed, only replaced — rotate it instead.",
      );
    }
    const remaining = await prisma.credential.count({ where: { personId, id: { not: id } } });
    if (remaining === 0) {
      throw new ValidationError(
        "That is the only way you can sign in. Add another passkey, or save a recovery key, first.",
      );
    }
    await prisma.credential.delete({ where: { id } });
    return json({ removed: { id, kind: "passkey" } });
  }

  const revoked = await prisma.session.deleteMany({ where: { id, personId } });
  if (revoked.count === 0) throw new NotFoundError("That device is already gone.");
  return json({ removed: { id, kind: "session" } });
});
