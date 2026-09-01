/**
 * Identity without accounts.
 *
 * There is no sign-up, no password and no email. The first time someone opens
 * Divvy a Person row is created, and from then on they can hold several ways
 * of proving they are that person:
 *
 *   - a **passkey** per device — Face ID or a fingerprint, synced by the
 *     platform, which is the everyday path;
 *   - a **device link** — a QR code shown on a signed-in device and scanned by
 *     a new one, for getting onto a second device in seconds;
 *   - a **recovery key** — a long string, shown once, which works from
 *     anywhere and is the backstop when there is no other device to hand.
 *
 * The server keeps only a SHA-256 of the recovery secret and a public key for
 * each passkey, so a database dump hands over nobody's identity.
 *
 * Being signed in is separate from proving who you are. Each device gets its
 * own `Session` row, minted by whichever credential vouched for it. That
 * separation is what lets somebody rotate a recovery key without signing every
 * device out, and revoke one lost phone without touching the others.
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
import {
  generateInviteCode,
  generatePersonalCode,
  generateSecret,
  hashSecret,
} from "./codes";

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
  /** The `Session` row backing this request, absent on a legacy cookie. */
  sessionId?: string;
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

  const hash = hashSecret(decoded.secret);

  // The ordinary path: the cookie names a live session.
  const session = await prisma.session.findUnique({
    where: { secretHash: hash },
    include: { person: true },
  });
  if (session && session.personId === decoded.personId) {
    // Cheap enough to be worth it, and it is what makes the device list say
    // something true about which of them is still in use. Not awaited: a
    // request should not get slower to record its own timestamp.
    void prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {});
    return { person: session.person, sessionId: session.id };
  }

  /*
   * Cookies minted before sessions existed carried the recovery secret itself.
   *
   * Honouring them means nobody is signed out by the upgrade. It concedes
   * nothing: whoever holds the recovery secret can sign in from anywhere
   * anyway, so accepting it here grants no access they did not already have.
   * Rotating the recovery key retires these along with the key, which is the
   * documented way to cut off a device you no longer trust.
   */
  const legacy = await prisma.credential.findUnique({
    where: { secretHash: hash },
    include: { person: true },
  });
  if (legacy && legacy.kind === "recovery" && legacy.personId === decoded.personId) {
    return { person: legacy.person };
  }

  return null;
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

/** Creates a brand-new person and returns the recovery secret exactly once. */
export async function createIdentity(input: NewIdentity): Promise<{ person: Person; secret: string }> {
  const secret = generateSecret();
  const person = await prisma.person.create({
    data: {
      displayName: input.displayName.trim().slice(0, 60) || "Someone",
      avatarColor: input.avatarColor ?? "iris",
      avatarEmoji: input.avatarEmoji ?? null,
      defaultCurrency: input.defaultCurrency ?? "USD",
      inviteCode: await uniquePersonalCode(),
      credentials: {
        create: { kind: "recovery", secretHash: hashSecret(secret), label: "Recovery key" },
      },
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
  const ghost = await prisma.person.findUnique({
    where: { id: ghostId },
    include: { credentials: { select: { id: true }, take: 1 } },
  });
  if (!ghost) throw new NotFoundError("That placeholder no longer exists.");
  if (!ghost.isGhost || ghost.credentials.length > 0) {
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
      isGhost: false,
      credentials: {
        create: { kind: "recovery", secretHash: hashSecret(secret), label: "Recovery key" },
      },
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

  const credential = await prisma.credential.findUnique({
    where: { secretHash: hashSecret(secret) },
    include: { person: true },
  });
  if (!credential || credential.kind !== "recovery") {
    throw new NotFoundError("That recovery key does not match any profile.");
  }

  await prisma.$transaction([
    prisma.person.update({ where: { id: credential.personId }, data: { lastSeenAt: new Date() } }),
    prisma.credential.update({ where: { id: credential.id }, data: { lastUsedAt: new Date() } }),
  ]);
  return { person: credential.person, secret };
}

/**
 * Mints a fresh recovery key, retiring the old one.
 *
 * Deliberately leaves passkeys and live sessions alone: rotating is what
 * somebody does when they never saved the key or think it leaked, and signing
 * every one of their devices out as a side effect would punish exactly the
 * cautious behaviour the app wants. Cutting off other devices is what the
 * device list is for.
 */
export async function rotateSecret(personId: string): Promise<string> {
  const secret = generateSecret();
  await prisma.$transaction([
    prisma.credential.deleteMany({ where: { personId, kind: "recovery" } }),
    prisma.credential.create({
      data: { personId, kind: "recovery", secretHash: hashSecret(secret), label: "Recovery key" },
    }),
  ]);
  return secret;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * Turns "this person proved who they are" into "this device is signed in".
 *
 * Every route that produces a login — first run, recovery key, passkey,
 * scanned device link — funnels through here, so there is one place that
 * decides what a session is and exactly one shape of cookie.
 */
export async function startSession(
  personId: string,
  label = "This device",
): Promise<void> {
  const secret = generateSecret();
  await prisma.session.create({
    data: { personId, secretHash: hashSecret(secret), label: label.slice(0, 80) },
  });
  // Returns nothing on purpose. The secret's only destination is the httpOnly
  // cookie set here; handing it back would put a live session credential in
  // reach of a response body, and no caller has ever wanted it.
  await setIdentityCookie(personId, secret);
}

/** Ends the session the current cookie names, if it names one. */
export async function endCurrentSession(): Promise<void> {
  const store = await cookies();
  const raw = store.get(IDENTITY_COOKIE)?.value;
  const decoded = raw ? decodeCookie(raw) : null;
  if (decoded) {
    await prisma.session
      .deleteMany({ where: { secretHash: hashSecret(decoded.secret) } })
      .catch(() => {});
  }
  await clearIdentityCookie();
}

/**
 * A human-readable guess at what device this is, from the User-Agent.
 *
 * Only ever shown back to its owner in their own device list, so being wrong
 * costs nothing; being absent would make the list unreadable.
 */
export function describeDevice(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const platform =
    /iPhone/i.test(ua) ? "iPhone"
    : /iPad/i.test(ua) ? "iPad"
    : /Android/i.test(ua) ? "Android"
    : /Macintosh|Mac OS X/i.test(ua) ? "Mac"
    : /Windows/i.test(ua) ? "Windows"
    : /Linux/i.test(ua) ? "Linux"
    : "Device";
  const browser =
    /Edg\//i.test(ua) ? "Edge"
    : /Chrome\//i.test(ua) ? "Chrome"
    : /Firefox\//i.test(ua) ? "Firefox"
    : /Safari\//i.test(ua) ? "Safari"
    : null;
  return browser ? `${platform} · ${browser}` : platform;
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
