import { prisma } from "@/lib/db";

/**
 * Health check, for the hosting platform and for uptime monitors.
 *
 * Answers 200 only when the database answers too: a server that is up but
 * cannot reach its data is down as far as anyone using it is concerned, and
 * reporting it healthy would keep a broken deploy in rotation. No account
 * needed and nothing sensitive returned.
 */
export async function GET(): Promise<Response> {
  const started = Date.now();
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return Response.json(
      {
        status: "ok",
        build: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
        databaseMs: Date.now() - started,
        uptimeSeconds: Math.round(process.uptime()),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "error", reason: "database unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
