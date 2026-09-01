/**
 * The browser half of the passkey ceremonies.
 *
 * Thin on purpose. Everything that decides anything — which credentials are
 * allowed, whether a signature is genuine, what a session is — happens on the
 * server; this file exists to carry JSON to the platform authenticator and
 * back, and to turn the two failures that are not really failures into
 * silence.
 */

import {
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";
import { api } from "@/lib/client/api";

export function passkeysSupported(): boolean {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

/**
 * True when the device can offer a passkey it already holds.
 *
 * Used to decide whether the sign-in screen shows the button at all. A button
 * that opens a system sheet saying "no passkeys found" teaches people the
 * feature is broken.
 */
export async function hasPlatformAuthenticator(): Promise<boolean> {
  try {
    if (!passkeysSupported()) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * A cancelled prompt is not an error.
 *
 * Dismissing the Face ID sheet throws `NotAllowedError`, and so does letting it
 * time out. Both mean "not now", and surfacing a red toast for either would
 * punish somebody for changing their mind.
 */
export class PasskeyCancelled extends Error {
  constructor() {
    super("Passkey prompt dismissed.");
    this.name = "PasskeyCancelled";
  }
}

function rethrow(error: unknown): never {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") throw new PasskeyCancelled();
  throw error;
}

/** Registers a passkey for the signed-in person. */
export async function registerPasskey(label?: string): Promise<void> {
  const { options } = await api.get<{ options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>(
    "/api/identity/passkeys/register",
  );

  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (error) {
    rethrow(error);
  }

  await api.post("/api/identity/passkeys/register", { response, label });
}

/** Signs in with whatever passkey the device offers for this site. */
export async function signInWithPasskey(): Promise<void> {
  const { options } = await api.get<{ options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>(
    "/api/identity/passkeys/auth",
  );

  let response;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch (error) {
    rethrow(error);
  }

  await api.post("/api/identity/passkeys/auth", { response });
}
