import { z } from "zod";
import { readBody, route } from "@/lib/api";
import { getSession } from "@/lib/identity";
import { log } from "@/lib/log";
import { notePhoneError } from "@/server/health";
import { limitByAddress } from "@/server/rate-limit";

/**
 * Crashes on people's phones (RULES.md O3), sent by components/error-reporter.
 *
 * Without this, an error in someone's browser is seen by nobody: the screen
 * says "Something went wrong" and the owner never finds out. Each report is
 * written to the server log, and crashes from several signed-in people in an
 * hour make the health check fail, which emails the owner.
 *
 * Only what helps find the fault is kept: the error's message and the top of
 * its stack, which page, and which build. Never the person, their data or the
 * page's query string. Anyone can send one, so reports from people who are
 * not signed in are logged but can't set off the alarm.
 */

const schema = z.object({
  kind: z.enum(["error", "rejection", "screen"]),
  message: z.string().max(300),
  stack: z.string().max(2000).optional(),
  path: z.string().max(200),
  build: z.string().max(40).optional(),
});

export const POST = route(async (request: Request) => {
  limitByAddress(request, "client-errors", { limit: 20, windowSeconds: 3600 });
  const report = await readBody(request, schema, { maxBytes: 4096 });
  const session = await getSession();

  log.warn("phone error", {
    kind: report.kind,
    message: report.message,
    stack: report.stack?.split("\n").slice(0, 6).join("\n"),
    path: report.path.split(/[?#]/)[0],
    build: report.build,
    signedIn: session !== null,
  });
  if (session) notePhoneError(session.person.id);

  return new Response(null, { status: 204 });
});
