# Divvy against OWASP ASVS level 2

The Application Security Verification Standard (version 4.0.3), level 2: what
an app holding people's money and personal data should meet. Reviewed on 28
October 2026 against main at `8db3459`, by reading the code and by evidence
from running it. Each line says **Met**, **Gap** (with what is missing), or
**N/A** (with why).

Divvy has no passwords and no email addresses. You are a person with a
random 256-bit secret: a passkey, a recovery key, or a sign-in on a device.
That makes most of chapter 2 (passwords, password reset, one-time codes by
SMS or email) not applicable, and changes what "session" means in chapter 3.

Evidence referred to below:

- **Permission table**: `scripts/permissions.mjs`, 37 actions tried as six
  kinds of person, every answer as expected. Runs in CI.
- **Bad-input test**: `scripts/fuzz-routes.mjs`, 30,406 calls to all 68
  route methods; one 500 found and fixed (#119), nothing internal leaked,
  nothing slow.
- **Smoke test**: `scripts/smoke.mjs`, 225 end-to-end checks. Runs in CI.
- **Live headers**: read from https://divvy.up.railway.app on 28 October.

## V1 Architecture

| Item | Status | Evidence |
|---|---|---|
| 1.1 Secure development: threats and rules written down | Met | `RULES.md` (checkable rules by harm), audits `PRODUCTION-AUDIT.md`, this file |
| 1.2 Every route authenticated unless meant to be public | Met | Every route calls `requireSession()` except health, invite preview, sign-up, sign-in and restore; permission table checks signed-out gets 401 |
| 1.4 Access control enforced on the server, in one place | Met | `src/server/access.ts`; permission table |
| 1.5 Input validated on the server, with one schema per route | Met | zod schemas through `readBody`; bad-input test |
| 1.6 Secrets kept out of the code | Met | `DIVVY_SECRET`, VAPID and Litestream keys live in Railway variables only |
| 1.7 Errors and logs in one structured format | Met | `src/lib/log.ts`, one JSON line each |
| 1.8 Data classified | Met | Money, names and payment handles are personal; receipts may be. The privacy page lists them (gaps under V8) |
| 1.14 The build is repeatable and its parts pinned | Met | `package-lock.json`, `npm ci`, the Docker image built in CI (`image` job) |

## V2 Authentication

| Item | Status | Evidence |
|---|---|---|
| 2.1 Passwords | N/A | There are none |
| 2.2 General: limits on guessing | Met | Sign-up 10 an hour per address, restore 20 an hour, passkey sign-in 20 per 5 minutes, device-link claims 20 per 10 minutes; limits read the real address, not a forged `X-Forwarded-For` (smoke C3) |
| 2.2.3 Tell the person about new sign-ins | Met | Since #123: a recovery key, passkey or device link signing a new device in sends "Divvy was opened on a new device" to the person's other devices with notifications on (`notifyNewDevice`, `src/server/push.ts`) |
| 2.3 Authenticator lifecycle | Met | Recovery key shown once, stored only as a SHA-256 hash (`src/lib/codes.ts`); can be replaced; can't remove your last way in |
| 2.4 Stored secrets | Met | Every secret is 256 random bits; only hashes are stored, and with that much randomness a plain SHA-256 is the standard choice (no salt or slow hash needed) |
| 2.5 Recovery | Met | Recovery key or a link from another signed-in device; the link code lasts 5 minutes and is single use |
| 2.7, 2.8 One-time codes | N/A | None by SMS or email |
| 2.9 Cryptographic devices (passkeys) | Met | `@simplewebauthn/server`, checks the expected origin and site id on every sign-in |

## V3 Sessions

| Item | Status | Evidence |
|---|---|---|
| 3.1 Session token never in the URL | Met | Cookie only |
| 3.2 New token at sign-in; 256 bits | Met | Each sign-in makes a new `Session` row with a new random secret (`startSession`) |
| 3.3.1 Signing out ends the session on the server | Met | `DELETE /api/identity` deletes the row; the phone's notification subscription goes with it (cascade) |
| 3.3.2 A limit on how long a session lasts | **Deviation, chosen by the owner** | Sessions end after 180 days unused, with no absolute limit. Level 2 wants re-authentication at least every 30 days for long sessions; the owner chose on 28 October 2026 not to ask monthly, since people without a passkey would have to type a long recovery key each time. Sensitive actions ask instead (3.6), new sign-ins are announced (2.2.3), and any device can be signed out (3.3.3) |
| 3.3.3 Sign out everywhere | Met | "Your devices" lists every signed-in device and removes any one |
| 3.4 Cookie flags | Met | `HttpOnly`, `Secure` in production, `SameSite=Lax`, path `/` (`src/lib/identity.ts`) |
| 3.5 Tokens for APIs | Met | The same cookie; the cron entry point takes a separate secret compared in constant time |
| 3.6 Re-authentication for sensitive actions | Met | Since the confirm-before-delete PR, deleting the account needs the account's own passkey (checked as at sign-in, `src/server/passkey.ts`) or recovery key, with a limit on tries; smoke checks no proof, a wrong key and another account's key are all refused. Adding a payment handle doesn't: it can't move money, and the person sees it on their own You screen |
| 3.7 Defences against stolen sessions | Met in part | Sessions are revocable per device and listed with last use; no binding to device |

## V4 Access control

| Item | Status | Evidence |
|---|---|---|
| 4.1 Enforced on the server, denied by default | Met | Every row is loaded through an access check; permission table |
| 4.2 No reaching other people's rows by changing an id | Met | Permission table (outsiders get 403 or 404 with none of the group's words); bad-input test with junk ids; nobody can remove someone else's payment details (checked) |
| 4.2.2 Protection against cross-site requests | Met | `SameSite=Lax` stops another site's form or script sending the cookie; `up.railway.app` is on the Public Suffix List, so other apps hosted there count as other sites. No state changes on GET. (A check of the `Origin` header would add a second wall; worth adding if Divvy moves to a domain with other sites under it) |
| 4.3 Admin interfaces | N/A | There are none; the owner uses Railway |

