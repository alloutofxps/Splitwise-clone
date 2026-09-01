import { z } from "zod";
import { json, readBody, route, text } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { prisma } from "@/lib/db";

const KINDS = ["upi", "paypal", "venmo", "cashapp", "revolut", "monzo", "iban", "bank", "custom"] as const;

const schema = z.object({
  kind: z.enum(KINDS),
  label: text(40, "The label").nullable().optional(),
  value: text(140, "The handle").refine((v) => v.length > 0, "Add the handle itself."),
});

/**
 * Where to send this person money.
 *
 * Divvy does not process payments, so these are just handles - a UPI id, a
 * PayPal.me link, an IBAN. The settle-up screen turns them into a tappable
 * deep link and a QR code so the transfer happens in the user's own banking
 * app, which is what keeps the whole thing free and unregulated.
 */
export const POST = route(async (request: Request) => {
  const session = await requireSession();
  const input = await readBody(request, schema);

  const count = await prisma.paymentMethod.count({ where: { personId: session.person.id } });

  const method = await prisma.paymentMethod.create({
    data: {
      personId: session.person.id,
      kind: input.kind,
      label: input.label ?? null,
      value: input.value,
      sortOrder: count,
    },
  });

  return json({ paymentMethod: method }, { status: 201 });
});
