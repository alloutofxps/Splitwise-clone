# Divvy

Shared expense tracking for friends, housemates and travel companions. Every
feature is free — receipts, itemised bills, multiple currencies, charts,
exports, recurring expenses, debt simplification. There is no paid tier, because
there is nothing to pay for.

There are also **no accounts**. No email, no password, no verification link. You
open the app, type your name, and share an invite code.

---

## Why it works this way

Three decisions shape everything else.

**Invite codes instead of login.** A person is created on first launch and bound
to the device by a signed, httpOnly cookie. Group codes are short words so they
survive being read across a dinner table, plus a four-character random tail
(`mango-tiger-42-k7fq`) so they cannot be guessed; personal codes carry a
six-character one. Every endpoint that resolves a code is also rate-limited, by
the address the proxy saw and by account (`src/server/rate-limit.ts`). The
server stores only a SHA-256 of
the secret; the raw value is shown once as a *recovery key*, which is the only
way to restore the same identity on another device. The tradeoff is explicit:
whoever holds the recovery key is that person. That is the security model of a
house key, and it is the right one for four friends splitting a holiday.

**Placeholder members.** You can add "Sam" to a group before Sam has installed
anything, and Sam's share starts accruing immediately. When Sam finally opens
the invite link, they tap their own name and the placeholder is *merged* into
their real identity — every expense, split and settlement already filed against
it comes with them. Without this, the first evening of a trip cannot be recorded
until the whole group has been onboarded, which is where most expense apps lose
people.

**Divvy never moves money.** Settling up records that a payment happened and
offers a deep link into the payee's own banking app (UPI, PayPal.me, Venmo,
Monzo, Revolut, Cash App) with the amount pre-filled. No payment rail means no
processor fees, no KYC, no financial regulation — and therefore nothing to
charge for.

---

## Feature list

Everything below is included. Items marked ★ are paid features in the app this
is modelled on.

**Splitting** — equally · exact amounts · percentages · shares · "split evenly
plus extras" · ★ itemised receipts, where tax and tip are apportioned by what
each person actually ordered.

**Money** — 55 currencies with correct minor units (including 0-decimal JPY and
3-decimal KWD) · ★ live exchange rates with an offline cache and manual
override · multiple payers per expense.

**Groups** — trips, homes, couples, events · invite codes that can be rotated or
switched off · debt simplification (min-cash-flow) as a per-group toggle ·
archiving.

**Records** — ★ receipt photos and PDFs, downscaled in the browser before
upload (and removable) · comments · full activity feed, bucketed by day and
filterable by group · ★ search across every group, plus per-person and
per-category filtering inside one · ★ CSV export · recurring expenses that post
themselves, dated correctly, and catch up on months nobody opened the app.

**Reminders** — ★ nudge somebody who owes you, once a day, and only about a debt
the ledger actually shows. It arrives in their activity feed rather than by
email or push: there are no email addresses in the schema, and web push needs a
deployed origin and a VAPID keypair that a self-hosted app cannot assume.

**Reporting** — ★ spending by month, by category and by person, with a table
view of the same numbers · ★ budgets, scoped to a group and/or a category, and
counted against *your share* rather than the group's total.

**Everywhere** — installable PWA for iOS and Android · works offline, including
adding expenses · share a receipt straight from the camera roll into a new
expense · a home-screen shortcut into the composer, and a badge showing what
happened while you were away · a built-in amount keypad, so the split preview is
never hidden behind the system keyboard · light and dark themes · no ads, no
tracking, no analytics.

**Your data** — ★ CSV export per group, for a spreadsheet · a whole-account JSON
backup, with every amount as text so nothing is rounded · a privacy curtain that
covers the screen when you switch apps, so balances stay out of the app
switcher.

---

## Running it

Requires Node 20+.

```bash
npm install
npx prisma migrate deploy     # creates prisma/dev.db
npm run db:seed               # optional: demo group with realistic data
npm run dev                   # http://localhost:3000
```

