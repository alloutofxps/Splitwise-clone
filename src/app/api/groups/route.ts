import { z } from "zod";
import { currencyCode, json, readBody, route, text } from "@/lib/api";
import { requireSession, uniqueGroupCode } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { groupSummaries } from "@/server/read";
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
