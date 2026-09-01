import { json, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const session = await requireSession();

  // Scoped by personId so an id from someone else's profile is a no-op.
  await prisma.paymentMethod.deleteMany({
    where: { id, personId: session.person.id },
  });

  return json({ ok: true });
});
