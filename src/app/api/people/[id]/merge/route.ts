import { z } from "zod";
import { json, readBody, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { mergeGhostInto } from "@/server/merge";
import { personDto } from "@/server/read";
import { recordActivity } from "@/server/write";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  /** The real account the placeholder turns out to be. */
  intoPersonId: z.string().min(1),
});

/**
 * "This placeholder is actually them."
 *
 * `[id]` is the placeholder being dissolved, which is deliberately the way
 * round it reads on screen: you are looking at the stale name in a group, not
 * at the person's profile. The real account survives with its own key, its own
 * devices and its own name — a merge never renames anybody, because the two
 * names being different is the entire reason somebody has to say they are the
 * same person.
 *
 * Everything that decides who may do this, and everything that keeps the
 * balances intact, lives in `server/merge.ts`; this is the wire.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  const input = await readBody(request, schema);

  // Read before the merge, because both are gone from the placeholder's row
  // afterwards — and the feed entry is only worth writing if it can say which
  // name was folded into which. That is the whole event.
  const ghost = await prisma.person.findUnique({
    where: { id },
    select: { displayName: true, memberships: { select: { groupId: true } } },
  });
  const groupIds = ghost?.memberships.map((row) => row.groupId) ?? [];

  const result = await mergeGhostInto(session.person.id, id, input.intoPersonId);
  const person = await prisma.person.findUniqueOrThrow({ where: { id: result.personId } });

  // One entry per group the placeholder was in: the merge changed who the
  // names in that group's ledger belong to, and every member should be able to
  // see that it happened and who did it.
  //
  // The person is named in `data`, not in `targetPersonId`. That column marks
  // an entry as *addressed* — the feed query hides such rows from everybody but
  // the sender and the recipient, which is right for a nudge and wrong here:
  // the member list changed for the whole group.
  for (const groupId of groupIds) {
    await recordActivity({
      type: "member.merged",
      actorPersonId: session.person.id,
      groupId,
      data: {
        personId: person.id,
        name: person.displayName,
        ghostName: ghost?.displayName ?? null,
      },
    });
  }

  return json({ person: personDto(person), moved: result.moved });
});
