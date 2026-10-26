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
import type { Person } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  generateInviteCode,
  generatePersonalCode,
  generateSecret,
  hashSecret,
} from "./codes";
import { NotFoundError, UnauthorizedError } from "./errors";

export const IDENTITY_COOKIE = "divvy_id";

/**
 * 400 days, re-issued as the device is used.
 *
 * This was ten years and never refreshed, which looked generous and was not:
 * Chrome caps every cookie at 400 days, so an active user was silently signed
 * out a little over a year after they first opened the app. Rolling the cookie
 * forward on use (see `getSession`) keeps an active device signed in for good.
 */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

/**
 * A signed-in device that has not been used for this long stops working.
 *
 * Long enough that nobody who opens the app occasionally is ever affected;
 * short enough that a lost, sold or forgotten phone does not keep access to
 * someone's finances indefinitely. Signing back in takes a passkey or the
 * recovery key, both of which survive this.
 */
export const SESSION_IDLE_DAYS = 180;

/**
 * How stale `lastSeenAt` may get before a request bothers to update it, and
 * before the cookie is re-issued. Writing on every request put a database
 * write in front of every read in the app.
 */
const TOUCH_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
  const now = Date.now();

  // The ordinary path: the cookie names a live session.
  const session = await prisma.session.findUnique({
    where: { secretHash: hash },
    include: { person: true },
  });
  if (session && session.personId === decoded.personId) {
    if (session.person.deletedAt) return null;

    // An abandoned device. Removed rather than merely refused, so it also
    // disappears from the owner's device list.
    if (now - session.lastSeenAt.getTime() > SESSION_IDLE_DAYS * 86_400_000) {
      await prisma.session.deleteMany({ where: { id: session.id } }).catch(() => {});
      await clearIdentityCookie().catch(() => {});
      return null;
    }

    if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      // What makes the device list say something true about which devices are
      // still in use, and what keeps the idle clock above from running out on
      // somebody who uses the app. Throttled, not per request.
      await prisma.session
        .update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } })
        .catch(() => {});
      await setIdentityCookie(session.personId, decoded.secret).catch(() => {});
    }
    return { person: session.person, sessionId: session.id };
  }

  /*
   * Cookies minted before sessions existed carried the recovery secret itself.
   *
   * Still honoured, so nobody is signed out by the upgrade - but only once. The
   * device is moved onto a session of its own and handed a new cookie, so the
   * master recovery key stops travelling with every request and stops sitting
   * in the browser's cookie jar.
   */
  const legacy = await prisma.credential.findUnique({
    where: { secretHash: hash },
    include: { person: true },
  });
  if (
    legacy &&
    legacy.kind === "recovery" &&
    legacy.personId === decoded.personId &&
    !legacy.person.deletedAt
  ) {
    try {
      const sessionId = await startSession(legacy.personId, "This device");
      return { person: legacy.person, sessionId };
    } catch {
      // Cookies cannot be written from here (a render rather than a route).
      // The request still succeeds; the upgrade happens on the next one.
      return { person: legacy.person };
    }
  }

  return null;
}

/** Throws a typed error that the route wrapper turns into a 401. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

// The error classes moved to `errors.ts`; re-exported so every existing import
// from here keeps working.
export {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from "./errors";

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
      avatarColor: input.avatarColor ?? "cobalt",
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

/*
 * There was a `claimGhost` here that turned a placeholder into a real identity
 * at sign-up, given nothing but the placeholder's id. Ids are not secrets - the
 * invite preview lists them without an account - so it let anybody walk into
 * every group a placeholder belonged to, including groups whose invite link had
 * been switched off. Claiming now happens only through
 * `POST /api/invite/[code]/join`, which requires a live code and merges the
 * placeholder into the person who just signed up (`server/merge.ts`).
 */

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
  if (!credential || credential.kind !== "recovery" || credential.person.deletedAt) {
    throw new NotFoundError("That recovery key doesn't match any account.");
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
): Promise<string> {
  const secret = generateSecret();
  // The cookie first: if it cannot be written (a render rather than a route)
  // nothing is left behind in the session table.
  await setIdentityCookie(personId, secret);
  const session = await prisma.session.create({
    data: { personId, secretHash: hashSecret(secret), label: label.slice(0, 80) },
  });
  // The secret's only destination is the httpOnly cookie set above; only the
  // row id comes back, so a live credential never reaches a response body.
  return session.id;
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
  return `${generateInviteCode()}-${generateInviteCode().split("-").pop()}`;
}

export async function uniquePersonalCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generatePersonalCode();
    const taken = await prisma.person.findUnique({ where: { inviteCode: code } });
    if (!taken) return code;
  }
  return `${generatePersonalCode()}-${generatePersonalCode().split("-").pop()}`;
}