The seed prints a recovery key. Paste it into *"I already have a recovery key"*
to sign in as the demo user.

```bash
npm test                      # unit tests for the money and split engines
npm run typecheck
npm run lint
node scripts/smoke.mjs        # end-to-end API test against a running server
```

Lint runs clean of errors. The warnings it does report are all
`react-hooks/set-state-in-effect`, and `eslint.config.mjs` explains site by site
why each is deliberate rather than pending.

### Configuration

| Variable                 | Purpose                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `DATABASE_URL`           | Defaults to `file:./dev.db`.                                      |
| `DIVVY_SECRET`           | Signs identity cookies. **Required in production.** Generate with `openssl rand -hex 32`. |
| `DIVVY_RP_ID`            | Domain that passkeys belong to. Defaults to the request's host. Set it deliberately — see below. |
| `DIVVY_ORIGIN`           | Full origin, e.g. `https://divvy.example.com`. Only needed behind a proxy that rewrites the host. |
| `DIVVY_RELATED_ORIGINS`  | Comma-separated other origins whose passkeys are still honoured. Used while moving domains. |
| `DIVVY_TRUSTED_PROXIES`  | Proxies in front of the app that append to `X-Forwarded-For`. Default `1` (Railway, Fly, Render, one nginx). `0` with no proxy, which turns per-address rate limits off. |
| `DIVVY_CRON_SECRET`      | Bearer token for an external cron calling `POST /api/recurrences/run`. Optional — the server runs its own scheduler. |
| `LITESTREAM_REPLICA_URL` | Docker image only: stream every database change to S3-compatible storage, and restore from it onto an empty volume. Credentials via `LITESTREAM_ACCESS_KEY_ID` / `LITESTREAM_SECRET_ACCESS_KEY`. |
| `DIVVY_BACKUP_DIR`       | Where daily and pre-migration snapshots go. Defaults to `backups/` next to the database. |
| `DIVVY_ALERT_WEBHOOK`    | URL that receives every logged error (Slack/Discord-compatible), at most once a minute. |
| `DIVVY_CONTACT` | Who runs this server, shown on `/privacy`. Read at request time, so changing it needs no rebuild. |
| `DIVVY_DISABLE_JOBS`     | `1` to serve requests without running the background scheduler. |

### Signing in, and what happens when the domain changes

There are three ways into an account, and they exist in that order on purpose:

- **A passkey** — Face ID or a fingerprint, one per device. Platform keychains
  sync these, so a replaced phone signed into the same Apple or Google account
  already has it.
- **A device link** — a QR code shown on a signed-in device and scanned by the
  new one. Works in seconds, lasts five minutes, and can be used once.
- **A recovery key** — a long string shown at sign-up. It works from anywhere
  and knows nothing about domains, which is what makes it the backstop.

A passkey is bound to a domain. Change the app's address and every passkey
stops being offered, and because cookies are domain-scoped too, every session
ends with them. That is a property of WebAuthn, not something an app can opt
out of, so plan for it:

**Set `DIVVY_RP_ID` before anyone registers a passkey.** Point it at the domain
you intend to keep. An apex domain (`example.com`) covers every subdomain under
it, which makes a later move from `app.example.com` to `divvy.example.com` a
non-event.

**To move to a genuinely different domain:**

1. Keep the old domain resolving to the server.
2. Set `DIVVY_RELATED_ORIGINS=https://old.example.com` on the new one. It is
   served at `/.well-known/webauthn`, and browsers that support Related Origin
   Requests will go on honouring the old passkeys.
3. Leave `DIVVY_RP_ID` on the old value until everyone has signed in at the new
   address at least once and added a passkey there.
4. Then switch `DIVVY_RP_ID`, drop `DIVVY_RELATED_ORIGINS`, and let people
   remove the stale passkeys their account screen is already flagging.

