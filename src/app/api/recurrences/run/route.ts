import { json, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { runDueRecurrences } from "@/server/recurrence";

/**
 * Posts any due recurring expenses on demand.
 *
 * The dashboard already does this on open, so this exists for a real cron:
 * point a scheduler at it if you want the rent to post at 8am rather than
 * whenever somebody first checks the app.
 */
export const POST = route(async () => {
  await requireSession();
  const posted = await runDueRecurrences();
  return json({ posted });
});
