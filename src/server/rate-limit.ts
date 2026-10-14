import { RateLimitError } from "@/lib/errors";

/**
 * A fixed-window limiter for the endpoints where guessing or spamming is the
 * attack.
 *
 * Codes are no longer protected by this alone - invite and personal codes now
 * carry a random tail (see `lib/codes.ts`) that makes guessing hopeless - so
 * this is the second line of defence, plus the only thing that stops one
 * client creating accounts or firing nudges in bulk.
 *
 * **Per-process, in-memory state.** Right for the way Divvy runs - one Node
 * server, one SQLite file - with two known limits: counters reset on restart,
 * and several instances behind a load balancer would each keep their own.
 * Anything that scales out should move this to Redis.
 *
 * Two keys can be limited at once: the caller's network address and, when
 * signed in, their account. An attacker rotating addresses is still one
 * account; an account shared across a household is still several addresses.
 */

interface Window {
  count: number;
  resetAt: number;
  /** Over its allowance. Kept until it expires, whatever else is evicted. */
  blocked: boolean;
}

const windows = new Map<string, Window>();

/**
 * The most entries kept before old ones are dropped.
 *
 * This used to clear the whole map, which let anyone reset everybody's
 * counters by sending ten thousand requests with made-up addresses. Now
 * expired windows go first, then the oldest *unblocked* ones; a key that has
 * been refused stays refused until its window ends, however many other keys
 * arrive in the meantime.
 */
const MAX_TRACKED = 50_000;

function evict(now: number): void {
  const target = MAX_TRACKED * 0.9;
  for (const [key, window] of windows) {
    if (windows.size <= target) return;
    if (window.resetAt <= now) windows.delete(key);
  }
  for (const [key, window] of windows) {
    if (windows.size <= target) return;
    if (!window.blocked) windows.delete(key);
  }
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
export function consume(key: string, { limit: base, windowSeconds }: RateLimit): void {
  // `DIVVY_RATE_LIMIT_SCALE` multiplies every allowance - for load tests that
  // drive one account far harder than a person could. Unset in production.
  const scale = Number(process.env.DIVVY_RATE_LIMIT_SCALE ?? "1");
  const limit = Number.isFinite(scale) && scale > 0 ? Math.ceil(base * scale) : base;
  const now = Date.now();
  if (windows.size > MAX_TRACKED) evict(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.delete(key);
    windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000, blocked: false });
    return;
  }

  existing.count++;
  if (existing.count > limit) {
    existing.blocked = true;
    throw new RateLimitError(Math.max(1, Math.ceil((existing.resetAt - now) / 1000)));
  }
}

/**
 * The caller's address, as seen by the proxy in front of the app.
 *
 * `X-Forwarded-For` is a list that every hop *appends* to, and the left end is
 * whatever the client chose to send. Taking the first entry - which this used
 * to do - meant any client could pick its own rate-limit bucket by setting the
 * header, so the limiter limited nobody. The trustworthy entry is the one the
 * last proxy we control added: counting `DIVVY_TRUSTED_PROXIES` hops in from
 * the right. Railway, Fly, Render and a single nginx all add exactly one,
 * which is the default.
 *
 * Returns null when there is no address to trust - no proxy header at all, or
 * `DIVVY_TRUSTED_PROXIES=0` for an app exposed with no proxy - because a Next
 * route handler cannot see the socket address.
 */
export function clientKey(request: Request): string | null {
  const hops = Number.parseInt(process.env.DIVVY_TRUSTED_PROXIES ?? "1", 10);
  const trusted = Number.isFinite(hops) && hops >= 0 ? hops : 1;
  if (trusted === 0) return null;

  const forwarded = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const entry = forwarded[forwarded.length - trusted];
  if (entry) return entry;

  return request.headers.get("x-real-ip")?.trim() || null;
}

let warnedNoAddress = false;

/**
 * Convenience for the common "limit this endpoint by caller address" case.
 *
 * With no address to go on - no proxy in front, or one that does not forward
 * the client's - every visitor would share a single bucket, and ten sign-ups
 * an hour would be ten for the whole world. Address limits are skipped instead
 * (account limits still apply), and the operator is told once in the log.
 */
export function limitByAddress(request: Request, scope: string, limit: RateLimit): void {
  const key = clientKey(request);
  if (!key) {
    if (!warnedNoAddress) {
      warnedNoAddress = true;
      console.warn(
        JSON.stringify({
          level: "warn",
          time: new Date().toISOString(),
          msg: "no client address on requests; per-address rate limits are off. Put the app behind a proxy that sets X-Forwarded-For.",
        }),
      );
    }
    return;
  }
  consume(`${scope}:ip:${key}`, limit);
}

/** Limits a signed-in caller by account, whatever address they come from. */
export function limitByAccount(personId: string, scope: string, limit: RateLimit): void {
  consume(`${scope}:person:${personId}`, limit);
}

/** Test hook: forget every window. */
export function resetRateLimits(): void {
  windows.clear();
}

// ---------------------------------------------------------------------------
// The allowances themselves
// ---------------------------------------------------------------------------

/**
 * Anything that turns a guessed code into a yes/no answer.
 *
 * Twenty attempts per ten minutes is far above what a real person does - you
 * type an invite code once, maybe twice after a typo.
 */
export const CODE_LOOKUP: RateLimit = { limit: 20, windowSeconds: 600 };

/** The same, per account, so rotating addresses does not reset it. */
export const CODE_LOOKUP_ACCOUNT: RateLimit = { limit: 40, windowSeconds: 3600 };

/**
 * Recovery keys are 32 random bytes, so this is not what stands between an
 * attacker and an identity. It is here so a stolen-key spray shows up as 429s
 * rather than as an unbounded stream of database lookups.
 */
export const RECOVERY_ATTEMPT: RateLimit = { limit: 20, windowSeconds: 3600 };

/**
 * Creating an identity. Nobody sets up more than a couple of profiles from one
 * network in an hour - a family installing the app on four phones on the same
 * wifi is the generous case - and without a cap a script filled the database
 * at fifty accounts a second.
 */
export const SIGN_UP: RateLimit = { limit: 10, windowSeconds: 3600 };

/**
 * Nudges. The per-person daily cap in the route is the real control; this only
 * stops a script from spraying every group at once.
 */
export const NUDGE: RateLimit = { limit: 30, windowSeconds: 600 };

/** Comments: a conversation, not a firehose. */
export const COMMENT: RateLimit = { limit: 30, windowSeconds: 60 };

/** Writes that create rows (expenses, payments, members), per account. */
export const WRITE: RateLimit = { limit: 120, windowSeconds: 60 };
