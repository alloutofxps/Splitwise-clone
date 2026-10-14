import { timingSafeEqual } from "node:crypto";
import { json, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { runDueRecurrences } from "@/server/recurrence";
import { withJobLock } from "@/server/jobs";
import { limitByAccount } from "@/server/rate-limit";

function bearerMatches(request: Request): boolean {
  const secret = process.env.DIVVY_CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Posts due recurring expenses on demand.
 *
 * The server's own scheduler does this every minute, so this endpoint exists
 * for two callers:
 *
 * - an external cron, holding `DIVVY_CRON_SECRET` as a bearer token, which
 *   runs every customer's schedule; and
 * - a signed-in person, which brings *their own* groups up to date.
 *
 * It used to run everybody's schedule for any signed-in caller, so any user
 * could make the server do the whole system's work on demand.
 */
export const POST = route(async (request: Request) => {
  if (bearerMatches(request)) {
    const posted = await withJobLock("recurrences", 5 * 60_000, () => runDueRecurrences());
    return json({ posted: posted ?? 0, scope: "all" });
  }

  const session = await requireSession();
  limitByAccount(session.person.id, "recurrence-run", { limit: 10, windowSeconds: 60 });
  const posted = await runDueRecurrences(new Date(), { personId: session.person.id });
  return json({ posted, scope: "mine" });
});
