import { json, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { dashboardDto, visiblePeople } from "@/server/me";

/**
 * The home screen in one request.
 *
 * This used to be the app's heartbeat too, posting every customer's due
 * recurring expenses before answering - so whoever opened the app first paid
 * for everybody's schedule, and any user could trigger the whole system's
 * work. Recurring expenses are now posted by the server's scheduler
 * (`server/jobs.ts`), and this request only reads.
 */
export const GET = route(async () => {
  const session = await requireSession();

  const [dashboard, people] = await Promise.all([
    dashboardDto(session.person),
    visiblePeople(session.person.id),
  ]);

  return json({ ...dashboard, people });
});
