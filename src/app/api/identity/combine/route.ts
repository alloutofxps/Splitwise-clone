import { z } from "zod";
import { json, readBody, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/identity";
import { assertCanCombine, combineAccounts, combinePreview, otherAccountFor } from "@/server/combine";
import { meDto } from "@/server/me";
import { limitByAccount, limitByAddress, RECOVERY_ATTEMPT } from "@/server/rate-limit";
import { recordActivities } from "@/server/write";

const schema = z.object({
  proof: z.string().trim().min(4, "Enter a sign-in code or recovery key.").max(200),
  confirm: z.boolean().optional(),
});

/**
 * Moves another account of yours into this one. Everything that decides it is in
 * `server/combine.ts`.
 *
 * Without `confirm` it only says what would happen, spending nothing. The limit
 * by address is the sign-in code's own, shared with signing in, so a guesser
 * gets no extra tries by coming this way.
 */
export const POST = route(async (request: Request) => {
  const session = await requireSession();
  limitByAddress(request, "device-link-claim", { limit: 20, windowSeconds: 60 * 10 });
  limitByAccount(session.person.id, "combine", RECOVERY_ATTEMPT);

  const input = await readBody(request, schema);
  const me = session.person;
  const other = await otherAccountFor(input.proof, me.id);

  if (!input.confirm) {
    await assertCanCombine(prisma, me.id, other.person.id);
    return json({
      other: {
        id: other.person.id,
        displayName: other.person.displayName,
        avatarColor: other.person.avatarColor,
        avatarEmoji: other.person.avatarEmoji,
        isGhost: false,
      },
      ...(await combinePreview(other.person.id)),
    });
  }

  const result = await combineAccounts(me.id, other.person.id, other.linkId);

  // The names in these groups changed, so everyone in them can see why.
  await recordActivities(
    result.groupIds.map((groupId) => ({
      type: "member.merged",
      actorPersonId: me.id,
      groupId,
      data: { personId: me.id, name: me.displayName, ghostName: result.otherName },
    })),
  );

  return json({ me: await meDto(me), moved: result.moved });
});
