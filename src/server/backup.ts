/**
 * Whether to ask someone if they've saved a way back into their account.
 *
 * Until November 2026 joining from an invite link made an account without ever
 * showing its recovery key, and without the reminder the main sign-up leaves.
 * The server keeps only a hash of the key, so it can't tell who saved theirs.
 * What it can tell is who certainly has a way back in: anyone with a passkey,
 * anyone who has replaced their key since, and anyone who has signed in with it.
 * Everyone else from before the fix is asked once, and can say they have it.
 *
 * Accounts made since have the reminder from the moment they're made, so they
 * are never asked this.
 */
export const ASK_ACCOUNTS_MADE_BEFORE = new Date("2026-11-05T22:30:00Z");

/** A key made this soon after the account is the one made with it. */
const SAME_KEY_WITHIN_MS = 60_000;

export interface CredentialDates {
  kind: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export function backupUnconfirmed(accountMadeAt: Date, credentials: CredentialDates[]): boolean {
  if (accountMadeAt >= ASK_ACCOUNTS_MADE_BEFORE) return false;
  if (credentials.some((credential) => credential.kind === "passkey")) return false;
  const key = credentials.find((credential) => credential.kind === "recovery");
  if (!key) return true;
  if (key.lastUsedAt) return false;
  return key.createdAt.getTime() - accountMadeAt.getTime() < SAME_KEY_WITHIN_MS;
}
