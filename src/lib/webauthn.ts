/**
 * Passkeys, and the domain problem underneath them.
 *
 * A passkey is bound to a **Relying Party ID** — in practice a domain. The
 * browser enforces that binding, so a passkey created for
 * `divvy.up.railway.app` simply will not be offered on `divvy.example.com`.
 * Moving the app to a new address therefore breaks every passkey at once, and
 * because cookies are domain-scoped too, it breaks every session with them.
 *
 * That is not a reason to avoid passkeys. It is a reason to be deliberate
 * about three things:
 *
 * 1. **The RP ID is configuration, not a guess.** `DIVVY_RP_ID` pins it, so
 *    the identity of the app is a thing the operator chose rather than a side
 *    effect of whichever hostname a request happened to arrive on. Setting it
 *    to an apex domain (`example.com`) also covers every subdomain, which is
 *    the cheapest way to make a future move a non-event.
 *
 * 2. **Two addresses can share one RP ID.** `DIVVY_RELATED_ORIGINS` is served
 *    at `/.well-known/webauthn`, which lets a browser accept a passkey whose
 *    RP ID is the old domain while the user is on the new one. That is what
 *    turns a migration into an overlap rather than a cutover.
 *
 * 3. **Something must work when both of those fail.** The recovery key is
 *    checked against the database and knows nothing about domains, so it gets
 *    people in from anywhere the server is reachable. It stays for precisely
 *    this reason, and it is why passkeys are allowed to be the convenient path
 *    rather than the only one.
 *
 * Each credential also records the `rpId` it was made against, so the account
 * screen can say "these were created for another address" instead of leaving
 * somebody tapping a button that silently does nothing.
 */

import { headers } from "next/headers";

/** Strips port and any leading scheme; an RP ID is a bare domain. */
function bareHost(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();
}

/**
 * The Relying Party ID to register and verify passkeys against.
 *
 * Falls back to the request's own host when unset, which keeps local
 * development and a first deploy working with no configuration. That fallback
 * is safe — the browser refuses to let a page claim an RP ID that does not
 * cover its own origin, so a forged Host header buys an attacker nothing — but
 * it does mean the RP ID silently follows the hostname, which is the thing
 * that bites on a domain move. `DIVVY_RP_ID` is how you stop that.
 */
export async function rpId(): Promise<string> {
  const configured = process.env.DIVVY_RP_ID;
  if (configured) return bareHost(configured);
  const host = (await headers()).get("host") ?? "localhost";
  return bareHost(host);
}

/** Full origin, needed for verification and stricter than the RP ID. */
export async function expectedOrigin(): Promise<string[]> {
  const list = new Set<string>();

  const configured = process.env.DIVVY_ORIGIN;
  if (configured) list.add(configured.trim().replace(/\/$/, ""));

  const head = await headers();
  const host = head.get("host");
  if (host) {
    const proto = head.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    list.add(`${proto}://${host}`);
  }

  for (const origin of relatedOrigins()) list.add(origin);
  return [...list];
}

/**
 * Other addresses the same account may be reached at.
 *
 * Served at `/.well-known/webauthn` so a browser will honour a passkey whose
 * RP ID belongs to one of them. Set this to the *old* domain while migrating
 * to a new one, keep both pointing at the server until people have signed in
 * once, then drop it.
 */
export function relatedOrigins(): string[] {
  return (process.env.DIVVY_RELATED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/**
 * Whether a credential registered against `credentialRpId` can be used here.
 *
 * Used only to explain things to the user; the browser is what actually
 * enforces it.
 */
export function usableHere(credentialRpId: string | null, currentRpId: string): boolean {
  if (!credentialRpId) return true; // Pre-dates the column; assume it is fine.
  if (credentialRpId === currentRpId) return true;
  return relatedOrigins().some((origin) => bareHost(origin) === credentialRpId);
}

export const RP_NAME = "Divvy";
