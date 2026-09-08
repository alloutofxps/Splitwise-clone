import { z } from "zod";
import { currencyCode, json, readBody, route, text } from "@/lib/api";
import { ValidationError, requireSession, uniqueGroupCode } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { groupSummaries } from "@/server/read";
import { visiblePeople } from "@/server/me";
import { colorForName } from "@/lib/avatar";
import { recordActivity } from "@/server/write";

const GROUP_KINDS = ["trip", "home", "couple", "event", "project", "other"] as const;

const createSchema = z.object({
  name: text(60, "The group name").refine((v) => v.length > 0, "Give the group a name."),
  kind: z.enum(GROUP_KINDS).default("other"),
  emoji: z.string().trim().max(8).default("🧾"),
  color: z.string().trim().max(20).default("iris"),
  currency: currencyCode,
  simplifyDebts: z.boolean().default(true),
  /** Names to seed as placeholder members, for people not on the app yet. */
  placeholderNames: z.array(text(60, "A name")).max(40).default([]),
  /**
   * People the creator already knows, by id.
   *
   * Without this the only way to put somebody in a new group was to type their
   * name, which creates a *placeholder* — so adding a friend you already had
   * produced a second, unclaimed copy of them, and the two accumulated
   * balances that would never meet.
   */
  memberIds: z.array(z.string().min(1)).max(40).default([]),
});

/**
 * Creates a group.
 *
 * The creator joins as owner, and any names supplied up front become ghost
 * members so the group is usable immediately - you can split tonight's dinner
 * with four people before any of them have installed anything. Each ghost is
 * upgraded in place when its owner joins with the invite code.
 */
export const POST = route(async (request: Request) => {
  const session = await requireSession();
  const input = await readBody(request, createSchema);

  /*
   * Only people the creator already shares a group or a friendship with.
   *
   * `visiblePeople` is the same set the app renders names from, so this refuses
   * an id somebody guessed or scraped without needing a second notion of who
   * you are allowed to involve.
   */
  const memberIds = [...new Set(input.memberIds)].filter((id) => id !== session.person.id);
  if (memberIds.length > 0) {
    const allowed = new Set((await visiblePeople(session.person.id)).map((person) => person.id));
    const stranger = memberIds.find((id) => !allowed.has(id));
    if (stranger) {
      throw new ValidationError("You can only add people you already share a group with.");
    }
  }

  const inviteCode = await uniqueGroupCode();

  const group = await prisma.$transaction(async (tx) => {
    const created = await tx.group.create({
      data: {
        name: input.name,
        kind: input.kind,
        emoji: input.emoji || "🧾",
        color: input.color,
        currency: input.currency,
        simplifyDebts: input.simplifyDebts,
        inviteCode,
        memberships: {
          create: { personId: session.person.id, role: "owner" },
        },
      },
    });

    for (const personId of memberIds) {
      await tx.membership.create({
        data: { groupId: created.id, personId, role: "member" },
      });
    }

    for (const name of input.placeholderNames) {
      if (!name) continue;
      const ghost = await tx.person.create({
        data: {
          displayName: name,
          isGhost: true,
          createdByPersonId: session.person.id,
          defaultCurrency: input.currency,
          avatarColor: colorForName(name),
          inviteCode: `ghost-${created.id.slice(-6)}-${Math.random().toString(36).slice(2, 8)}`,
        },
      });
      await tx.membership.create({
        data: { groupId: created.id, personId: ghost.id, role: "member" },
      });
    }

    return created;
  });

  await recordActivity({
    type: "group.created",
    actorPersonId: session.person.id,
    groupId: group.id,
    data: { groupName: group.name },
  });

  const summaries = await groupSummaries(session.person.id);
  return json({ group: summaries.find((g) => g.id === group.id) }, { status: 201 });
});