## V5 Validation and output

| Item | Status | Evidence |
|---|---|---|
| 5.1 Input validated by schema, by type, with limits | Met | zod on every body; 64 KB body limit (expenses with receipts more); bad-input test |
| 5.1.4 Amounts can't overflow | Met | Minor units as BigInt with `MAX_MINOR_UNITS`; money checked against a simple calculator for 1.3 million cases |
| 5.2 HTML and other output sanitised | Met | React escapes everything; the two raw-HTML spots are a fixed start-up script (with the page's nonce) and a QR code drawn by the app itself |
| 5.2.5 Spreadsheet formulas in exports | Met | Text starting `=`, `+`, `-`, `@` gets an apostrophe; plain numbers are left as numbers (#117) |
| 5.3 Encoding for the place output lands | Met | No string-built SQL from input: the raw queries are fixed text (health, pragmas, the daily check, the snapshot path made by the server) |
| 5.5 Deserialisation | Met | JSON only; `__proto__` in bodies tried by the bad-input test with no effect |

## V7 Errors and logging

| Item | Status | Evidence |
|---|---|---|
| 7.1 No secrets or personal data in logs | Met | Logs carry ids, codes and counts; phone crash reports drop the query string; the live log read on 28 October showed none |
| 7.2 Security events logged | Met in part | Errors, refusals by the database, rate limits; sign-ins are not logged as events |
| 7.3 Logs protected | Met | Railway's log store, owner only |
| 7.4 Errors don't reveal internals | Met | Every unexpected error answers "Something went wrong on our side. Your data is safe." (bad-input test: no stack traces, paths or database messages in 30,406 answers) |
| Alerting | Met | The health check fails on server errors, stalled jobs, crashes on phones and the daily database check; UptimeRobot emails the owner (#113, #121) |

## V8 Data protection

| Item | Status | Evidence |
|---|---|---|
| 8.1 Sensitive data not cached where it shouldn't be | Met | API answers aren't cached by shared caches; signing out empties the phone's own cache (ui-check "Signing out leaves nothing behind") |
| 8.2 Client-side storage | Met | The offline queue holds only the person's own pending changes, cleared on sign-out |
| 8.3.1 Personal data in URLs | Met | None |
| 8.3.2 People can see and delete their data | Met | A full JSON export; deleting the account removes sign-ins, devices, payment details, budgets and friendships and renames the person "Deleted user" |
| 8.3.4 What is kept, and for how long, is written down | **Gap** | The privacy page doesn't mention the off-site backup copies or how long deleted data stays in them, or phone notifications (finding 15) |
| 8.3.7 Data encrypted at rest | Met in part | The database is on Railway's disk and the backups in Cloudflare R2, both encrypted by the provider; not encrypted by the app |

## V9 Communications

| Item | Status | Evidence |
|---|---|---|
| 9.1 HTTPS everywhere, with HSTS | Met | `Strict-Transport-Security: max-age=63072000; includeSubDomains`; `upgrade-insecure-requests` in the content policy |
| 9.2 Server-to-server over TLS | Met | Rates services, push services and R2 are all `https` |

## V10 Malicious code

| Item | Status | Evidence |
|---|---|---|
| 10.3 Dependencies checked | Met | `npm audit --omit=dev --audit-level=high` fails CI; Prisma and its adapter pinned to one exact version |
| 10.3.2 Install scripts | **Gap (coming)** | npm warns that five packages' install scripts will need explicit permission (finding 18) |

## V12 Files

| Item | Status | Evidence |
|---|---|---|
| 12.1 Size and count limits | Met | 4 MB a receipt, a fixed number per expense; body limits |
| 12.2 Type checked by content, not by name | Met | The first bytes must match the claimed type (JPEG, PNG, WebP, HEIC, PDF) (`src/server/write.ts`) |
| 12.4 Stored outside the web root, served safely | Met | Bytes in the database; served with `nosniff`, a `sandbox` content policy and `attachment` for anything that isn't an image |
| 12.5 Download access checked | Met | Permission table: receipts readable by the group, or the two people on a direct expense, only |

## V13 API

| Item | Status | Evidence |
|---|---|---|
| 13.1 Consistent error format, correct status codes | Met | 401, 403, 404, 409, 413, 422, 429, 503 used as meant (`src/lib/api.ts`) |
| 13.2 Content type checked | Met | JSON bodies parsed through `readBody`; anything unparseable is a 422 |

## V14 Configuration

| Item | Status | Evidence |
|---|---|---|
| 14.1 The build is reproducible and hardened | Met | Docker image from `npm ci --omit=dev`, runs as the `node` user, Litestream checked against a SHA-256 |
| 14.2 Dependencies up to date | Met | CI audit; Next.js and Prisma kept current |
| 14.3 No debug output in production | Met | Production build; errors generic |
| 14.4 Security headers | Met | Content policy with nonces and `strict-dynamic`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin` |
| 14.5 Request headers trusted only from the proxy | Met | `X-Forwarded-For` read right to left, only as many hops as `DIVVY_TRUSTED_PROXIES` |

## The gaps

1. **3.3.2 Absolute session limit.** A deliberate deviation, the owner's
   choice on 28 October 2026 (see the line above).
2. **8.3.4 Retention written down.** The privacy page (finding 15).
3. **10.3.2 Install scripts.** The npm change (finding 18).
4. **4.2.2 `Origin` check.** Not needed today; a second wall.

Closed on 28 October: 2.2.3 (new-device notice, #123) and 3.6 (confirm
before deleting the account).
