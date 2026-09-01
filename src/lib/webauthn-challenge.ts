/**
 * Where a WebAuthn challenge lives between the two halves of a ceremony.
 *
 * The server issues a challenge, the authenticator signs it, and the server
 * must confirm the signature covers *that* challenge and not a replayed one.
 * Something has to hold it in between.
 *
 * A short-lived httpOnly cookie rather than a table, because the alternative
 * needs a row written and swept for every tap of a button — including the
 * authentication ceremony, which by definition has no session to attach a row
 * to. The cookie is scoped, single-purpose and expires in minutes.
 */

import { cookies } from "next/headers";

const CHALLENGE_COOKIE = "divvy_webauthn";
const TTL_SECONDS = 5 * 60;

export async function stashChallenge(challenge: string): Promise<void> {
  const store = await cookies();
  store.set(CHALLENGE_COOKIE, challenge, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function takeChallenge(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(CHALLENGE_COOKIE)?.value ?? null;
  // Read once. A challenge that survived its ceremony would be replayable.
  if (value) store.delete(CHALLENGE_COOKIE);
  return value;
}
