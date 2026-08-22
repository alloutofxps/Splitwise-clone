import { json, route } from "@/lib/api";
import { ForbiddenError, NotFoundError, requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";
import { recordActivity } from "@/server/write";

type Params = { params: Promise<{ id: string }> };

const ATTACHMENT_WITH_EXPENSE = {
  expense: {
    select: {
      id: true,
      description: true,
      groupId: true,
      createdByPersonId: true,
      payers: { select: { personId: true } },
      splits: { select: { personId: true } },
    },
  },
} as const;

type AttachmentExpense = {
  groupId: string | null;
  createdByPersonId: string;
  payers: { personId: string }[];
  splits: { personId: string }[];
};

/**
 * Who may see or remove a receipt.
 *
 * Inside a group, membership is the whole permission model - anyone in it can
 * already edit the expense, so gating the photo more tightly would be theatre.
 * Outside one, the people on the expense are the only people it concerns.
 */
async function assertCanAccess(expense: AttachmentExpense, personId: string): Promise<void> {
  if (expense.groupId) {
    await requireGroupAccess(expense.groupId, personId);
    return;
  }
  const involved =
    expense.createdByPersonId === personId ||
    expense.payers.some((p) => p.personId === personId) ||
    expense.splits.some((s) => s.personId === personId);
  if (!involved) throw new ForbiddenError("That receipt is not yours to see.");
}

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
    include: ATTACHMENT_WITH_EXPENSE,
  });
  if (!attachment) throw new NotFoundError("That receipt is gone.");

  await assertCanAccess(attachment.expense, session.person.id);

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

/**
 * Removes a receipt.
 *
 * Editing an expense is additive where photos are concerned - an edit that did
 * not mention them must not silently drop them - so this is the only way to
 * take one back off. It exists because receipts routinely carry card digits
 * and home addresses, and "you attached it, live with it" is not an acceptable
 * answer to someone who attached the wrong photo.
 *
 * The bytes go with the row: they are stored inline, so there is no orphaned
 * blob to sweep up afterwards.
 */
export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();

  const attachment = await prisma.attachment.findUnique({
    where: { id },
    include: ATTACHMENT_WITH_EXPENSE,
  });
  // Already gone is the state the caller wanted, so deleting twice - which the
  // offline outbox will do on replay - is a success, not a 404.
  if (!attachment) return json({ deleted: true });

  await assertCanAccess(attachment.expense, session.person.id);

  await prisma.attachment.delete({ where: { id } });

  await recordActivity({
    type: "expense.updated",
    actorPersonId: session.person.id,
    groupId: attachment.expense.groupId,
    expenseId: attachment.expense.id,
    data: {
      description: attachment.expense.description,
      changes: ["removed a receipt"],
    },
  });

  return json({ deleted: true });
});