Anyone who falls through that — an unsupported browser, a domain that lapsed —
signs in with their recovery key and adds a passkey again. Nobody is stranded,
which is the reason the recovery key was kept rather than replaced.

---

## Deploying it

The app is a single Next.js server plus one SQLite file, so anything that can
run a container and keep a disk will host it.

**How far one server goes.** SQLite allows one writer at a time, so the app
queues writes through a single connection in WAL mode instead of letting them
collide (`src/lib/db.ts`). Measured on a laptop: 200 people saving at the same
instant all succeed in under a second, and 1,000 simultaneous saves or
home-screen loads produce no server errors. That is far beyond what a few
thousand active users generate. Past that, or to run more than one server, move
to Postgres (below) and a shared rate limiter.

### With the Dockerfile

```bash
docker build --build-arg BUILD_ID=$(git rev-parse --short=12 HEAD) -t divvy .
docker run -p 3000:3000 \
  -e DIVVY_SECRET=$(openssl rand -hex 32) \
  -e DIVVY_RP_ID=divvy.example.com \
  -v divvy-data:/data \
  divvy
```

Three things the image does that a plain `next start` does not, each for a
reason worth knowing:

- **Migrations run at boot, not at build.** The database lives on the volume,
  which does not exist while the image is being made. `migrate deploy` is a
  no-op when nothing is pending, so a redeploy that adds a migration applies it
  without anybody remembering a release step.
- **The volume mounts at `/data`, not at `prisma/`.** Mounting over `prisma/`
  would hide the migration files the entrypoint needs to read.
- **`BUILD_ID` is a real build argument.** The service worker names its caches
  after it and registers as `/sw.js?v=<id>`. Without it the build falls back to
  the package version, which never changes — so an installed PWA would go on
  serving the previous shell after every deploy. Pass the platform's own commit
  variable: `RAILWAY_GIT_COMMIT_SHA` on Railway, `FLY_MACHINE_VERSION` on Fly,
  `GITHUB_SHA` in Actions. Omitting it is not fatal — the image falls back to a
  build timestamp, so each build still differs — but a commit sha makes the id
  mean something.

The entrypoint refuses to start without a `DIVVY_SECRET` of at least sixteen
characters. That check exists because the alternative is worse: the app boots,
serves a page, and 500s the moment somebody signs in.

**Backups.** Receipts are stored inside the database, so the database is the
whole app. Three layers protect it:

- a snapshot before every migration (`/data/backups/pre-migrate-*.db`, newest
  five kept);
- a daily consistent snapshot taken with `VACUUM INTO`, newest seven kept;
- with `LITESTREAM_REPLICA_URL` set, continuous replication of every change to
  object storage, restored automatically onto an empty volume. **Set this in
  production** — the first two live on the same disk as the database, and
  only this one survives losing it.

**Health.** `GET /api/health` answers 200 only when the database answers too.
`railway.json` points Railway's health check at it.

**Logs.** One JSON object per line, each request tagged with an
`X-Request-Id`. Set `DIVVY_ALERT_WEBHOOK` to be told about errors.

The container starts as root only to hand `/data` to the `node` user, then
runs the app as `node`.

### Without Docker

```bash
DIVVY_SECRET=$(openssl rand -hex 32) npm run build && npm start
```

`npm run build` applies migrations as well as building, which is what makes it
work on a host with a persistent disk. Keep `prisma/` on that disk.

### On a serverless host

