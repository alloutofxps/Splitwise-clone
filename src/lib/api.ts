/**
 * Server-side helpers shared by every route handler.
 *
 * The one non-obvious rule in here: **money crosses the wire as a decimal
 * string, never as a JSON number**. JSON numbers are float64, so a large
 * rupee-denominated balance would round on the way out and no amount of care
 * elsewhere would get it back. Every BigInt is stringified on the way out and
 * parsed back to BigInt on the way in.
 */

import { z, ZodError, type ZodType } from "zod";
import { Prisma } from "@prisma/client";
import {
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  RateLimitError,
  UnauthorizedError,
  ConflictError,
  ValidationError,
} from "./errors";
import { log } from "./log";
import { isKnownCurrency } from "./money";

/** Recursively replaces BigInt with string and Date with an ISO string. */
function serialize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    if (value instanceof Uint8Array) return undefined;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const next = serialize(item);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return value;
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(serialize(data)), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Balances change whenever anyone in the group adds anything, so a
      // cached API response is always a bug waiting to be reported.
      "Cache-Control": "no-store",
      ...(init.headers ?? {}),
    },
  });
}

export interface ApiErrorBody {
  error: string;
  details?: string[];
  code?: string;
}

export function errorResponse(status: number, body: ApiErrorBody): Response {
  return json(body, { status });
}

/**
 * Wraps a route handler so domain errors become the right status code and an
 * unexpected throw becomes a 500 with a message safe to show a user.
 */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return errorResponse(401, { error: error.message, code: "unauthorized" });
      }
      if (error instanceof ForbiddenError) {
        return errorResponse(403, { error: error.message, code: "forbidden" });
      }
      if (error instanceof NotFoundError) {
        return errorResponse(404, { error: error.message, code: "not_found" });
      }
      if (error instanceof ConflictError) {
        return errorResponse(409, { error: error.message, code: "conflict" });
      }
      if (error instanceof RateLimitError) {
        return json(
          { error: error.message, code: "rate_limited" },
          {
            status: 429,
            headers: { "Retry-After": String(error.retryAfterSeconds) },
          },
        );
      }
      if (error instanceof ValidationError) {
        return errorResponse(422, {
          error: error.message,
          details: error.details,
          code: "invalid",
        });
      }
      if (error instanceof ZodError) {
        const details = error.issues.map((issue) =>
          issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
        );
        return errorResponse(422, { error: details[0], details, code: "invalid" });
      }

      if (error instanceof PayloadTooLargeError) {
        return errorResponse(413, { error: error.message, code: "too_large" });
      }

      // Database errors that say something about the request rather than about
      // the server. A row that vanished between the access check and the write
      // is a 404; a unique key somebody else just took is a 409.
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2025") {
          return errorResponse(404, { error: "That no longer exists.", code: "not_found" });
        }
        if (error.code === "P2002") {
          return errorResponse(409, { error: "That is already in use.", code: "conflict" });
        }
        // Busy or timed-out database. Transient by definition, so it is a 503
        // with a hint to retry - which the offline outbox honours - rather than
        // a 500 that reads as "your data is broken".
        if (TRANSIENT_DB_CODES.has(error.code)) {
          log.warn("database busy", { requestId: requestIdOf(args[0]), code: error.code });
          return json(
            { error: "The server is busy. Try again in a moment.", code: "busy" },
            { status: 503, headers: { "Retry-After": "2" } },
          );
        }
      }

      log.error("unhandled route error", { requestId: requestIdOf(args[0]), error });
      return errorResponse(500, {
        error: "Something went wrong on our side. Your data is safe - try again.",
        code: "server_error",
      });
    }
  };
}

/** Prisma codes for a database that was busy or slow, not a request that was wrong. */
const TRANSIENT_DB_CODES = new Set(["P1008", "P2024", "P2028", "P2034"]);

function requestIdOf(value: unknown): string | undefined {
  return value instanceof Request ? (value.headers.get("x-request-id") ?? undefined) : undefined;
}

/**
 * The most a JSON body may be, in bytes, by default.
 *
 * Every endpoint used to read the whole body before looking at it, with no cap
 * at all - a 150 MB request was accepted without even an account. Ordinary
 * requests are a few kilobytes; routes that legitimately carry receipts pass a
 * larger limit explicitly.
 */
export const DEFAULT_BODY_LIMIT = 64 * 1024;

/**
 * Reads a request body as text, refusing it once it passes `maxBytes`.
 *
 * Streams rather than trusting Content-Length, which a client can leave out or
 * lie about; the read stops - and the connection is released - the moment the
 * limit is crossed, so an oversized body never sits in memory whole.
 */
export async function readLimitedText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await request.body?.cancel().catch(() => {});
    throw new PayloadTooLargeError();
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Parses and validates a JSON body, throwing a ValidationError on bad shape. */
export async function readBody<T>(
  request: Request,
  schema: ZodType<T>,
  { maxBytes = DEFAULT_BODY_LIMIT }: { maxBytes?: number } = {},
): Promise<T> {
  const text = await readLimitedText(request, maxBytes);
  let raw: unknown;
  try {
    raw = text.trim() === "" ? undefined : JSON.parse(text);
  } catch {
    throw new ValidationError("Expected a JSON body.");
  }
  return schema.parse(raw);
}

