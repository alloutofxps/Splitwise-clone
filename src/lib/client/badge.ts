"use client";

/**
 * The home-screen badge.
 *
 * Divvy has no push notifications — there is no server to send them from in a
 * self-hosted install, and asking for notification permission to deliver
 * nothing would be dishonest. The Badging API is the useful half of that
 * without any of the infrastructure: the count is set whenever the app has the
 * dashboard in hand, which is every launch and every focus refetch.
 *
 * It is therefore accurate as of the last time the app was open, and stale
 * after that. That is exactly the right guarantee for "3 things happened while
 * you were away" and the wrong one for anything time-critical, which is why
 * nothing time-critical is put on it.
 *
 * Supported on installed PWAs in Chrome/Edge on desktop and Android, and in
 * Safari 16.4+ on iOS for home-screen apps. Everywhere else the calls are
 * absent and this does nothing.
 */

interface Badging {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

function badging(): Badging | null {
  if (typeof navigator === "undefined") return null;
  const candidate = navigator as Badging;
  return typeof candidate.setAppBadge === "function" ? candidate : null;
}

export function badgingSupported(): boolean {
  return badging() !== null;
}

/**
 * Sets the badge to `count`, or clears it at zero.
 *
 * Never throws and never returns a rejected promise: a badge is decoration,
 * and a decoration that can break a render is a bad trade. Failures are
 * swallowed deliberately — the call rejects on iOS when the app is not
 * installed to the home screen, which is a normal state, not an error.
 */
export function setBadge(count: number): void {
  const target = badging();
  if (!target) return;

  const safe = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;

  try {
    const result = safe > 0 ? target.setAppBadge?.(safe) : target.clearAppBadge?.();
    void result?.catch(() => undefined);
  } catch {
    // Synchronous throw in some WebViews. Same treatment.
  }
}

export function clearBadge(): void {
  setBadge(0);
}
