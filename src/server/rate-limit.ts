import { RateLimitError } from "@/lib/identity";

/**
 * A fixed-window limiter for the endpoints where guessing is the attack.
 *
 * Group invite codes are three short words - about 268k combinations - which is
 * deliberately small so they survive being read aloud across a dinner table.
 * Entropy is therefore not what protects them; a cap on attempts per source is.
 * Without it, the whole code space is walkable in minutes and every group in
 * the database is joinable.
 *
 * **This is per-process, in-memory state.** That is the right size for the way
 * Divvy is meant to run - one Node server, one SQLite file - and it is honest
 * about what it does not cover:
 *
 *   - Multiple instances behind a load balancer each keep their own counters,
 *     so the effective limit multiplies by the instance count. A deployment
 *     that scales out wants this backed by Redis or a database table instead.
 *   - Counters reset when the process restarts.
 *   - An attacker with many source addresses is only slowed, not stopped.
 *
 * It is still worth having: it turns "walk the entire code space over a coffee"
 * into "walk it over months", which is the difference that matters when the
 * thing being guarded is a dinner-party group.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/**
 * Dropped whenever the map grows past this. Entries are tiny, but an unbounded
 * map keyed by a value the caller controls is a memory leak with extra steps.
 */
const MAX_TRACKED = 10_000;

function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  // Still oversized after dropping the expired ones: the traffic is
  // adversarial, so start over rather than grow. Everyone gets a fresh
  // allowance, which is the safe direction to fail for a limiter that must
  // never lock out real users.
  if (windows.size > MAX_TRACKED) windows.clear();
}

export interface RateLimit {
  /** Attempts allowed inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Records an attempt against `key`, throwing once the allowance is used up.
 *
 * Call this *before* doing the work, so a rejected attempt costs the attacker
 * a round trip and costs the database nothing.
 */
export function consume(key: string, { limit, windowSeconds }: RateLimit): void {
  const now = Date.now();
  if (windows.size > MAX_TRACKED / 2) sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return;
  }

  existing.count++;
  if (existing.count > limit) {
    throw new RateLimitError(Math.max(1, Math.ceil((existing.resetAt - now) / 1000)));
  }
}

/**
 * Best-effort client address.
 *
 * Behind a proxy the socket address is the proxy's, so the forwarded headers
 * are the only signal available - and they are client-settable when the app is
 * exposed directly. That is acceptable here because the limiter is a speed bump
 * rather than an access control: the worst case is that a determined attacker
 * rotates the header and gets the un-limited behaviour this code replaced.
 * Anything stronger belongs at the proxy, which can see the real socket.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Convenience for the common "limit this endpoint by caller address" case. */
export function limitByAddress(request: Request, scope: string, limit: RateLimit): void {
  consume(`${scope}:${clientKey(request)}`, limit);
}

// ---------------------------------------------------------------------------
// The allowances themselves
// ---------------------------------------------------------------------------

/**
 * Anything that turns a guessed code into a yes/no answer.
 *
 * Twenty attempts per ten minutes is far above what a real person does — you
 * type an invite code once, maybe twice after a typo — and far below what
 * walking a 268k-entry code space needs. At this rate a full sweep takes about
 * two and a half years per source address.
 */
export const CODE_LOOKUP: RateLimit = { limit: 20, windowSeconds: 600 };

/**
 * Recovery keys are 32 random bytes, so this is not what stands between an
 * attacker and an identity. It is here so a stolen-key spray shows up as 429s
 * rather than as an unbounded stream of database lookups.
 */
export const RECOVERY_ATTEMPT: RateLimit = { limit: 20, windowSeconds: 3600 };

/**
 * Nudges.
 *
 * The per-person daily cap in the route is the real control; this only stops a
 * script from spraying every group at once. Generous, because a person with
 * four housemates settling up may legitimately send several in a minute.
 */
export const NUDGE: RateLimit = { limit: 30, windowSeconds: 600 };
