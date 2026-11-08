import { after } from "next/server";
import { json, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { hashSecret, normalizeSignInCode } from "@/lib/codes";
import { ValidationError, describeDevice, startSession } from "@/lib/identity";
import { liveDeviceLink } from "@/server/device-link";
import { notifyNewDevice } from "@/server/push";
import { limitByAddress } from "@/server/rate-limit";
import { meDto } from "@/server/me";

type Params = { params: Promise<{ code: string }> };

/**
 * Signs this device in from a scanned link, or a code copied across.
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

  const link = await liveDeviceLink(hashSecret(normalizeSignInCode(code)));

  const claimed = await prisma.deviceLink.updateMany({
    where: { id: link.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) {
    throw new ValidationError("That code has already been used. Ask for a new one.");
  }

  const label = describeDevice(request.headers.get("user-agent"));
  const sessionId = await startSession(link.personId, label);
  // Tell the person's other devices, once the answer has gone (server/push.ts).
  after(() => notifyNewDevice(link.personId, sessionId, label).catch(() => 0));
  await prisma.person.update({
    where: { id: link.personId },
    data: { lastSeenAt: new Date() },
  });

  return json({ me: await meDto(link.person) });
});
