/**
 * A short buzz on a meaningful action.
 *
 * Android fires the Vibration API; iOS ignores it entirely and there is no web
 * equivalent of a Taptic tap, so this is a progressive enhancement rather than
 * a promise. Kept to the confirming actions only - vibrating on every tap makes
 * a phone feel cheap.
 *
 * In its own file so the error screen can use it without the rest of
 * `primitives.tsx`, which also passes it on.
 */
export function haptic(pattern: number | number[] = 8): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers expose `vibrate` but throw when the page is not visible.
  }
}
