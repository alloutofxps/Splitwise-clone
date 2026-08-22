import { route } from "@/lib/api";
import { ForbiddenError, NotFoundError, requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";

type Params = { params: Promise<{ id: string }> };

/**
 * Serves a receipt.
 *
 * Attachments live in the database rather than on disk, which keeps a
 * self-hosted backup to a single file and works on hosts with an ephemeral
 * filesystem. Access is checked per request - the id alone is not authority,
 * because receipts routinely show card digits and addresses.
 */
export const GET = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();

  const attachment = await prisma.attachment.findUnique({
    where: { id },
    include: {
      expense: {
        select: {
          groupId: true,
          createdByPersonId: true,
          payers: { select: { personId: true } },
          splits: { select: { personId: true } },
        },
      },
    },
  });
  if (!attachment) throw new NotFoundError("That receipt is gone.");

  const { expense } = attachment;
  if (expense.groupId) {
    await requireGroupAccess(expense.groupId, session.person.id);
  } else {
    const involved =
      expense.createdByPersonId === session.person.id ||
      expense.payers.some((p) => p.personId === session.person.id) ||
      expense.splits.some((s) => s.personId === session.person.id);
    if (!involved) throw new ForbiddenError("That receipt is not yours to see.");
  }

  return new Response(new Uint8Array(attachment.data), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(attachment.size),
      "Content-Disposition": `inline; filename="${attachment.filename.replace(/"/g, "")}"`,
      // Immutable: bytes never change, and the id is unguessable.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});
