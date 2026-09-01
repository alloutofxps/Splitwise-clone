import { json, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/identity";
import { rpId, usableHere } from "@/lib/webauthn";

/**
 * Everything that can currently get into this account.
 *
 * Passkeys and signed-in devices in one list, because the distinction the
 * owner actually cares about is "can this thing reach my money" — not which
 * table it lives in.
 *
 * Each passkey is checked against the address the app is being served from.
 * A passkey registered for a domain the app has since moved off is not broken
 * so much as unreachable, and saying so is the difference between somebody
 * understanding what happened and concluding the app is faulty.
 */
export const GET = route(async () => {
  const session = await requireSession();
  const id = await rpId();

  const [credentials, sessions] = await Promise.all([
    prisma.credential.findMany({
      where: { personId: session.person.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.session.findMany({
      where: { personId: session.person.id },
      orderBy: { lastSeenAt: "desc" },
    }),
  ]);

  return json({
    rpId: id,
    passkeys: credentials
      .filter((c) => c.kind === "passkey")
      .map((c) => ({
        id: c.id,
        label: c.label,
        createdAt: c.createdAt.toISOString(),
        lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
        rpId: c.rpId,
        usableHere: usableHere(c.rpId, id),
      })),
    hasRecoveryKey: credentials.some((c) => c.kind === "recovery"),
    sessions: sessions.map((s) => ({
      id: s.id,
      label: s.label,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      // Which row is the phone in your hand. Without it the list is a set of
      // near-identical names and removing the wrong one signs you out with no
      // explanation — found exactly that way, by a test that revoked its own
      // session and then could not understand its next 401.
      current: s.id === session.sessionId,
    })),
  });
});
