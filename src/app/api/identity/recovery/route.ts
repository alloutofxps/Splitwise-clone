import { json, route } from "@/lib/api";
import { formatRecoveryKey } from "@/lib/codes";
import { requireSession, rotateSecret } from "@/lib/identity";

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

  // No cookie to re-issue: sessions are their own rows now, so replacing the
  // recovery key no longer signs anybody out - not this device, and not the
  // other ones the person is deliberately keeping.
  const secret = await rotateSecret(session.person.id);

  return json({
    recoveryKey: secret,
    recoveryKeyDisplay: formatRecoveryKey(secret),
    rotatedAt: new Date().toISOString(),
  });
});
