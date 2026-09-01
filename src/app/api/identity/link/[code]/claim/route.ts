import { json, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { hashSecret } from "@/lib/codes";
import { NotFoundError, ValidationError, describeDevice, startSession } from "@/lib/identity";
import { limitByAddress } from "@/server/rate-limit";
import { meDto } from "@/server/me";

type Params = { params: Promise<{ code: string }> };

/**
 * Signs this device in from a scanned link.
 *
 * Deliberately not a GET: a code that logs you in by being *fetched* would be
 * spent by any link preview, chat unfurler or prefetch that touched the URL,
 * and the person scanning it would arrive to find it already used.
 *
 * Consumed inside a transaction that re-checks `usedAt`, so two devices racing
 * on the same code cannot both win.
 */
export const POST = route(async (request: Request, { params }: Params) => {
  const { code } = await params;
  limitByAddress(request, "device-link-claim", { limit: 20, windowSeconds: 60 * 10 });

  const link = await prisma.deviceLink.findUnique({
    where: { codeHash: hashSecret(code) },
    include: { person: true },
  });
  if (!link) throw new NotFoundError("That link is not valid. Ask for a fresh code.");
  if (link.usedAt) throw new ValidationError("That code has already been used. Ask for a fresh one.");
  if (link.expiresAt.getTime() < Date.now()) {
    throw new ValidationError("That code has expired. Ask for a fresh one.");
  }

  const claimed = await prisma.deviceLink.updateMany({
    where: { id: link.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) {
    throw new ValidationError("That code has already been used. Ask for a fresh one.");
  }

  await startSession(link.personId, describeDevice(request.headers.get("user-agent")));
  await prisma.person.update({
    where: { id: link.personId },
    data: { lastSeenAt: new Date() },
  });

  return json({ me: await meDto(link.person) });
});
