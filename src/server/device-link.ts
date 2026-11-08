import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";

/**
 * The live device link with this hash, or the reason there isn't one. Reads
 * only: spending it is up to the caller, who may need to do it in a transaction.
 */
export async function liveDeviceLink(codeHash: string) {
  const link = await prisma.deviceLink.findUnique({
    where: { codeHash },
    include: { person: true },
  });
  if (!link || link.person.deletedAt) {
    throw new NotFoundError("That link doesn't work. Ask for a new code.");
  }
  if (link.usedAt) throw new ValidationError("That code has already been used. Ask for a new one.");
  if (link.expiresAt.getTime() < Date.now()) {
    throw new ValidationError("That code has run out. Ask for a new one.");
  }
  return link;
}
