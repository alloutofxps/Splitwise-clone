import { z } from "zod";
import { dateInput, json, readBody, route } from "@/lib/api";
import { ForbiddenError, NotFoundError, requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { requireGroupAccess } from "@/server/access";
import { recurrenceDto } from "@/server/recurrence-dto";
import { nextOccurrence } from "@/server/recurrence";
import type { RecurrenceFrequency } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

async function loadEditable(id: string, personId: string) {
  const recurrence = await prisma.recurrence.findUnique({ where: { id } });
  if (!recurrence) throw new NotFoundError("That repeating expense is gone.");

  if (recurrence.groupId) await requireGroupAccess(recurrence.groupId, personId);
  else if (recurrence.createdByPersonId !== personId) {
    throw new ForbiddenError("You can't change that repeating expense.");
  }
  return recurrence;
}

const schema = z.object({
  active: z.boolean().optional(),
  endsAt: dateInput.nullable().optional(),
  nextRunAt: dateInput.optional(),
});

const DAY = 86_400_000;

/** Pause, resume, or reschedule. Changing the amount or split is a delete-and-recreate. */
export const PATCH = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  const recurrence = await loadEditable(id, session.person.id);
  const input = await readBody(request, schema);

  // Rescheduling into the past is how a recurrence used to be made to post
  // hundreds of back-dated expenses at once. The next date can be moved to any
  // point from yesterday onwards.
  if (input.nextRunAt) {
    const at = input.nextRunAt.getTime();
    if (at < Date.now() - DAY || at > Date.now() + 5 * 366 * DAY) {
      throw new ValidationError("Pick a next date between today and five years from now.");
    }
  }

  let nextRunAt = input.nextRunAt;

  /*
   * Resuming after a pause skips what was missed rather than catching up on
   * it. The pause was deliberate - somebody moved out, the split was being
   * fixed - and posting every missed month the moment it is switched back on
   * would undo exactly the thing the pause was for.
   */
  if (input.active === true && !recurrence.active && !nextRunAt) {
    let cursor = recurrence.nextRunAt;
    let guard = 0;
    while (cursor.getTime() < Date.now() - DAY && guard++ < 5000) {
      cursor = nextOccurrence(
        cursor,
        recurrence.frequency as RecurrenceFrequency,
        recurrence.interval,
        recurrence.dayOfMonth,
        recurrence.timeZone || "UTC",
      );
    }
    nextRunAt = cursor;
  }

  const updated = await prisma.recurrence.update({
    where: { id },
    data: {
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.active === true ? { lastError: null } : {}),
      ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
      ...(nextRunAt ? { nextRunAt } : {}),
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