Vercel and friends need Postgres, since the filesystem is ephemeral. Change the
datasource in `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

then point `DATABASE_URL` at a Postgres instance and run `npx prisma migrate
dev`. Nothing in the schema uses SQLite-only features — enums are strings and
structured payloads are JSON text — so it moves across unchanged.

### Recurring expenses

The server posts them itself: a scheduler started with the server
(`src/server/jobs.ts`) runs every minute, holding a lease in the database so
two processes never run it at once. Each occurrence is dated when it was due,
in the creator's own time zone. A recurrence pauses itself — and says why in
the group — if somebody in it leaves or its currency no longer matches the
group's; a momentary error is simply retried. An external cron can also call
`POST /api/recurrences/run` with `Authorization: Bearer $DIVVY_CRON_SECRET`.

The same scheduler refreshes exchange rates every six hours, clears expired
sign-in codes and abandoned sessions hourly, and writes a daily database
snapshot.

---

## How it is built

```
src/lib/          money, split algorithms, balance engine — no framework, fully tested
src/server/       read/write services, access control, recurrence, pagination
src/app/api/      34 route handlers
src/components/   design system and feature UI
prisma/           schema, migrations, seed
scripts/          smoke.mjs (end-to-end), pwa-check.mjs (browser), shots.mjs (visual)
```

Three things in here are worth knowing about before changing anything.

**Money is never a float.** Every amount is an integer count of a currency's
minor unit, held as `bigint`, and crosses the wire as a decimal *string* —
JSON numbers are float64 and a large rupee balance would round on the way out.
`src/lib/money.ts` has the parsing and formatting; it is where the awkward cases
live (is `1.234` twelve hundred, or one point two?).

**Splits are exactly conservative.** Every mode resolves through
largest-remainder apportionment so the parts always sum to the total, to the
minor unit. Leftover units go to whoever paid — they are already out of pocket,
so absorbing a stray cent is both fairest and easiest to explain. The API
rejects any expense whose payers or splits do not add up, because a row that
violates that would quietly corrupt every balance the group ever sees.

**Offline replay is idempotent by construction.** The client generates each
row's id before sending, so a mutation replayed from the IndexedDB outbox
collides on the primary key and the server returns the existing row instead of
filing the dinner twice. This is why ids come from the client and not the
database — and it is also what lets a new expense appear on screen before the
server has seen it, since the optimistic row and the confirmed row are the same
row. A mutation the server refuses outright cannot stay in the queue (it would
block everything behind it), so it moves to a dead-letter store and is shown in
the offline banner with the server's reason, rather than disappearing.

**Feeds page on (timestamp, id), never on the timestamp alone.** Several
expenses entered on the same evening share a date to the millisecond, and a
cursor of "everything strictly older than the last row" drops the ones that
straddle a page boundary — off page one because they were trimmed, off page two
because they are not strictly older. Because balances are derived from the rows
rather than from the feed, the arithmetic stays right while the history quietly
loses a payment. `src/server/cursor.ts` carries the tiebreak, and the smoke test
pages a group whose rows all share one timestamp.

### Platform capabilities, and the two that were left out

The OS hooks this app uses are the ones an expense splitter actually has a use
for. Each is feature-detected and each degrades to exactly what the app did
before it existed.

**The share target** is the most useful of them. A receipt photographed by the
banking app, or a bill emailed as a PDF, can be shared straight into a new
expense. It cannot be done in a page alone: the OS performs a real `POST`
navigation, and a page cannot read the body of the navigation that created it.
So the service worker intercepts the POST, parks the files in a cache, and
redirects to a plain GET that the app boots from and collects them on
(`public/sw.js` and `src/lib/client/share-target.ts`). The handshake is
one-shot — read and delete in the same call — so a refresh cannot attach the
same receipt twice, and it is not read at all until there is an identity,
because consuming it to open a composer that a brand-new device cannot yet show
would destroy the photo.

**Persistent storage** is requested on every launch. The offline outbox holds
writes that exist nowhere else until the network returns, so eviction under
storage pressure is silent loss of something the user typed and watched appear.
Chrome grants it only after an engagement bar that a first-run visitor has not
cleared, which is why it is asked repeatedly rather than once.

**Updates are offered, never taken.** A new worker parks in `waiting` and the
app shows a toast; the reload happens when the user accepts it. The worker
deliberately does *not* call `skipWaiting()` during install — doing so replaces
the running app mid-expense and, because the client reloads on
`controllerchange`, throws that entry away. Cache names carry the build id,
read by the worker out of its own `?v=` query, so an API response shaped by
last week's code cannot outlive it.

**The badge** shows unread activity from the last time the app was open, and
nothing time-critical is put on it, because that is the only guarantee an app
with no push infrastructure can honestly make.

Two capabilities were considered and rejected.

**The Contacts Picker** would import a name the user can already type. Divvy
stores no phone numbers or email addresses at all — identity *is* an invite
code — so there is nothing for a contact record to match against, and the API
is Chromium-on-Android only.

**A biometric or PIN lock** was rejected because it would advertise a
protection this architecture does not provide. A purely local gate cannot
defend data that stays readable in IndexedDB, behind an identity cookie, to
anyone holding the unlocked device; and a forgotten PIN would lock someone out
of an app whose entire premise is that there is no login. What the threat
actually justifies — keeping balances out of the app switcher and off the
shoulder next to you — is the privacy curtain in
`src/components/privacy-screen.tsx`, which is described to the user as a
curtain rather than a lock.

### Verification

- `src/lib/__tests__/`, `src/lib/client/__tests__/` and `src/server/__tests__/` —
  265 unit tests, including
  randomised property checks that no split or apportionment ever loses a minor
  unit, that debt simplification always reproduces the same net position in at
  most n−1 transfers, and that folding one event at a time into a balance sheet
  gives the same answer as recomputing the history (which is what lets the
  client show a new expense's effect before the server confirms it).
- `scripts/smoke.mjs` — 217 assertions driving the real HTTP API: three people,
  every split mode, a placeholder claimed mid-trip, multi-currency conversion,
  replayed mutations, settling to zero, access control, paging a ledger whose
  rows all share one timestamp, and a backup export that reconciles and stays
  scoped to its owner. A final section turns every finding of the production
  audit (`PRODUCTION-AUDIT.md`) into an assertion: cross-customer search and
  id-reuse leaks, the invite-link bypass, forged proxy headers, recurring
  expenses in the wrong currency or back-dated, oversized bodies, fake
  payments, account deletion, health and security headers.
- `scripts/pwa-check.mjs` — 36 assertions in a real browser against a
  production build, for the things that cannot be read off the source: that the
  worker actually intercepts an OS share and the composer picks the photo up,
  that a share arriving before onboarding is *not* consumed, that a new build
  parks in `waiting` and shows the update toast rather than reloading the page
  out from under a half-typed expense, and that the privacy curtain is opaque
  the instant its class is set.
- `src/__tests__/route-wiring.test.ts` — asserts every route handler is called
  by the app, per method. Eight features in this codebase were finished
  server-side and never wired to anything, and nothing in the toolchain
  noticed: types are fine, lint is fine, and the API tests actively hid it —
  the settlement delete route passed every server assertion while the row that
  should have called it was a plain `div`.
- `scripts/ui-check.mjs` — 81 assertions asking whether the control on screen is
  actually wired to the thing it claims to do. Both regressions it pins looked
  healthy from the outside: the settlement row rendered and the scope picker
  returned 200, and both were inert. It also checks that splitting by item keeps
  the receipt lines and that signing out clears every cached response.

CI runs all of these on every push, plus `npm audit` (high and critical fail
the build), and boots the Docker image against an empty volume. To run the
browser checks against an installed Chrome or Edge instead of Playwright's own,
set `CHROMIUM_PATH`.
- `scripts/shots.mjs` — captures every screen in both themes at a phone
  viewport, and reports any console or page error.

### Accessibility

Colour never carries meaning alone: every balance is stated in words ("you are
owed", "you owe") as well as colour and sign. The green/red pair is validated
for separation under simulated protanopia and deuteranopia, as are the chart
palettes, which have their own steps for dark mode rather than a flipped
version of the light ones. Every chart has a table view. Pinch-zoom is never
disabled, and inputs are ≥16px so iOS does not zoom on focus.
