import { z } from "zod";
import { json, readBody, route, currencyCode, text } from "@/lib/api";
import {
  claimGhost,
  clearIdentityCookie,
  createIdentity,
  getSession,
  requireSession,
  setIdentityCookie,
} from "@/lib/identity";
import { formatRecoveryKey } from "@/lib/codes";
import { prisma } from "@/lib/db";
import { meDto } from "@/server/me";

const AVATAR_COLORS = [
  "iris", "violet", "sky", "cyan", "teal", "lime", "amber", "orange", "rose", "fuchsia",
] as const;

const profileSchema = z.object({
  displayName: text(60, "Your name").refine((v) => v.length > 0, "Tell us your name."),
  avatarColor: z.enum(AVATAR_COLORS).optional(),
  avatarEmoji: z.string().trim().max(8).nullable().optional(),
  defaultCurrency: currencyCode.optional(),
  /** Set when the new arrival is claiming a placeholder somebody made for them. */
  claimGhostId: z.string().optional(),
});

/** Who am I? Returns 401 when the device has no identity yet. */
export const GET = route(async () => {
  const session = await requireSession();
  return json({ me: await meDto(session.person) });
});

/**
 * Creates the identity. This is the whole of "sign up": a name, and optionally
 * an existing placeholder to absorb.
 *
 * The recovery key comes back exactly once, here. It is never retrievable
 * afterwards without rotating it, because the server only stores its hash.
 */
export const POST = route(async (request: Request) => {
  const input = await readBody(request, profileSchema);

  const existing = await getSession();
  if (existing) {
    // Already set up on this device - don't quietly strand the old identity.
    return json({ me: await meDto(existing.person), alreadySetUp: true });
  }

  const { person, secret } = input.claimGhostId
    ? await claimGhost(input.claimGhostId, input)
    : await createIdentity(input);

  await setIdentityCookie(person.id, secret);

  return json(
    {
      me: await meDto(person),
      recoveryKey: secret,
      recoveryKeyDisplay: formatRecoveryKey(secret),
    },
    { status: 201 },
  );
});

export const PATCH = route(async (request: Request) => {
  const session = await requireSession();
  const input = await readBody(request, profileSchema.partial());

  const person = await prisma.person.update({
    where: { id: session.person.id },
    data: {
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.avatarColor ? { avatarColor: input.avatarColor } : {}),
      ...(input.avatarEmoji !== undefined ? { avatarEmoji: input.avatarEmoji } : {}),
      ...(input.defaultCurrency ? { defaultCurrency: input.defaultCurrency } : {}),
      lastSeenAt: new Date(),
    },
  });

  return json({ me: await meDto(person) });
});

/**
 * Signs out by dropping the cookie. The Person row and all its history stay
 * put, so signing back in with the recovery key restores everything.
 */
export const DELETE = route(async () => {
  await clearIdentityCookie();
  return json({ ok: true });
});