// ---------------------------------------------------------------------------
// Money on the wire
// ---------------------------------------------------------------------------

/**
 * Parses a minor-unit amount received from a client.
 *
 * Accepts a string of digits (what our own client sends) or a safe integer
 * (what a curl-wielding user is likely to send). Rejects anything else rather
 * than coercing, because a silently-zeroed amount is the worst possible
 * failure mode here.
 */
/**
 * The largest amount the system will accept, in minor units.
 *
 * Not an arbitrary product limit — it is the exact point where the money
 * pipeline stops being lossless. Amounts are `bigint` end to end, but
 * apportionment converts them to `number` to use as weights
 * (`convertedBreakdown`, and the creditor weights in debt simplification), and
 * a `number` only represents integers exactly up to 2^53-1. One unit past that,
 * a split of 100000000000000001 comes back as 100000000000000000: conservation
 * still holds, because the error is symmetric, but an individual balance is
 * wrong by a minor unit. That is precisely the failure the "money is never a
 * float" rule exists to prevent, so the boundary is enforced where money
 * enters rather than patched where it is spent.
 *
 * It is also far above any real expense: 2^53-1 minor units is ninety trillion
 * dollars. Anything larger is a typo or an attack, and both deserve a 422
 * rather than the 500 that SQLite's own 64-bit ceiling used to produce.
 */
export const MAX_MINOR_UNITS = BigInt(Number.MAX_SAFE_INTEGER);

export function parseMinorUnits(value: unknown, field = "amount"): bigint {
  const bounded = (amount: bigint): bigint => {
    if (amount > MAX_MINOR_UNITS || amount < -MAX_MINOR_UNITS) {
      throw new ValidationError(`${field} is too large to be represented exactly.`);
    }
    return amount;
  };

  if (typeof value === "bigint") return bounded(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new ValidationError(`${field} must be a whole number of minor units.`);
    }
    return bounded(BigInt(value));
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return bounded(BigInt(value.trim()));
  }
  throw new ValidationError(`${field} must be an integer amount in minor units.`);
}

/**
 * Zod schema for a minor-unit amount arriving as a string or number.
 *
 * Transforms to a plain `bigint`, so route handlers never see the wire format.
 */
export const minorUnits = (field = "amount") =>
  z.union([z.string(), z.number(), z.bigint()]).transform((value, ctx) => {
    try {
      return parseMinorUnits(value, field);
    } catch (error) {
      // Pass the parser's own reason through. Collapsing every failure into
      // "must be a whole number" told somebody who sent a well-formed integer
      // that was merely too large to be exact that their digits were not
      // digits - a message they could not act on and could not have been
      // right about.
      ctx.addIssue({
        code: "custom",
        message:
          error instanceof ValidationError
            ? error.message
            : `${field} must be a whole number of minor units, as a string.`,
      });
      return z.NEVER;
    }
  });

/**
 * A real ISO 4217 currency code, normalised to upper case.
 *
 * The shape check alone let "ZZZ" through, and a made-up code silently assumes
 * two decimals - wrong for real three- and zero-decimal currencies, and
 * meaningless for invented ones.
 */
export const currencyCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "Expected a three-letter currency code.")
  .transform((value) => value.toUpperCase())
  .refine((value) => isKnownCurrency(value), "That is not a currency we know.");

/**
 * An exchange rate: quote currency per one unit of base.
 *
 * A string rather than a number, all the way to the database, because a rate
 * is decimal data and a float would round it before it was ever used.
 *
 * `> 0` is the part that has to be enforced rather than assumed. The regex on
 * its own accepts "0" and "0.000000000000001", and both convert every amount
 * to nothing: the expense stores its real `amount`, renders "€50.00" in the
 * ledger, and moves no balance at all. Anyone in a group can file an expense,
 * so that is a way to make a shared ledger disagree with itself — visibly
 * spent, invisibly settled — and it is equally reachable by accident the day a
 * rate provider answers with a zero.
 *
 * Twelve fraction digits is where `convert` truncates, so anything smaller
 * rounds to zero downstream and is refused here rather than silently flattened.
 */
export const exchangeRateInput = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,12})?$/, "The exchange rate has to be a positive decimal number.")
  .refine((value) => Number(value) > 0, "The exchange rate has to be greater than zero.");

/** An ISO date string or timestamp, as a Date. */
export const dateInput = z
  .union([z.string(), z.number(), z.date()])
  .transform((value, ctx) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: "Expected a valid date." });
      return z.NEVER;
    }
    // A year-1 or year-9999 date is a typo or an attack, and either breaks
    // something downstream: month charts span centuries, budgets never match,
    // and a recurrence anchored there catches up forever. Routes that need a
    // tighter window apply their own on top.
    if (date.getTime() < DATE_FLOOR || date.getTime() > Date.now() + DATE_CEILING_AHEAD) {
      ctx.addIssue({ code: "custom", message: "That date is out of range." });
      return z.NEVER;
    }
    return date;
  });

const DATE_FLOOR = Date.UTC(2000, 0, 1);
const DATE_CEILING_AHEAD = 10 * 366 * 86_400_000;

/** Trimmed, length-capped free text. */
export const text = (max: number, label = "This") =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length <= max, `${label} is too long (max ${max} characters).`);
