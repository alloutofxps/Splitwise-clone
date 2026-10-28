import {
  generateAuthenticationOptions,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { after } from "next/server";
import { z } from "zod";
import { json, readBody, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ValidationError, describeDevice, startSession } from "@/lib/identity";
import { rpId } from "@/lib/webauthn";
import { stashChallenge } from "@/lib/webauthn-challenge";
import { verifyPasskey } from "@/server/passkey";
import { notifyNewDevice } from "@/server/push";
import { limitByAddress } from "@/server/rate-limit";
import { meDto } from "@/server/me";

const responseSchema = z.object({
  response: z.custom<AuthenticationResponseJSON>(
    (value) => typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string",
    "Expected an authentication response.",
  ),
});

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
 * Finishes signing in with a passkey. The check itself, counter and all, is
 * `verifyPasskey` (server/passkey.ts), shared with confirming it's you before
 * deleting your account.
 */
export const POST = route(async (request: Request) => {
  limitByAddress(request, "passkey-auth", { limit: 20, windowSeconds: 60 * 5 });

  // Through `readBody`, so malformed JSON is a 422 and an oversized body is
  // refused before it is read - `request.json()` threw a 500 on both.
  const body = await readBody(request, responseSchema);
  if (!body?.response) throw new ValidationError("Expected an authentication response.");

  const person = await verifyPasskey(body.response);
  await prisma.person.update({ where: { id: person.id }, data: { lastSeenAt: new Date() } });

  const label = describeDevice(request.headers.get("user-agent"));
  const sessionId = await startSession(person.id, label);
  // Tell the person's other devices, once the answer has gone (server/push.ts).
  after(() => notifyNewDevice(person.id, sessionId, label).catch(() => 0));
  return json({ me: await meDto(person) });
});
