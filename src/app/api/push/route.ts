import { z } from "zod";
import { json, readBody, route } from "@/lib/api";
import { requireSession, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { isPushServiceUrl, pushPublicKey } from "@/server/push";

/** A phone can have one subscription per browser; nobody needs more than this across devices. */
const MAX_SUBSCRIPTIONS = 10;

const subscription = z.object({
  endpoint: z
    .string()
    .max(1000)
    .refine(isPushServiceUrl, "That isn't a notification address."),
  keys: z.object({
    p256dh: z.string().min(16).max(200),
    auth: z.string().min(8).max(100),
  }),
});

/** The public key a phone needs to subscribe; null when notifications aren't set up on this server. */
export const GET = route(async () => {
  await requireSession();
  return json({ publicKey: pushPublicKey() });
});

/** Turns notifications on for this phone. */
export const POST = route(async (request: Request) => {
  const session = await requireSession();
  if (!pushPublicKey()) throw new ValidationError("Notifications aren't set up on this server.");
  if (!session.sessionId) throw new ValidationError("Please sign in again, then turn notifications on.");
  const input = await readBody(request, subscription);

  const count = await prisma.pushSubscription.count({ where: { personId: session.person.id } });
  if (count >= MAX_SUBSCRIPTIONS) {
    // Oldest first: the phone someone has stopped using is the one to drop.
    const oldest = await prisma.pushSubscription.findFirst({
      where: { personId: session.person.id },
      orderBy: { createdAt: "asc" },
    });
    if (oldest) await prisma.pushSubscription.delete({ where: { id: oldest.id } });
  }

  // Keyed on the endpoint: the same phone subscribing again, or a different
  // person signing in on it, replaces the old row instead of doubling up.
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      personId: session.person.id,
      sessionId: session.sessionId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
    },
    update: {
      personId: session.person.id,
      sessionId: session.sessionId,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
    },
  });
  return json({ ok: true }, { status: 201 });
});

/** Turns notifications off for this phone. */
export const DELETE = route(async (request: Request) => {
  const session = await requireSession();
  const input = await readBody(request, z.object({ endpoint: z.string().max(1000) }));
  await prisma.pushSubscription.deleteMany({
    where: { endpoint: input.endpoint, personId: session.person.id },
  });
  return json({ ok: true });
});
