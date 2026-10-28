import { prisma } from "@/lib/db";
import { healthProblems } from "@/server/health";

/**
 * Health check, for the hosting platform and for uptime monitors.
 *
 * Answers 200 only when the database answers too: a server that is up but
 * cannot reach its data is down as far as anyone using it is concerned, and
 * reporting it healthy would keep a broken deploy in rotation. No account
 * needed and nothing sensitive returned.
 *
 * It also answers 503 while something is quietly broken (server/health.ts):
 * repeated server errors, a background job that stopped, or crashes on
 * people's phones. The uptime monitor emails the owner when this fails, so
 * this is how they hear about it.
 */
export async function GET(): Promise<Response> {
  const started = Date.now();
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
  } catch {
    return Response.json(
      { status: "error", reason: "database unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const problems = healthProblems();
  return Response.json(
    {
      status: problems.length > 0 ? "degraded" : "ok",
      ...(problems.length > 0 ? { problems } : {}),
      build: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
      databaseMs: Date.now() - started,
      uptimeSeconds: Math.round(process.uptime()),
    },
    { status: problems.length > 0 ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
