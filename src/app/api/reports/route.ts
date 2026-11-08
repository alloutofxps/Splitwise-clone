import { after } from "next/server";
import { z } from "zod";
import { json, readBody, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { describeDevice, getSession, requireSession } from "@/lib/identity";
import { personDto } from "@/server/read";
import { notifyReport } from "@/server/push";
import { limitByAccount, limitByAddress } from "@/server/rate-limit";
import { readsReports, reportsReaderCode } from "@/server/reports";
import type { ReportDto } from "@/lib/types";

const schema = z.object({
  text: z.string().trim().min(1, "Write what happened.").max(2000, "That's a bit long. Keep it under 2,000 letters."),
  path: z.string().max(200),
  build: z.string().max(40).optional(),
});

/**
 * "Something wrong?": what someone wrote, kept for whoever runs Divvy, whose
 * phone is told. Open to people who aren't signed in, since not being able to
 * sign in is a common reason to write.
 */
export const POST = route(async (request: Request) => {
  limitByAddress(request, "report", { limit: 5, windowSeconds: 3600 });
  const session = await getSession();
  if (session) limitByAccount(session.person.id, "report", { limit: 10, windowSeconds: 86_400 });
  const input = await readBody(request, schema, { maxBytes: 8192 });

  const report = await prisma.report.create({
    data: {
      personId: session?.person.id ?? null,
      text: input.text,
      path: input.path.split(/[?#]/)[0],
      build: input.build ?? "",
      device: describeDevice(request.headers.get("user-agent")),
    },
  });

  const code = reportsReaderCode();
  if (code) {
    after(async () => {
      const reader = await prisma.person.findUnique({ where: { inviteCode: code }, select: { id: true } });
      if (reader) await notifyReport(reader.id, { id: report.id, text: report.text, signedIn: Boolean(session) }).catch(() => 0);
    });
  }

  return json({ ok: true }, { status: 201 });
});

/** The reports, newest first, for whoever reads them and nobody else. */
export const GET = route(async () => {
  const session = await requireSession();
  if (!readsReports(session.person)) throw new ForbiddenError("Only whoever runs Divvy can read these.");

  const rows = await prisma.report.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { person: true },
  });
  const reports: ReportDto[] = rows.map((row) => ({
    id: row.id,
    text: row.text,
    path: row.path,
    build: row.build,
    device: row.device,
    createdAt: row.createdAt.toISOString(),
    from: row.person && !row.person.deletedAt ? personDto(row.person) : null,
  }));
  return json({ reports });
});
