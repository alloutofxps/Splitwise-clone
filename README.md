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
to the device by a signed, httpOnly cookie. Group codes are three short words so
they survive being read across a dinner table, which means entropy is not what
protects them: every endpoint that resolves a code is rate-limited per address
instead (see `src/server/rate-limit.ts`, which is honest about what per-process
counters do and do not cover). The server stores only a SHA-256 of
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

| Variable       | Purpose                                                          |
| -------------- | ---------------------------------------------------------------- |
| `DATABASE_URL` | Defaults to `file:./dev.db`.                                      |
| `DIVVY_SECRET` | Signs identity cookies. **Required in production.** Generate with `openssl rand -hex 32`. |

---

## Deploying it

The app is a single Next.js server plus one SQLite file, so anything that can
run Node and keep a disk will host it.

**A box with a disk** (Fly.io, Railway, Render, a Raspberry Pi):

```bash
DIVVY_SECRET=$(openssl rand -hex 32) npm run build && npm start
```

Mount a volume at `prisma/` so the database survives restarts. Backing up the
app means copying one `.db` file — receipts are stored inside it.

**Vercel or another serverless host** needs Postgres, since the filesystem is
ephemeral. Change the datasource in `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

then point `DATABASE_URL` at a Postgres instance and run `npx prisma migrate
dev`. Nothing in the schema uses SQLite-only features — enums are strings and
structured payloads are JSON text — so it moves across unchanged.

**Recurring expenses** fire whenever anybody opens the app, so no scheduler is
required. If you would rather the rent posted at 08:00 than whenever someone
first checks, point a cron at `POST /api/recurrences/run`.

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
  106 unit tests, including
  randomised property checks that no split or apportionment ever loses a minor
  unit, that debt simplification always reproduces the same net position in at
  most n−1 transfers, and that folding one event at a time into a balance sheet
  gives the same answer as recomputing the history (which is what lets the
  client show a new expense's effect before the server confirms it).
- `scripts/smoke.mjs` — 118 assertions driving the real HTTP API: three people,
  every split mode, a placeholder claimed mid-trip, multi-currency conversion,
  replayed mutations, settling to zero, access control, paging a ledger whose
  rows all share one timestamp, and a backup export that reconciles and stays
  scoped to its owner.
- `scripts/pwa-check.mjs` — 32 assertions in a real browser against a
  production build, for the things that cannot be read off the source: that the
  worker actually intercepts an OS share and the composer picks the photo up,
  that a share arriving before onboarding is *not* consumed, that a new build
  parks in `waiting` and shows the update toast rather than reloading the page
  out from under a half-typed expense, and that the privacy curtain is opaque
  the instant its class is set.
- `scripts/shots.mjs` — captures every screen in both themes at a phone
  viewport, and reports any console or page error.

### Accessibility

Colour never carries meaning alone: every balance is stated in words ("you are
owed", "you owe") as well as colour and sign. The green/red pair is validated
for separation under simulated protanopia and deuteranopia, as are the chart
palettes, which have their own steps for dark mode rather than a flipped
version of the light ones. Every chart has a table view. Pinch-zoom is never
disabled, and inputs are ≥16px so iOS does not zoom on focus.
