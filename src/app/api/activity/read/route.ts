import { json, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";

/**
 * Marks everything in the Activity feed as seen, up to now: called when the
 * Activity tab is opened. Group dots and the tab badge clear with it.
 */
export const POST = route(async () => {
  const session = await requireSession();
  await prisma.person.update({
    where: { id: session.person.id },
    data: { activitySeenAt: new Date() },
  });
  return json({ ok: true });
});
