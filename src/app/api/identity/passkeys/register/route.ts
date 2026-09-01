import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { json, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ValidationError, describeDevice, requireSession } from "@/lib/identity";
import { RP_NAME, expectedOrigin, rpId } from "@/lib/webauthn";
import { stashChallenge, takeChallenge } from "@/lib/webauthn-challenge";

/**
 * Starts registering a passkey for the signed-in person.
 *
 * Existing credentials go in `excludeCredentials` so an authenticator that
 * already holds one for this account says so rather than quietly making a
 * second — which would leave a device list full of duplicates nobody can tell
 * apart.
 */
export const GET = route(async () => {
  const session = await requireSession();
  const id = await rpId();

  const existing = await prisma.credential.findMany({
    where: { personId: session.person.id, kind: "passkey" },
    select: { externalId: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: id,
    userName: session.person.displayName,
    userDisplayName: session.person.displayName,
    // Not the person id: this is a handle the authenticator stores, and person
    // ids appear in every group member list.
    userID: new TextEncoder().encode(session.person.id),
    attestationType: "none",
    excludeCredentials: existing
      .filter((c) => c.externalId)
      .map((c) => ({
        id: c.externalId as string,
        transports: c.transports?.split(",").filter(Boolean) as never,
      })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  await stashChallenge(options.challenge);
  return json({ options, rpId: id });
});

/**
 * Finishes registration and stores the credential.
 *
 * `rpId` is recorded alongside it so the account screen can later tell whether
 * a passkey still belongs to the address the app is being served from.
 */
export const POST = route(async (request: Request) => {
  const session = await requireSession();
  const body = (await request.json()) as { response?: RegistrationResponseJSON; label?: string };
  if (!body?.response) throw new ValidationError("Expected a registration response.");

  const challenge = await takeChallenge();
  if (!challenge) throw new ValidationError("That took too long. Try adding the passkey again.");

  const id = await rpId();
  const verification = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge: challenge,
    expectedOrigin: await expectedOrigin(),
    expectedRPID: id,
  }).catch(() => null);

  if (!verification?.verified || !verification.registrationInfo) {
    throw new ValidationError("That passkey could not be verified.");
  }

  const { credential } = verification.registrationInfo;
  const label =
    body.label?.trim().slice(0, 60) || describeDevice(request.headers.get("user-agent"));

  const saved = await prisma.credential.create({
    data: {
      personId: session.person.id,
      kind: "passkey",
      externalId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports?.join(",") ?? null,
      rpId: id,
      label,
    },
  });

  return json({ credential: { id: saved.id, label: saved.label, createdAt: saved.createdAt } }, { status: 201 });
});
