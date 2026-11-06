import { readStored, removeStored, writeStored } from "./storage";

/**
 * This device has been signed in before.
 *
 * Someone signed out without meaning to be (180 days unused, or a phone that
 * dropped its cookies) sees the welcome screen. Leading with "Get started" there
 * is how a second account gets made, so the screen leads with signing back in.
 *
 * Only a yes or no, nothing about who. Signing out leaves it, since whoever did
 * is likely to be back. Deleting the account clears it.
 */
const KEY = "divvy-signed-in-here";

export function rememberSignedInHere(): void {
  writeStored(KEY, "1");
}

export function wasSignedInHere(): boolean {
  return readStored(KEY) === "1";
}

export function forgetSignedInHere(): void {
  removeStored(KEY);
}
