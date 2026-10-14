/**
 * The typed errors a route can throw, each of which the `route()` wrapper in
 * `lib/api.ts` turns into the right status code.
 *
 * Kept apart from `identity.ts` so code that only needs to *throw* one does
 * not drag in cookies and the database client.
 */

export class UnauthorizedError extends Error {
  constructor(message = "Open the app and set up your profile first.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have access to that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Somebody else changed the row first.
 *
 * Distinct from a 403: the caller is entitled to the edit, they are just
 * working from a version that has since moved. The only safe answer is to
 * refuse and let them see the newer one, because the alternative - writing
 * anyway - silently discards whatever the other person did, and on a shared
 * ledger that is a balance nobody agreed to.
 */
export class ConflictError extends Error {
  constructor(message = "Somebody else changed this first.") {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * Thrown when a caller has used up an endpoint's allowance. Carries the number
 * of seconds until the next attempt so the route wrapper can set Retry-After.
 */
export class RateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message = "Too many attempts. Wait a moment and try again.") {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** A request body larger than the endpoint accepts. */
export class PayloadTooLargeError extends Error {
  constructor(message = "That request is too large.") {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

export class ValidationError extends Error {
  details: string[];
  constructor(details: string[] | string) {
    const list = Array.isArray(details) ? details : [details];
    super(list[0] ?? "That does not look right.");
    this.name = "ValidationError";
    this.details = list;
  }
}
