import { z } from "zod";
import { dateInput, json, readBody, route } from "@/lib/api";
import { ForbiddenError, NotFoundError, requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";
import { recurrenceDto } from "@/server/recurrence-dto";

type Params = { params: Promise<{ id: string }> };

async function loadEditable(id: string, personId: string) {
  const recurrence = await prisma.recurrence.findUnique({ where: { id } });
  if (!recurrence) throw new NotFoundError("That repeating expense is gone.");

  if (recurrence.groupId) await requireGroupAccess(recurrence.groupId, personId);
  else if (recurrence.createdByPersonId !== personId) {
    throw new ForbiddenError("That repeating expense is not yours.");
  }
  return recurrence;
}

const schema = z.object({
  active: z.boolean().optional(),
  endsAt: dateInput.nullable().optional(),
  nextRunAt: dateInput.optional(),
});

/** Pause, resume, or reschedule. Changing the amount or split is a delete-and-recreate. */
export const PATCH = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  await loadEditable(id, session.person.id);
  const input = await readBody(request, schema);

  const updated = await prisma.recurrence.update({
    where: { id },
    data: {
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
      ...(input.nextRunAt ? { nextRunAt: input.nextRunAt } : {}),
    },
  });

  return json({ recurrence: recurrenceDto(updated) });
});

/**
 * Stops a repeating expense. Occurrences it already posted stay - they are real
 * expenses that people really owe, and deleting them would rewrite history.
 */
export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  await loadEditable(id, session.person.id);

  await prisma.recurrence.delete({ where: { id } });
  return json({ ok: true });
});
