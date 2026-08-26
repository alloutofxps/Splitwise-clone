import { readStored, removeStored, writeStored } from "./storage";

/**
 * Whether this browser created an account and never confirmed the key was saved.
 *
 * The server keeps only a SHA-256 of the recovery key, so a key that is not
 * written down at the moment it is generated is gone — it can be replaced, but
 * never shown again. The onboarding flow makes that hard to miss, but it cannot
 * make it impossible: a user can close the tab on the recovery step, and the
 * account exists from the moment the profile step returns.
 *
 * So the fact is recorded rather than assumed. The flag is set when the identity
 * is created and cleared when the user confirms they have saved the key; while
 * it is present, the account screen says so and offers to generate a new one.
 *
 * Absence of the flag means "nothing to say", not "all is well" — an account
 * restored from a key on a second device never sets it, and must not be nagged.
 */

const KEY = "divvy-recovery-pending";

export function markRecoveryPending(): void {
  writeStored(KEY, "1");
}

export function clearRecoveryPending(): void {
  removeStored(KEY);
}

export function recoveryPending(): boolean {
  return readStored(KEY) === "1";
}
