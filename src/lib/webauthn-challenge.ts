/**
 * Where a WebAuthn challenge lives between the two halves of a ceremony.
 *
 * The server issues a challenge, the authenticator signs it, and the server
 * must confirm the signature covers *that* challenge and not a replayed one.
 *
 * The challenge itself used to travel in a cookie and nowhere else, which
 * meant the client was the only record of what had been issued: anyone could
 * set that cookie to the challenge inside an assertion they had captured, and
 * replay it - the signature counter does not help, because synced passkeys
 * (iCloud Keychain, Google Password Manager) report a counter of zero.
 *
 * Challenges are now rows. The cookie only names one; the row is deleted the
 * moment it is used, and expires in minutes if it never is. A captured
 * assertion is therefore worthless after its own ceremony.
 */

import { cookies } from "next/headers";
import { prisma } from "./db";

const CHALLENGE_COOKIE = "divvy_webauthn";
const TTL_SECONDS = 5 * 60;

export async function stashChallenge(challenge: string): Promise<void> {
  const row = await prisma.webAuthnChallenge.create({
    data: { challenge, expiresAt: new Date(Date.now() + TTL_SECONDS * 1000) },
  });
  const store = await cookies();
  store.set(CHALLENGE_COOKIE, row.id, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

/** The challenge this browser was issued, consumed in the same breath. */
export async function takeChallenge(): Promise<string | null> {
  const store = await cookies();
  const id = store.get(CHALLENGE_COOKIE)?.value;
  if (!id) return null;
  store.delete(CHALLENGE_COOKIE);

  const row = await prisma.webAuthnChallenge.findUnique({ where: { id } });
  if (!row) return null;
  // Deleted conditionally, so two requests racing on one challenge cannot
  // both get it.
  const taken = await prisma.webAuthnChallenge.deleteMany({ where: { id } });
  if (taken.count !== 1 || row.expiresAt.getTime() < Date.now()) return null;
  return row.challenge;
}
