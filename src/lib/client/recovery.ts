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

// ---------------------------------------------------------------------------

/**
 * The key itself, held only until the user says they have written it down.
 *
 * Not a nicety. The key is generated once, hashed on the server, and shown on
 * exactly one screen — and saving it means leaving the app for a password
 * manager, which is precisely when a phone is most likely to discard the page
 * to reclaim memory. Coming back to a reloaded tab meant the key was gone for
 * good; the only remedy was noticing the warning on the account screen and
 * issuing a new one, which is a poor thing to discover later.
 *
 * `sessionStorage`, deliberately, and worth being straight about the tradeoff:
 * this puts the account's master credential in browser storage for the minute
 * or two between generating it and confirming it is saved. That is a real cost.
 * It buys back the far likelier failure — the key being lost by the very act of
 * going to save it — and the window is small, scoped to one tab, cleared on
 * acknowledgement, and gone when the tab closes. `localStorage` would survive
 * the tab and is not worth it for the same benefit.
 */
const PENDING_KEY = "divvy-recovery-key";

export function stashRecoveryKey(key: string): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, key);
  } catch {
    // Private mode, or storage disabled. The key is still on screen; this only
    // means a reload cannot bring it back.
  }
}

/** The key from an interrupted setup, if there is one. */
export function stashedRecoveryKey(): string | null {
  try {
    return window.sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export function clearStashedRecoveryKey(): void {
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to do; it will go when the tab does.
  }
}
