import { json, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { generateSecret, hashSecret } from "@/lib/codes";
import { requireSession } from "@/lib/identity";
import { limitByAddress } from "@/server/rate-limit";

/** Long enough that guessing is hopeless, short enough to live in a QR code. */
const LINK_TTL_SECONDS = 5 * 60;

/**
 * Hands this account to another device.
 *
 * Returns a one-time code that the caller renders as a QR code. The other
 * device opens it and is signed in — which replaces transcribing a
 * 64-character recovery key, the step most likely to end with somebody
 * stranded on a new phone.
 *
 * The code is a bearer token: whoever holds it becomes this person. So it is
 * only ever minted for an already-authenticated caller, it dies in five
 * minutes, and it works exactly once. Those three together mean a code
 * photographed over someone's shoulder is worth far less than the recovery key
 * it replaces — the failure mode it is designed against.
 */
export const POST = route(async (request: Request) => {
  const session = await requireSession();
  limitByAddress(request, "device-link", { limit: 10, windowSeconds: 60 * 10 });

  const code = generateSecret();
  const expiresAt = new Date(Date.now() + LINK_TTL_SECONDS * 1000);

  // Only one live code per person: minting a second should retire the first,
  // or a code abandoned on a screen somewhere stays usable for its full window.
  await prisma.$transaction([
    prisma.deviceLink.deleteMany({ where: { personId: session.person.id, usedAt: null } }),
    prisma.deviceLink.create({
      data: { personId: session.person.id, codeHash: hashSecret(code), expiresAt },
    }),
  ]);

  return json({
    code,
    path: `/link/${encodeURIComponent(code)}`,
    expiresAt: expiresAt.toISOString(),
    expiresInSeconds: LINK_TTL_SECONDS,
  });
});
