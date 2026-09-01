import { json, route } from "@/lib/api";
import { formatRecoveryKey } from "@/lib/codes";
import { requireSession, rotateSecret, setIdentityCookie } from "@/lib/identity";

/**
 * Issues a fresh recovery key.
 *
 * There is no "show me my existing key" endpoint, because the server never has
 * it - only a SHA-256. Someone who missed the key at setup rotates to a new one
 * here, which invalidates the old key and any device still holding it. The UI
 * says so before calling this.
 */
export const POST = route(async () => {
  const session = await requireSession();

  const secret = await rotateSecret(session.person.id);
  // Re-issue this device's cookie against the new secret, or the caller would
  // log themselves out by asking for a key.
  await setIdentityCookie(session.person.id, secret);

  return json({
    recoveryKey: secret,
    recoveryKeyDisplay: formatRecoveryKey(secret),
    rotatedAt: new Date().toISOString(),
  });
});
