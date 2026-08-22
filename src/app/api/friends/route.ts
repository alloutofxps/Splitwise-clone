import { z } from "zod";
import { json, readBody, route } from "@/lib/api";
import { requireSession, ValidationError } from "@/lib/identity";
import { normalizeInviteCode } from "@/lib/codes";
import { prisma } from "@/lib/db";
import { friendshipPair } from "@/server/access";
import { personDto } from "@/server/read";
import { friendDtos } from "@/server/me";

export const GET = route(async () => {
  const session = await requireSession();
  return json({ friends: await friendDtos(session.person.id) });
});

const schema = z.object({
  inviteCode: z.string().trim().min(3).max(60),
});

/**
 * Adds someone by their personal code.
 *
 * Mutual by construction - there is no request to accept. Having somebody's
 * code is the consent, the same way having their phone number is, and adding
 * them only enables splitting: it exposes no history either way.
 */
export const POST = route(async (request: Request) => {
  const session = await requireSession();
  const { inviteCode } = await readBody(request, schema);

  const person = await prisma.person.findUnique({
    where: { inviteCode: normalizeInviteCode(inviteCode) },
  });
  if (!person || person.isGhost) throw new ValidationError("No one has that code.");
  if (person.id === session.person.id) throw new ValidationError("That is your own code.");

  await prisma.friendship.upsert({
    where: { personAId_personBId: friendshipPair(session.person.id, person.id) },
    create: friendshipPair(session.person.id, person.id),
    update: {},
  });

  return json({ friend: personDto(person) }, { status: 201 });
});
