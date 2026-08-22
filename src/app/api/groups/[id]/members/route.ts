import { z } from "zod";
import { json, readBody, route, text } from "@/lib/api";
import { requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { colorForName } from "@/lib/avatar";
import { requireGroupAccess } from "@/server/access";
import { personDto } from "@/server/read";
import { recordActivity } from "@/server/write";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  /** Add somebody who is not on the app yet, by name. */
  name: text(60, "That name").optional(),
  /** Or add an existing person you already know, by their personal code. */
  inviteCode: z.string().trim().max(60).optional(),
});

/**
 * Adds a member.
 *
 * Two shapes, because there are two situations. Usually you are sitting at
 * dinner and one person has the app: they type "Nadia" and get a placeholder,
 * which starts collecting Nadia's share immediately. Occasionally the person is
 * already on Divvy, in which case their personal code links the real account
 * and their existing history comes with them.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();
  const { group } = await requireGroupAccess(id, session.person.id);
  const input = await readBody(request, schema);

  if (input.inviteCode) {
    const person = await prisma.person.findUnique({
      where: { inviteCode: input.inviteCode.trim().toLowerCase() },
    });
    if (!person) throw new ValidationError("No one has that personal code.");

    const existing = await prisma.membership.findUnique({
      where: { groupId_personId: { groupId: id, personId: person.id } },
    });
    if (existing && !existing.leftAt) {
      throw new ValidationError(`${person.displayName} is already in this group.`);
    }

    await prisma.membership.upsert({
      where: { groupId_personId: { groupId: id, personId: person.id } },
      create: { groupId: id, personId: person.id },
      update: { leftAt: null },
    });

    await recordActivity({
      type: "member.added",
      actorPersonId: session.person.id,
      groupId: id,
      data: { otherPersonId: person.id, groupName: group.name },
    });

    return json({ member: personDto(person) }, { status: 201 });
  }

  const name = input.name?.trim();
  if (!name) throw new ValidationError("Give the person a name.");

  const duplicate = await prisma.membership.findFirst({
    where: {
      groupId: id,
      leftAt: null,
      person: { displayName: name },
    },
  });
  if (duplicate) {
    throw new ValidationError(
      `There is already a ${name} in this group. Add a surname or initial to tell them apart.`,
    );
  }

  const ghost = await prisma.person.create({
    data: {
      displayName: name,
      isGhost: true,
      createdByPersonId: session.person.id,
      defaultCurrency: group.currency,
      avatarColor: colorForName(name),
      inviteCode: `ghost-${id.slice(-6)}-${Math.random().toString(36).slice(2, 8)}`,
      memberships: { create: { groupId: id } },
    },
  });

  await recordActivity({
    type: "member.added",
    actorPersonId: session.person.id,
    groupId: id,
    data: { otherPersonId: ghost.id, groupName: group.name },
  });

  return json({ member: personDto(ghost) }, { status: 201 });
});
