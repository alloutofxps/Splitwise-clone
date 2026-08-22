import { json, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { dashboardDto, visiblePeople } from "@/server/me";
import { runDueRecurrences } from "@/server/recurrence";

/**
 * The home screen in one request.
 *
 * Also the app's heartbeat: opening it fires any recurring expenses that have
 * come due. Self-hosted deployments have no scheduler, and "the rent posted
 * when somebody opened the app" is a far better failure mode than "the rent
 * never posted". `runDueRecurrences` is idempotent, so several people opening
 * the app at once cannot double-post.
 */
export const GET = route(async () => {
  const session = await requireSession();

  await runDueRecurrences();

  const [dashboard, people] = await Promise.all([
    dashboardDto(session.person),
    visiblePeople(session.person.id),
  ]);

  return json({ ...dashboard, people });
});
