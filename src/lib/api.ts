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
import {
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from "./identity";

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

      console.error("[divvy] unhandled route error", error);
      return errorResponse(500, {
        error: "Something went wrong on our side. Your data is safe - try again.",
        code: "server_error",
      });
    }
  };
}

/** Parses and validates a JSON body, throwing a ValidationError on bad shape. */
export async function readBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
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
export function parseMinorUnits(value: unknown, field = "amount"): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new ValidationError(`${field} must be a whole number of minor units.`);
    }
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
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
    } catch {
      ctx.addIssue({
        code: "custom",
        message: `${field} must be a whole number of minor units, as a string.`,
      });
      return z.NEVER;
    }
  });

/** A three-letter ISO currency code, normalised to upper case. */
export const currencyCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "Expected a three-letter currency code.")
  .transform((value) => value.toUpperCase());

/** An ISO date string or timestamp, as a Date. */
export const dateInput = z
  .union([z.string(), z.number(), z.date()])
  .transform((value, ctx) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: "Expected a valid date." });
      return z.NEVER;
    }
    return date;
  });

/** Trimmed, length-capped free text. */
export const text = (max: number, label = "This") =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length <= max, `${label} is too long (max ${max} characters).`);
