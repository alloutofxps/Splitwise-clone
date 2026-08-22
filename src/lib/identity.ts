/**
 * Identity without accounts.
 *
 * There is no sign-up, no password and no email. The first time someone opens
 * Divvy a Person row is created and a secret is minted. The secret is stored
 * two ways:
 *
 *   - in an httpOnly, signed cookie, which is what authenticates every request;
 *   - shown to the user once as a **recovery key** they can save, which is the
 *     only way back in if they clear their browser or change phone.
 *
 * The server keeps only a SHA-256 of the secret, so a database dump does not
 * hand over anyone's identity.
 *
 * The tradeoff versus real accounts is deliberate and worth naming: anyone
 * holding the recovery key *is* that person. That is the same security model as
 * a house key, and it is the right one for an app whose threat model is
 * "friends splitting a holiday", not "an adversary wants Priya's grocery
 * history".
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Person } from "@prisma/client";
import { prisma } from "./db";
import { generateInviteCode, generatePersonalCode, generateSecret, hashSecret } from "./codes";

export const IDENTITY_COOKIE = "divvy_id";

/** Ten years: this cookie is the account, so losing it means losing access. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10;

function secretKey(): string {
  const value = process.env.DIVVY_SECRET;
  if (!value || value.length < 16) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "DIVVY_SECRET is missing or too short. Generate one with `openssl rand -hex 32`.",
      );
    }
    return "divvy-development-fallback-secret";
  }
  return value;
}

/**
 * Cookie value is `personId.secret.signature`. The signature stops anyone
 * swapping in another person's id, and the secret is verified against the
 * stored hash on every request so revoking a Person genuinely locks them out.
 */
function sign(payload: string): string {
  return createHmac("sha256", secretKey()).update(payload).digest("base64url");
}

export function encodeCookie(personId: string, secret: string): string {
  const payload = `${personId}.${secret}`;
  return `${payload}.${sign(payload)}`;
}

export function decodeCookie(value: string): { personId: string; secret: string } | null {
  const lastDot = value.lastIndexOf(".");
  if (lastDot === -1) return null;

  const payload = value.slice(0, lastDot);
  const signature = value.slice(lastDot + 1);

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const separator = payload.indexOf(".");
  if (separator === -1) return null;
  return {
    personId: payload.slice(0, separator),
    secret: payload.slice(separator + 1),
  };
}

// ---------------------------------------------------------------------------

export interface Session {
  person: Person;
  /** Present only on the request that created the identity. */
  freshSecret?: string;
}

/**
 * Resolves the caller, or null when there is no valid cookie.
 *
 * Never creates anything - callers that need an identity use
 * `createIdentity` explicitly, so a stray crawler request cannot fill the
 * database with empty people.
 */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(IDENTITY_COOKIE)?.value;
  if (!raw) return null;

  const decoded = decodeCookie(raw);
  if (!decoded) return null;

  const person = await prisma.person.findUnique({ where: { id: decoded.personId } });
  if (!person || !person.tokenHash) return null;
  if (person.tokenHash !== hashSecret(decoded.secret)) return null;

  return { person };
}

/** Throws a typed error that the route wrapper turns into a 401. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

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

export class ValidationError extends Error {
  details: string[];
  constructor(details: string[] | string) {
    const list = Array.isArray(details) ? details : [details];
    super(list[0] ?? "That does not look right.");
    this.name = "ValidationError";
    this.details = list;
  }
}

// ---------------------------------------------------------------------------

export interface NewIdentity {
  displayName: string;
  avatarColor?: string;
  avatarEmoji?: string | null;
  defaultCurrency?: string;
}

/** Creates a brand-new person and returns the secret exactly once. */
export async function createIdentity(input: NewIdentity): Promise<{ person: Person; secret: string }> {
  const secret = generateSecret();
  const person = await prisma.person.create({
    data: {
      displayName: input.displayName.trim().slice(0, 60) || "Someone",
      avatarColor: input.avatarColor ?? "iris",
      avatarEmoji: input.avatarEmoji ?? null,
      defaultCurrency: input.defaultCurrency ?? "USD",
      tokenHash: hashSecret(secret),
      inviteCode: await uniquePersonalCode(),
    },
  });
  return { person, secret };
}

