import { z } from "zod";
import { currencyCode, json, readBody, route, text } from "@/lib/api";
import { ValidationError, requireSession, uniqueGroupCode } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { groupSummaries } from "@/server/read";
import { visiblePeople } from "@/server/me";
import { colorForName } from "@/lib/avatar";
import { recordActivity } from "@/server/write";
import { generateGhostCode } from "@/lib/codes";
import { ACCEPTED_COLORS, normalizeColor } from "@/lib/avatar";
import { limitByAccount, WRITE } from "@/server/rate-limit";

const GROUP_KINDS = ["trip", "home", "couple", "event", "project", "other"] as const;

const createSchema = z.object({
  name: text(60, "The group name").refine((v) => v.length > 0, "Give the group a name."),
  kind: z.enum(GROUP_KINDS).default("other"),
  emoji: z.string().trim().max(8).default("🧾"),
  // Optional: without one the group gets the colour its name gives it, as the
  // New group screen does, rather than every such group sharing one colour.
  color: z.enum(ACCEPTED_COLORS).optional().transform((color) => (color ? normalizeColor(color) : undefined)),
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
  limitByAccount(session.person.id, "group-create", WRITE);
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
    const visible = await visiblePeople(session.person.id);
    const allowed = new Set(visible.map((person) => person.id));
    const stranger = memberIds.find((id) => !allowed.has(id));
    if (stranger) {
      throw new ValidationError("You can only add people you already share a group with.");
    }
    // A placeholder from another group would tie two groups' balances to one
    // made-up name. Type the name instead; the person can claim both.
    const ghosts = visible.filter((person) => person.isGhost && memberIds.includes(person.id));
    if (ghosts.length > 0) {
      throw new ValidationError(
        `${ghosts[0].displayName} isn't on Divvy yet. Add them by name instead.`,
      );
    }
  }

  const inviteCode = await uniqueGroupCode();

  const group = await prisma.$transaction(async (tx) => {
    const created = await tx.group.create({
      data: {
        name: input.name,
        kind: input.kind,
        emoji: input.emoji || "🧾",
        color: input.color ?? colorForName(input.name),
        currency: input.currency,
        simplifyDebts: input.simplifyDebts,
        inviteCode,
        memberships: {
          create: { personId: session.person.id, role: "owner" },
        },
      },
    });

    const placeholders = input.placeholderNames
      .filter((name) => name)
      .map((name) => ({
        displayName: name,
        isGhost: true,
        createdByPersonId: session.person.id,
        defaultCurrency: input.currency,
        avatarColor: colorForName(name),
        inviteCode: generateGhostCode(),
      }));
    // Matched back by code, since the rows a batch insert returns have no
    // promised order.
    const ghostIds = new Map(
      (
        await tx.person.createManyAndReturn({
          data: placeholders,
          select: { id: true, inviteCode: true },
        })
      ).map((ghost) => [ghost.inviteCode, ghost.id]),
    );

    // Everyone joins a millisecond apart, in the order given: the member list
    // sorts by joining time, and so does choosing the longest-standing member
    // when an owner leaves.
    const joined = Date.now();
    await tx.membership.createMany({
      data: [...memberIds, ...placeholders.map((ghost) => ghostIds.get(ghost.inviteCode)!)].map(
        (personId, index) => ({
          groupId: created.id,
          personId,
          role: "member",
          joinedAt: new Date(joined + index + 1),
        }),
      ),
    });

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
