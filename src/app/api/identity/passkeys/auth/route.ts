import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { json, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import {
  UnauthorizedError,
  ValidationError,
  describeDevice,
  startSession,
} from "@/lib/identity";
import { expectedOrigin, rpId } from "@/lib/webauthn";
import { stashChallenge, takeChallenge } from "@/lib/webauthn-challenge";
import { limitByAddress } from "@/server/rate-limit";
import { meDto } from "@/server/me";

/**
 * Starts signing in with a passkey.
 *
 * No `allowCredentials`, deliberately. The list is empty so the browser offers
 * whatever discoverable passkey it holds for this domain, which is what makes
 * the flow work with no name typed first — there is no username in this app to
 * type. It also means this endpoint reveals nothing about who has an account.
 */
export const GET = route(async (request: Request) => {
  limitByAddress(request, "passkey-auth-options", { limit: 30, windowSeconds: 60 * 5 });

  const options = await generateAuthenticationOptions({
    rpID: await rpId(),
    userVerification: "preferred",
  });

  await stashChallenge(options.challenge);
  return json({ options });
});

/**
 * Finishes signing in with a passkey.
 *
 * The signature counter is stored back on every success. An authenticator that
 * replays an old count has been cloned, and `verifyAuthenticationResponse`
 * refuses it — the one check here that a copied credential cannot talk its way
 * past.
 */
export const POST = route(async (request: Request) => {
  limitByAddress(request, "passkey-auth", { limit: 20, windowSeconds: 60 * 5 });

  const body = (await request.json()) as { response?: AuthenticationResponseJSON };
  if (!body?.response) throw new ValidationError("Expected an authentication response.");

  const challenge = await takeChallenge();
  if (!challenge) throw new ValidationError("That took too long. Try signing in again.");

  const stored = await prisma.credential.findUnique({
    where: { externalId: body.response.id },
    include: { person: true },
  });
  if (!stored || stored.kind !== "passkey" || !stored.publicKey) {
    throw new UnauthorizedError("That passkey is not registered here.");
  }

  const verification = await verifyAuthenticationResponse({
    response: body.response,
    expectedChallenge: challenge,
    expectedOrigin: await expectedOrigin(),
    expectedRPID: await rpId(),
    credential: {
      id: stored.externalId as string,
      publicKey: new Uint8Array(stored.publicKey),
      counter: stored.counter,
      transports: stored.transports?.split(",").filter(Boolean) as never,
    },
  }).catch(() => null);

  if (!verification?.verified) throw new UnauthorizedError("That passkey could not be verified.");

  await prisma.$transaction([
    prisma.credential.update({
      where: { id: stored.id },
      data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
    }),
    prisma.person.update({ where: { id: stored.personId }, data: { lastSeenAt: new Date() } }),
  ]);

  await startSession(stored.personId, describeDevice(request.headers.get("user-agent")));
  return json({ me: await meDto(stored.person) });
});
