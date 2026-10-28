import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { Person } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { UnauthorizedError, ValidationError } from "@/lib/identity";
import { expectedOrigin, rpId } from "@/lib/webauthn";
import { takeChallenge } from "@/lib/webauthn-challenge";

/**
 * Checks a passkey's answer to the challenge this device was given, and says
 * whose passkey it is.
 *
 * Shared by signing in (api/identity/passkeys/auth) and by confirming it's you
 * before deleting your account (api/identity/account), so both hold a passkey
 * to the same standard: the right site, the right origin, a challenge used
 * once, and a signature counter that only goes up. The counter is stored back
 * on every success; an authenticator that replays an old count has been
 * cloned, and `verifyAuthenticationResponse` refuses it.
 */
export async function verifyPasskey(response: AuthenticationResponseJSON): Promise<Person> {
  const challenge = await takeChallenge();
  if (!challenge) throw new ValidationError("That took too long. Please try again.");

  const stored = await prisma.credential.findUnique({
    where: { externalId: response.id },
    include: { person: true },
  });
  if (!stored || stored.kind !== "passkey" || !stored.publicKey || stored.person.deletedAt) {
    throw new UnauthorizedError("That passkey isn't set up for Divvy.");
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: await expectedOrigin(),
    expectedRPID: await rpId(),
    credential: {
      id: stored.externalId as string,
      publicKey: new Uint8Array(stored.publicKey),
      counter: stored.counter,
      transports: stored.transports?.split(",").filter(Boolean),
    },
  }).catch(() => null);

  if (!verification?.verified) throw new UnauthorizedError("That passkey didn't work. Please try again.");

  await prisma.credential.update({
    where: { id: stored.id },
    data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
  });
  return stored.person;
}