/**
 * Turns a placeholder into a real identity.
 *
 * Someone added "Sam" to a group before Sam had the app. When Sam joins and
 * says "that's me", the ghost row is upgraded in place rather than creating a
 * second Sam - which keeps every expense already filed against the ghost.
 */
export async function claimGhost(
  ghostId: string,
  input: NewIdentity,
): Promise<{ person: Person; secret: string }> {
  const ghost = await prisma.person.findUnique({ where: { id: ghostId } });
  if (!ghost) throw new NotFoundError("That placeholder no longer exists.");
  if (!ghost.isGhost || ghost.tokenHash) {
    throw new ForbiddenError("Someone has already claimed that name.");
  }

  const secret = generateSecret();
  const person = await prisma.person.update({
    where: { id: ghostId },
    data: {
      displayName: input.displayName.trim().slice(0, 60) || ghost.displayName,
      avatarColor: input.avatarColor ?? ghost.avatarColor,
      avatarEmoji: input.avatarEmoji ?? ghost.avatarEmoji,
      defaultCurrency: input.defaultCurrency ?? ghost.defaultCurrency,
      tokenHash: hashSecret(secret),
      isGhost: false,
    },
  });
  return { person, secret };
}

/**
 * Normalises a recovery key as typed or pasted by a user.
 *
 * The display form is chunked into groups of eight for legibility, and the
 * `dvy_` prefix is easy to lose when copying, so both are tolerated.
 */
export function normalizeSecret(input: string): string {
  const compact = input.trim().replace(/\s+/g, "");
  return compact.startsWith("dvy_") ? compact : `dvy_${compact}`;
}

/** Signs in an existing identity from a recovery key. */
export async function restoreIdentity(
  input: string,
): Promise<{ person: Person; secret: string }> {
  const secret = normalizeSecret(input);

  const person = await prisma.person.findUnique({
    where: { tokenHash: hashSecret(secret) },
  });
  if (!person) throw new NotFoundError("That recovery key does not match any profile.");

  await prisma.person.update({
    where: { id: person.id },
    data: { lastSeenAt: new Date() },
  });
  return { person, secret };
}

/** The raw secret for a person, re-derived is impossible - so this re-mints. */
export async function rotateSecret(personId: string): Promise<string> {
  const secret = generateSecret();
  await prisma.person.update({
    where: { id: personId },
    data: { tokenHash: hashSecret(secret) },
  });
  return secret;
}

// ---------------------------------------------------------------------------

export async function setIdentityCookie(personId: string, secret: string): Promise<void> {
  const store = await cookies();
  store.set(IDENTITY_COOKIE, encodeCookie(personId, secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function clearIdentityCookie(): Promise<void> {
  const store = await cookies();
  store.delete(IDENTITY_COOKIE);
}

// ---------------------------------------------------------------------------

/**
 * Retries on collision. The code space is large enough that a second attempt is
 * already unlikely; ten makes it vanishingly so.
 */
export async function uniqueGroupCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateInviteCode();
    const taken = await prisma.group.findUnique({ where: { inviteCode: code } });
    if (!taken) return code;
  }
  // Fall back to a longer code rather than failing the request.
  return `${generateInviteCode()}-${Date.now().toString(36).slice(-4)}`;
}

export async function uniquePersonalCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generatePersonalCode();
    const taken = await prisma.person.findUnique({ where: { inviteCode: code } });
    if (!taken) return code;
  }
  return `${generatePersonalCode()}-${Date.now().toString(36).slice(-4)}`;
}
