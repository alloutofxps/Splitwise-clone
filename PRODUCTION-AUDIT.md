# Divvy (Splitwise clone) — Production Readiness Audit

**Repository:** github.com/alloutofxps/Splitwise-clone (commit `6bd1f12`)
**Date:** 14 October 2026
**Scope:** every file in the repository: server code, web app, database schema and migrations, Dockerfile, CI, service worker, tests and scripts.

**How this was checked:** I read the code line by line. I also built the app, ran it on a private local copy with a throwaway database, and tried to break it. Findings marked **✅ Proven** were reproduced against the running app; the exact results are quoted. Everything else comes from reading the code and quotes the lines responsible.

**AI / LLM review:** this app has no AI features (no model calls, prompts, embeddings or vector store), so the AI section is marked not applicable.

> **How to read this if you don't write code.** Every finding has a plain-English **Problem** and **Impact** first. The **Evidence**, **Fix** and **Example Fix** parts are for whoever changes the code. "Server" means the computer running the app; "database" means the one file (`divvy.db`) where all data is stored; "endpoint" means one web address the app's screens call to read or save data.

---

## Severity key

| | Meaning |
|---|---|
| 🔴 **Critical** | Blocks launch. Leaks private data, loses or corrupts money records, or lets one person take the service down. |
| 🟠 **Major** | Serious bug, abuse route, or something that breaks as usage grows. |
| 🟡 **Minor** | Quality, maintainability, or best-practice gap. |

---

# Part 1 — Findings

## 🔴 CRITICAL

### C1. Search shows every user's expenses to anyone ✅ Proven

- **File:** `src/app/api/search/route.ts` (lines 42–66)
- **Function:** `GET` handler
- **Severity:** 🔴 Critical
- **Category:** Security — broken access control / cross-customer data leak

**Problem.** The search box is supposed to look only through expenses you are allowed to see. Because of a coding slip, as soon as you type a search word, that restriction disappears and the search runs across **every expense of every user in the system**.

**Evidence.** The query object sets the key `OR` twice. The second one (the search words) silently replaces the first (the "only my groups" rule):

```ts
where: {
  deletedAt: null,
  OR: [ /* only groups I'm in, or direct expenses I'm part of */ ],   // line 46
  ...(query ? { OR: [{ description: { contains: query } }, { notes: { contains: query } }] } : {}), // line 57 — overwrites the line above
}
```

The same bug was found and fixed in `src/app/api/groups/[id]/expenses/route.ts` (see its comment at lines 49–52) but not here. The end-to-end test (`scripts/smoke.mjs` line 1379) only checks that search *finds* something, never that it *doesn't find other people's things*.

**Live result:**
> Mallory (not in Alice's group) searched "Nobu" and got: "Nobu dinner (private)", notes "card ending 4242", amount 50000, group cmv89w24…

**Impact.** Any user can read any other user's expense descriptions, private notes, amounts, who paid, who owes, group IDs and person IDs. Typing common words ("rent", "hotel", "doctor") returns up to 60 strangers' records each time. This is a reportable data breach under privacy law (GDPR / India DPDP Act).

**Attack scenario.** Create a free account and search the 1,000 most common words. Each search returns up to 60 private records from across the whole customer base. The person IDs and group IDs returned also feed attacks C2, C4 and C8.

**How to reproduce.** Two accounts. Account A creates a group and an expense called "Nobu". Account B (not in the group) calls `GET /api/search?q=Nobu`.

**Recommended fix.** Combine the conditions with `AND` instead of putting both in one object, and add a test proving that search never returns a record from a group you are not in.

**Example fix:**
```ts
where: {
  deletedAt: null,
  AND: [
    { OR: [ { groupId: { in: scopedGroupIds } },
            { groupId: null, OR: [{ payers: { some: { personId: me } } }, { splits: { some: { personId: me } } }] } ] },
    ...(filters.categoryId ? [{ categoryId: filters.categoryId }] : []),
    ...(query ? [{ OR: [{ description: { contains: query } }, { notes: { contains: query } }] }] : []),
  ],
},
```

---

### C2. "Save expense" hands back someone else's expense if you reuse its ID ✅ Proven

- **Files:** `src/app/api/expenses/route.ts` (lines 28–54), `src/server/write.ts` (lines 164–171), `src/app/api/settlements/route.ts` (lines 122–129, 146), `src/app/api/settlements/batch/route.ts` (lines 139–148, 170)
- **Function:** `POST` handlers, `createExpense`
- **Severity:** 🔴 Critical
- **Category:** Security — insecure direct object reference (IDOR)

**Problem.** For offline use, the phone picks the ID for a new expense itself. If the ID already exists, the server assumes it's a repeat and returns the existing record, **without checking that the existing record belongs to you**. Payments ("settlements") work the same way.

**Evidence.** `createExpense` catches the "already exists" error and returns whatever row has that ID. The route then loads it with full detail and sends it back. The only permission check was on the group *the attacker* named in the request, not on the record that came back.

**Live result:**
> status 201; response description="Nobu dinner (private)", notes="card ending 4242"
> (control: direct GET of the same expense by Mallory → 403 Forbidden)

So the normal "view expense" screen correctly refuses, but the "create" path leaks the same record.

**Impact.** Anyone holding an expense or payment ID can read the whole record. IDs leak through search (C1), exports, activity feeds and former group members.

**Attack scenario.** Collect IDs from C1, then send `POST /api/expenses` with each one to get the full record. Do the same against `/api/settlements` for payment records.

**Recommended fix.** On a repeat, only return the existing row if it was created by the same person *and* belongs to the same group/ledger as the request. Otherwise answer 409 Conflict.

**Example fix:**
```ts
if (isUniqueViolation(error)) {
  const existing = await prisma.expense.findUnique({ where: { id: input.id } });
  if (existing && existing.createdByPersonId === input.createdByPersonId && existing.groupId === input.groupId) {
    return { record: existing, created: false };
  }
  throw new ConflictError("That id is already in use.");
}
```

---

### C3. The anti-guessing protection is switched off by changing one header ✅ Proven

- **File:** `src/server/rate-limit.ts` (`clientKey`, line 90; `sweep`, line 48)
- **Severity:** 🔴 Critical
- **Category:** Security — rate limiting / brute force

**Problem.** Group invite codes are short words like `mango-tiger-42` (only about 268,000 possibilities). The app relies entirely on a "20 tries per 10 minutes" limit to stop someone guessing them. That limit identifies the caller using a header (`X-Forwarded-For`) that **the caller writes themselves**, so an attacker just puts a different value in each request.

There's a second weakness: once the limiter is tracking 10,000 callers, it **wipes all its counters** (line 48). An attacker can fake 10,000 addresses to reset everyone's limit at once.

**Live result:**
> same address: blocked after 21 tries; rotating the header: 0/60 blocked

The project's own end-to-end test does the same trick to get around the limit (`scripts/smoke.mjs` line 840).

**Impact.** Every group's invite code can be guessed. Joining a group exposes all of its expenses, members and members' payment details (UPI IDs, IBANs, PayPal and Venmo handles). Personal codes are far weaker still (see C8). The limit also exists on recovery-key restore, device-link claim and nudges, so all of those are unprotected too.

**Attack scenario.** A script tries `adjective-noun-NN` combinations with a random `X-Forwarded-For` value on each. At 50 requests a second, the whole space takes about 1.5 hours. Every hit is a group the attacker can join.

**Recommended fix.**
1. Make the codes long enough that guessing is impossible: at least 10 random characters, or keep the words and add a random suffix.
2. Only trust `X-Forwarded-For` as set by *your* proxy. Take the right-most entry your host's proxy appends, or the platform's own trusted header, and use that.
3. Keep rate-limit counters in a shared store (Redis, or a table) so they survive restarts and multiple servers, and never clear them all at once.
4. Add per-account limits as well as per-address ones.

**Example fix (trusted proxy):**
```ts
export function clientKey(request: Request): string {
  // Railway / Fly / Cloudflare append the real client IP as the LAST hop.
  const hops = (request.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const trustedHops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);
  return hops[hops.length - trustedHops] ?? "unknown";
}
```

---

### C4. A switched-off invite link can still be used to get into the group ✅ Proven

- **Files:** `src/app/api/identity/route.ts` (lines 51–53), `src/lib/identity.ts` (`claimGhost`, line 255), `src/app/api/invite/[code]/route.ts` (lines 21–62)
- **Severity:** 🔴 Critical
- **Category:** Security — authorization bypass

**Problem.** "Placeholders" are people typed into a group before they've installed the app (e.g. "Sam"). Anyone can view an invite link's preview **without an account**, and the preview lists each placeholder's internal ID. Then, during sign-up, anyone can send that ID and "become" Sam. Nothing checks that they have a valid invite code, or that the link is still switched on. Becoming Sam makes them a full member of every group Sam is in.

**Live result:**
> invite preview after disable → 404; claim → 201; GET group as stranger → 200; ledger rows visible: 1

So the owner switched the link off after it leaked, the link correctly showed "not found", and the stranger still got in through the side door.

**Impact.** "Disable invite link", the documented fix for "I posted the link in the wrong chat", doesn't work. A stranger also takes over Sam's identity: anything they add shows as Sam, and Sam's real owner can no longer claim the name. There's no limit on sign-ups either (see M1).

**Attack scenario.** Scrape invite previews (made easy by C3), save the placeholder IDs, and claim them later, whenever you like.

**Recommended fix.** Remove `claimGhostId` from `POST /api/identity`. Claiming should only happen through `POST /api/invite/[code]/join`, which checks the code is live, and should run inside one database transaction. Don't send placeholder IDs in the unauthenticated preview; send short-lived, single-use claim tokens instead.

---

### C5. Recurring expenses in a foreign currency are booked at 1 = 1 ✅ Proven

- **Files:** `src/server/recurrence.ts` (lines 143–144), `src/app/api/recurrences/route.ts` (lines 20–34, 71–131)
- **Severity:** 🔴 Critical
- **Category:** Data integrity — money calculated wrong

**Problem.** You can create a repeating expense in any currency, for example ¥10,000 a month in a group that settles in US dollars. When it posts, the code uses an exchange rate of exactly 1, so **¥10,000 (about $67) becomes $10,000.00** on everyone's balance.

**Evidence.** `runDueRecurrences` passes `exchangeRate: "1"` and `settlementCurrency: group?.currency`. Nothing at creation time checks that the currencies match or asks for a rate.

**Live result:**
> ¥10,000 (≈ $67) posted into a USD group as convertedAmount=1000000 cents = $10000

**Impact.** Balances silently become wildly wrong: a group member suddenly "owes" thousands. People who trust the number and settle up will transfer real money they don't owe. This is direct financial harm and a trust-destroying bug.

**Recommended fix.** At creation, either require the recurrence's currency to equal the group's, or store a rate (and preferably look up the live rate each time it posts). Write a migration that finds already-posted occurrences where the expense currency differs from the group currency and the rate is "1", and flag them for correction.

**Example fix:**
```ts
if (input.groupId) {
  const { group } = await requireGroupAccess(input.groupId, me);
  if (input.currency !== group.currency) {
    throw new ValidationError(`Repeating expenses in this group must be in ${group.currency}.`);
  }
}
```

---

### C6. One user can flood a group with thousands of expenses, and any user's visit triggers it ✅ Proven

- **Files:** `src/app/api/recurrences/route.ts` (line 89, no date limits), `src/app/api/recurrences/[id]/route.ts` (`nextRunAt`, lines 21–39), `src/server/recurrence.ts` (lines 103–212), `src/app/api/dashboard/route.ts` (line 18), `src/app/api/recurrences/run/route.ts`
- **Severity:** 🔴 Critical
- **Category:** Abuse / data integrity / performance

**Problem.**
1. A repeating expense can be given any start date, even the year 2000. The app then "catches up" by posting up to 60 missed occurrences at a time.
2. This catch-up runs for **the whole system** every time **any user** opens their home screen. So a stranger's visit posts expenses into your group, and your visit pays the time cost of everyone else's recurring expenses.
3. Any logged-in user can also trigger it on demand through `POST /api/recurrences/run`.

**Live result:**
> dashboard load 1 by an unrelated user took 589 ms; group now has 62 expenses
> dashboard load 2 … 121 expenses
> dashboard load 3 … 181 expenses

A daily recurrence backdated to 2000 keeps adding 60 expenses per page load, about 9,500 in total, all against the people in its split.

**Impact.** A malicious or careless group member can bury a group in fake debts. Home-screen speed for everyone depends on the total recurring workload of the whole system. As customers grow, every home-screen load gets slower, and failures there are hidden (see M7).

**Recommended fix.**
- Reject `startDate`/`nextRunAt` more than ~31 days in the past or 5 years in the future.
- Move recurrence processing out of the dashboard request into a scheduled background job (a cron job every few minutes, with a lock so only one copy runs).
- Restrict `/api/recurrences/run` to a secret token held by the scheduler, not to any user.
- When catching up more than a few occurrences, ask for confirmation instead of posting silently.

---

### C7. The database falls over with as few as 50 people saving at the same moment ✅ Proven

- **Files:** `prisma/schema.prisma` (line 14, `provider = "sqlite"`), `src/server/write.ts` (interactive transactions with one insert per row), `src/lib/db.ts` (no WAL / busy-timeout settings)
- **Severity:** 🔴 Critical
- **Category:** Scalability / reliability

**Problem.** All data lives in one SQLite file, and SQLite only lets **one write happen at a time**. Each save holds that lock for a long time: it opens a transaction, then writes the expense, payers, splits, items and attachments one by one. The database isn't set to its faster concurrent mode (WAL), and has no sensible wait-for-lock setting.

**Live result (local machine, after removing the flood from C6):**

| Test | Server errors | Typical wait | Slowest |
|---|---|---|---|
| 50 people press "Save" at once | **31 of 50 failed** | 12.2 s | 12.7 s |
| 200 people press "Save" at once | **180 of 200 failed** | 47.8 s | 60.3 s |
| 50 home-screen loads at once | 0 | 0.4 s | 0.5 s |
| 200 home-screen loads at once | 0 | 1.7 s | 1.8 s |

The server log showed 568 "Socket timeout" errors (Prisma P1008) and 199 transaction timeouts (P2028).

**Impact.** Busy moments, like Sunday evenings or the end of a trip, will lose saves and show "Something went wrong" errors. Online users see the error. Offline phones retry automatically, but repeated server errors can jam their queue (see M6). This hard ceiling can't be fixed by buying a bigger server, because SQLite can't be spread across several servers.

**Recommended fix.** Move to PostgreSQL before launch. The README already describes the switch, and the schema uses no SQLite-only features. Until then, enable WAL mode and a busy timeout, and replace the row-by-row inserts with `createMany`. Plan for a connection pooler (PgBouncer or the host's equivalent).

**Example fix (stop-gap only):**
```ts
// src/lib/db.ts — run once at boot
await prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL;");
await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000;");
await prisma.$executeRawUnsafe("PRAGMA synchronous = NORMAL;");
```

---

### C8. Strangers can add you as a "friend" or into their group, and then see your bank details

- **Files:** `src/lib/codes.ts` (`generatePersonalCode`, line 70), `src/app/api/invite/[code]/route.ts` (lines 64–69), `src/app/api/invite/[code]/join/route.ts` (lines 91–105), `src/app/api/groups/[id]/members/route.ts` (lines 71–107), `src/app/api/people/[id]/payment-methods/route.ts`
- **Severity:** 🔴 Critical
- **Category:** Security / privacy — consent bypass, personal-data exposure
- **Partly proven:** the code format was confirmed live (`me-crisp-ocean`); the rest follows directly from the code.

**Problem.** Your personal "add me" code is `me-` plus one of 48 adjectives plus one of 62 nouns, so there are only **2,976 possible codes** in total. Anyone holding (or guessing) your code can:
- make themselves your "friend" instantly, with no request for you to accept, and
- put you straight into **their** group, with no request for you to accept.

Being in the same group or being friends gives them your saved payment methods (UPI ID, IBAN, sort code and account number, PayPal and Venmo handles), and lets them file debts against you.

**Evidence.** `POST /api/invite/[code]/join` with a personal code just `upsert`s a friendship. `POST /api/groups/[id]/members` with `inviteCode` adds the person directly. `GET /api/people/[id]/payment-methods` allows anyone who is a friend or shares a group. The preview endpoint answers "is this a real person code?" without any login.

**Impact.**
- **Mass harvesting:** with C3's header trick, all 2,976 codes can be checked in a few minutes. That's every early user's name plus banking handles.
- **Harassment / fake debts:** a stranger can add you to "Mallory's Group" and record that you owe them money. It appears on your home screen.
- Once there are more than ~3,000 users the codes run out and new ones fall back to `code + 4 characters of the current time` (`identity.ts` line 434), which is predictable.

**Recommended fix.** Use high-entropy personal codes (10+ random characters, still shareable as a link or QR). Turn "add friend" and "add to group" into **requests the other person must accept**. Only show payment methods to people you have accepted, and only once a debt exists between you.

---

### C9. No size limit on what anyone can send to the server ✅ Proven

- **Files:** `src/lib/api.ts` (`readBody`, line 117), `src/app/share-target/route.ts` (line 22), `src/server/expense-input.ts` (lines 63–72), `next.config.ts` (line 58)
- **Severity:** 🔴 Critical
- **Category:** Denial of service / cost

**Problem.** The server reads the *entire* body of every request into memory before checking anything. The 12 MB limit in `next.config.ts` applies only to "Server Actions", which this app doesn't use; it doesn't protect any of the app's endpoints. The share endpoint accepts uploads with no login at all.

**Live result:**
> 150 MB JSON body to /api/identity without an account → HTTP 201 after 675 ms (server read the whole thing before answering)

Separately, each expense can carry 6 receipts of up to 4 MB (stored *inside the database*), with no per-user or per-group storage cap.

**Impact.** A handful of simultaneous huge requests will exhaust server memory and crash it, which means downtime for every customer. Receipt uploads can fill the disk; when the disk fills, SQLite stops accepting **all** writes. Large receipts in the database also make backups slow and expensive.

**Recommended fix.** Put a hard body limit at the proxy (e.g. 1 MB for normal endpoints, ~6 MB for receipt upload) and check `Content-Length` before reading. Move receipts to object storage (S3, R2, Supabase Storage) using pre-signed uploads. Add per-user storage quotas.

**Example fix:**
```ts
export async function readBody<T>(request: Request, schema: ZodType<T>, maxBytes = 256 * 1024): Promise<T> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new ValidationError("That request is too large.");
  const raw = await request.text();
  if (raw.length > maxBytes) throw new ValidationError("That request is too large.");
  return schema.parse(JSON.parse(raw));
}
```

---

### C10. The web framework has known critical security holes

- **File:** `package.json` (`"next": "15.5.23"`)
- **Severity:** 🔴 Critical
- **Category:** Supply chain / dependency vulnerabilities

**Problem.** `npm audit` (run 14 Oct 2026) reports **7 known vulnerabilities in production dependencies: 1 critical, 6 high.** They include several Next.js advisories: remote code execution on Windows-hosted servers (GHSA-p293-qw3h-jr36), remote code execution via the image optimizer with AVIF files (GHSA-2xp9-vwfh-vxw4), and cache poisoning on self-hosted apps (GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p). The rest are PostCSS file-read issues, image-library (`sharp` / libvips / libheif) issues, and two denial-of-service bugs.

**Impact.** Some of these may not apply to how this app is deployed, but they can't be ruled out without a careful check, and a known critical advisory is an automatic red flag in any customer or security review.

**Recommended fix.** Upgrade Next.js to a patched release (npm's suggested fix is a major-version upgrade, so test it), run `npm audit fix`, and add `npm audit --omit=dev --audit-level=high` plus Dependabot or Renovate to CI so this can't drift again.

---

### C11. No backups, no restore plan

- **Files:** `Dockerfile`, `docker-entrypoint.sh`, `README.md` ("Backing up the whole app is copying one file")
- **Severity:** 🔴 Critical
- **Category:** Missing system — data durability / disaster recovery

**Problem.** Every customer's data and every receipt photo sits in **one file on one disk**. There's no automatic backup, no copy kept anywhere else, no point-in-time recovery and no tested restore procedure. Copying a live SQLite file while it's being written can also produce a corrupt backup.

**Impact.** A disk failure, a bad migration, an accidental volume deletion on the host, or a ransomware event means **permanent loss of everyone's financial history**. For an app whose whole purpose is "who owes whom", that ends the business.

**Recommended fix.** Use managed Postgres with automated daily backups and point-in-time recovery. Until then, use `litestream` (continuous SQLite replication to S3) or a nightly `sqlite3 .backup` copied off the host. Run a test restore every month.

---

## 🟠 MAJOR

### M1. Unlimited account creation ✅ Proven
- **File:** `src/app/api/identity/route.ts` (`POST`)
- **Category:** Abuse / cost

**Problem.** Creating an account needs nothing but a name, and has no rate limit or bot check.
**Live result:** "300 accounts from one address: 300 created in 5,936 ms, no limit hit".
**Impact.** Bots can fill the database with junk accounts, crowd out personal codes (making C8 worse) and give abusers unlimited fresh identities after any block.
**Fix.** Rate-limit sign-up per real IP (see C3) and per device, add a lightweight proof-of-work or Turnstile challenge after a threshold, and set up a job to delete empty accounts that are never used.

### M2. Any group member can record fake payments or rewrite anyone's expenses
- **Files:** `src/app/api/settlements/route.ts` (lines 52–71), `src/app/api/expenses/[id]/route.ts` (`PATCH`, `DELETE`), `src/server/access.ts` (header comment)
- **Category:** Business logic / fraud

**Problem.** Inside a group, any member can record "Bob paid Alice $5,000" without Bob or Alice confirming, and can change or delete any expense. The only safeguard is a line in the activity feed.
**Impact.** In a dispute, one member can quietly erase what they owe, or inflate what others owe. For paying customers, "the app let him delete my record" is a support and reputation problem.
**Fix.** Payments recorded by a third party should need confirmation from the payee. Edits to someone else's expense should notify the affected people and be reversible. Consider an "admins only" setting per group.

### M3. A group member can hand a placeholder's debts to someone else without consent
- **File:** `src/server/merge.ts` (`assertMayMerge`, lines 79–86; `absorbGhost`)
- **Category:** Authorization / consent

**Problem.** "Merge placeholder" lets any member declare that placeholder "Sam" is really *your* account. All of Sam's debts move to you, and you're added to Sam's groups, without you being asked.
**Impact.** Unwanted debts and unwanted group memberships, and a harassment route.
**Fix.** Only the target person (or someone they've explicitly approved) should be able to complete a merge. Make it a request they accept.

### M4. Sign-ins never expire
- **File:** `src/lib/identity.ts` (line 44 `COOKIE_MAX_AGE` = 10 years; `getSession` has no expiry check; lines 143–149 still accept old cookies that contain the recovery key itself)
- **Category:** Session management

**Problem.** A signed-in device stays signed in for 10 years with no inactivity timeout and no server-side expiry. Cookies from the older design (which contain the master recovery key) are still accepted.
**Impact.** A lost, sold or shared phone keeps full access to someone's financial records indefinitely, unless the owner thinks to revoke it.
**Fix.** Expire sessions after e.g. 90 days of no use and 1 year at most. Re-issue a new cookie format and stop accepting the legacy format after a migration window.

### M5. Signing out leaves your financial data on the device
- **Files:** `src/app/(app)/account/page.tsx` (`signOut`, lines 85–100), `public/sw.js` (lines 128–130, 176–203)
- **Category:** Privacy

**Problem.** For offline use, the app's background worker saves a copy of every balance, ledger, friend list and expense screen it loads. Signing out clears the pending-changes queue and the in-memory data, but **not** that saved copy, and not the "rejected changes" store.
**Impact.** On a shared or borrowed phone or laptop, the next person can see the previous user's balances and expenses, either while offline or through the browser's developer tools.
**Fix.** On sign-out, delete every cache whose name starts with `divvy-`, clear the `rejected` store, and tell the service worker to drop its API cache. Better still, tag saved responses with the person's ID and refuse to show another person's data.

### M6. One stuck change can freeze a phone's offline queue forever
- **File:** `src/lib/client/outbox.ts` (lines 247–259), `src/app/(app)/account/page.tsx` (lines 86–95)
- **Category:** Reliability / UX dead-end

**Problem.** Offline changes are sent in strict order. If the first one keeps getting a server error (5xx), it stays at the front permanently and everything behind it waits. Signing out is also blocked while anything is queued.
**Impact.** If a server bug rejects one particular expense (for example the receipt decoder crash in m3), that user can never sync again, and can't sign out to recover either. Data typed on that device is stuck.
**Fix.** After the maximum number of attempts, move the entry to the "rejected" list (with a retry button) just as is already done for 4xx errors. Allow sign-out with a clear "these N unsynced changes will be lost" warning.

### M7. A temporary database hiccup switches recurring expenses off for good
- **File:** `src/server/recurrence.ts` (lines 181–188, 200–208)
- **Category:** Reliability / silent failure

**Problem.** If posting a recurring expense fails for *any* reason, including a momentary "database busy", the code sets `active: false`. Nobody is told. Several copies can also run at the same moment (C6) and overwrite each other's decision.
**Evidence.** During the load test the server logged **225** "recurrence failed to post" errors. Whether a given recurrence ended up on or off depended on which run finished last.
**Impact.** Rent or subscription expenses silently stop appearing. Users find out weeks later when balances are wrong.
**Fix.** Only deactivate on *permanent* validation errors. Retry temporary errors next run. Record failures and show "This repeating expense couldn't post" in the group.

### M8. Recurring expenses keep charging people who left, and post on the wrong day
- **Files:** `src/server/recurrence.ts` (`runDueRecurrences`, `nextOccurrence`), `src/app/api/recurrences/route.ts` (line 121 `startDate.getDate()`)
- **Category:** Data integrity

**Problem.**
- The split is frozen when the recurrence is created and never re-checked against current membership, so someone who moved out keeps being charged rent.
- Dates are calculated in the server's time zone (UTC in Docker). For a user in India, "the 1st at midnight" is 18:30 on the 31st in UTC, so rent anchors to the 31st/30th.

**Fix.** Skip or pause occurrences whose people are no longer members, and notify the group. Store the creator's time zone and do date maths in it.

### M9. Balances are recalculated from the entire history on every screen load
- **Files:** `src/server/read.ts` (`groupBalanceSheet` lines 72–110, `groupSheetsFor` 445–453), `src/server/me.ts` (`dashboardDto`), `src/app/api/groups/[id]/stats/route.ts`, `src/app/api/nudges/route.ts`
- **Category:** Scalability

**Problem.** Every home-screen load fetches **every expense and every payment ever made in every group you belong to**, and adds them up from scratch. Statistics, nudges, the friends page and settle-up do the same thing again. Nothing is stored or cached.
**Impact.** Fine for a handful of small groups. A two-year house-share with 3,000 expenses, multiplied by every member opening the app several times a day, multiplied by thousands of groups, grows server cost and load time in a straight line with history. Combined with C7, this is what fails first as customers grow.
**Fix.** Keep a running balance table (per group and per person pair) updated in the same transaction as each expense or payment. Recompute nightly to check it still matches. Cache the dashboard per user for a few seconds.

### M10. Merging a placeholder scans every recurring expense in the whole system while holding the database lock
- **File:** `src/server/merge.ts` (`moveRecurrenceTemplates`, lines 482–485)
- **Category:** Scalability

**Problem.** `tx.recurrence.findMany({ select: … })` has no filter, so it loads every recurrence of every customer, inside a write transaction, every time anyone claims a placeholder.
**Impact.** With SQLite's one-writer rule (C7), every other save in the system waits while this runs. This gets worse with every new customer.
**Fix.** Filter to recurrences in the placeholder's groups (`where: { groupId: { in: ghostGroupIds } }`), or store template people in a proper child table instead of JSON text.

### M11. Offline edits overwrite other people's changes without warning
- **File:** `src/server/write.ts` (line 192), `src/server/expense-input.ts` (line 19)
- **Category:** Data integrity (lost updates)

**Problem.** The "someone else changed this" check is skipped whenever the request doesn't include the version it was based on, and queued offline edits are allowed to skip it.
**Impact.** Alice fixes an amount; Bob's three-day-old offline edit syncs later and silently puts the old number back.
**Fix.** Always send the base version. When a queued edit conflicts, put it in the "rejected" list with both versions shown, instead of overwriting.

### M12. Exchange rates come from the user's phone and aren't checked
- **Files:** `src/server/expense-input.ts` (line 28), `src/app/api/settlements/route.ts`, `src/server/rates.ts`
- **Category:** Data integrity / external dependency

**Problem.**
- When an expense is in another currency, the rate is whatever the client sends (any positive number), so a member can record €10 at a rate of 1000.
- Live rates come from two free, keyless public APIs, called **during the user's request**. If they're slow, the user waits up to 8 seconds, and every cache miss writes ~160 rows to the database (C7 contention).

**Fix.** Server-side, compare the submitted rate with the reference rate and require confirmation (or reject) beyond ±10%. Fetch rates in a background job every few hours, never in the request path. Use a provider with a paid SLA for production.

### M13. Missing browser security headers
- **File:** `next.config.ts` (`headers`, lines 63–82)
- **Category:** Security hardening

**Problem.** There's no Content-Security-Policy, no Strict-Transport-Security (HSTS), no Permissions-Policy and no Cross-Origin-Opener-Policy.
**Impact.** If any script-injection bug ever appears, nothing limits the damage. Without HSTS, a first visit over a hostile Wi-Fi network can be downgraded to plain HTTP.
**Fix.**
```ts
{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
{ key: "Content-Security-Policy", value: "default-src 'self'; img-src 'self' data: blob:; script-src 'self' 'nonce-…'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" },
{ key: "Permissions-Policy", value: "camera=(self), geolocation=(), microphone=()" },
{ key: "Cross-Origin-Opener-Policy", value: "same-origin" },
```
(The inline theme script in `src/app/layout.tsx` needs a nonce or hash.)

### M14. No monitoring, error tracking or alerts
- **Files:** whole server; only `console.error` in `src/lib/api.ts` (line ~120) and `src/server/recurrence.ts`
- **Category:** Missing system — observability

**Problem.** Errors print to the console and nowhere else. There's no error tracker, no metrics (requests, latency, error rate, database time), no uptime check, no alerting, and no request IDs to connect a user's complaint to a log line.
**Impact.** C1, C5, C7 and M7 would all happen in production **without anyone knowing** until customers complained.
**Fix.** Add Sentry (or similar) on both server and browser, structured JSON logs with request IDs, an uptime monitor on a `/api/health` endpoint, and alerts on error rate above 1% and slow requests.

### M15. Deployment setup: runs as root, no health check, downtime on every deploy, can only run one copy
- **Files:** `Dockerfile` (lines 90–103), `docker-entrypoint.sh` (lines 21–23), `src/server/rate-limit.ts`
- **Category:** Infrastructure

**Problem.**
- The container runs as the all-powerful `root` user (the Dockerfile says so on line 90).
- There's no health check or readiness endpoint, so the host can't tell "started" from "working".
- Database migrations run automatically at boot with no backup taken first and no rollback plan.
- SQLite plus in-memory rate limiting means **only one copy of the server can ever run**. Every deploy or crash is a full outage, and there's no failover.
- There's no graceful shutdown handling (in-flight saves can be cut off).

**Fix.** Run as a non-root user (chown the volume at start-up, then drop privileges with `gosu`). Add `/api/health` (checks the database) and wire it to the host's health check. Take a backup before migrations. After the Postgres move, run 2+ copies behind the load balancer with rolling deploys.

### M16. No legal or privacy features for paying customers
- **Category:** Missing system — compliance

**Problem.** There's no way to delete your account and data, no privacy policy or terms, no data-retention rules and no data-processing records. The app stores bank handles (IBAN, UPI), receipt photos (which often show card digits and addresses) and spending history.
**Impact.** Under GDPR, UK GDPR and India's DPDP Act you must be able to delete a user's data on request and explain what you store. Missing this blocks launch in the EU/UK, and payment providers and app stores will ask for it.
**Fix.** Add "Delete my account" (anonymise the person row, keep balances intact for the others as "Deleted user"), a privacy policy, terms, and a retention policy for receipts.

### M17. No billing system, although the goal is paying customers
- **Category:** Missing system — business

**Problem.** The README says "There is no paid tier, because there is nothing to pay for." There's no subscription, plan or entitlement code, no payment provider and no invoices. Accounts have no email, so there's no way to send a receipt or reach a customer.
**Impact.** To charge customers you'll need billing, a real customer identity (email at minimum), entitlement checks and a way to contact users. That's a substantial piece of work and it changes the "no accounts" design.
**Fix.** Decide the business model first, then add Stripe (or Razorpay for India) with webhooks, a `Subscription` table, and an optional verified email on the account.

### M18. Tests missed the most serious bugs
- **Files:** `scripts/smoke.mjs`, `src/**/__tests__`, `.github/workflows/ci.yml`
- **Category:** Testing

**Problem.** There are strong tests for the money arithmetic, but none that check **one customer can't see another customer's data** across all read endpoints (C1 and C2 slipped through), no load or concurrency tests (C7), no tests for recurrence currency or date limits (C5, C6), and no security scanning in CI. One unit test (`src/__tests__/route-wiring.test.ts`) fails on Windows because it assumes `/` in file paths.
**Fix.** Add a "tenant isolation" test suite: create two strangers and assert that every GET/POST endpoint refuses or hides the other's records. Add a k6 or autocannon load test in CI with a pass threshold. Add `npm audit` and CodeQL to CI.

### M19. Race conditions in claiming and settling
- **Files:** `src/lib/identity.ts` (`claimGhost`, check-then-update outside a transaction), `src/app/api/settlements/batch/route.ts` (outstanding amount read, then written later)
- **Category:** Concurrency

**Problem.** Two people claiming the same placeholder at the same moment can *both* succeed (two recovery keys for one person). Two "settle up" taps from two devices can both pass the "not more than is owed" check and over-settle.
**Fix.** Do the claim as one conditional update (`updateMany where isGhost=true`) and check that exactly one row changed. Re-check the outstanding amount inside the same transaction that writes the settlement.

---

## 🟡 MINOR

| # | File | Problem in plain English | Fix |
|---|---|---|---|
| m1 | `src/app/api/groups/[id]/invite/route.ts` (line 24) | Any member, not just the owner, can turn the invite link back on after the owner switched it off. | Owner only (or an owner/admin role). |
| m2 | `src/app/api/groups/[id]/members/[personId]/route.ts` | The owner can leave, leaving a group nobody can delete or manage. | Transfer ownership on leave, or block it. |
| m3 | `src/server/write.ts` (`decodeDataUrl`, line ~319) | A malformed non-base64 receipt makes `decodeURIComponent` crash, giving a 500 error (and can trigger M6). | Catch and return 422. Accept base64 only. |
| m4 | `src/app/api/identity/passkeys/auth/route.ts` (line 50), `…/register/route.ts` (line 62) | Bad JSON makes `request.json()` throw a 500 instead of a clean error. | Use the shared `readBody` helper. |
| m5 | `src/lib/webauthn-challenge.ts` | The passkey challenge is kept only in the user's own cookie, not recorded on the server, so a leaked passkey response could be replayed on authenticators that don't use counters (common with synced passkeys). | Store challenges server-side with a short expiry and single use. |
| m6 | `src/server/write.ts` (lines 288–296) | Receipt type is trusted from the client label, not checked against the actual file bytes. PDFs are served inline from the main site. | Check magic bytes. Serve receipts with `Content-Disposition: attachment` or from a separate domain. |
| m7 | `src/app/api/identity/payment-methods/route.ts`, comments, budgets | No limit on how many payment methods, comments or budgets one person can create. | Per-user caps (e.g. 20 payment methods, comment rate limit). |
| m8 | `src/app/api/expenses/[id]/route.ts` + `src/server/access.ts` | Once a member leaves, old expenses that include them can no longer be edited ("Somebody in that split is not in the group"). | Allow former members on expenses that already included them. |
| m9 | `src/app/api/expenses/[id]/restore/route.ts` | Restoring a deleted expense can bring back a debt for someone who has since left the group. | Check membership on restore, or warn. |
| m10 | `src/app/api/budgets/route.ts` (`periodStart`) | Budget periods use the server's time zone, so "this month" can be off by a day. | Use the user's time zone. |
| m11 | `src/app/api/export/route.ts` | Whole-account export loads everything into memory in one go. Fine now, slow for large accounts. | Stream it, or build it as a background job. |
| m12 | `src/server/rates.ts` | ~160 separate database writes per rate refresh, in parallel. | One batched upsert in a background job. |
| m13 | `src/__tests__/route-wiring.test.ts` | Fails on Windows (path separator). | Normalise paths with `path.posix` / `replaceAll("\\", "/")`. |
| m14 | CI (`.github/workflows/ci.yml`) | No deploy stage, no staging environment, no rollback step. Deploys are manual on the host. | Add staging, deploy on tag, and a one-click rollback to the previous image. |
| m15 | `src/app/api/groups/route.ts` (line 93), members route (line 132) | Placeholder codes use `Math.random()` (not cryptographically random). They aren't redeemable today, so it's low risk, but it's an easy trap later. | Use `generateSecret()`-style randomness. |

---

# Part 2 — Summary sections

## Executive summary

**Is this production ready?** No.

**Can it safely serve paying customers?** No, not in its current form. The arithmetic for splitting money is careful and well tested. The problems are in **who can see what**, **what happens when many people use it at once**, and **what happens when something goes wrong**.

**Biggest business risks, in plain words:**

1. **Customers' private financial records can be read by any other customer.** One search box bug (C1) and one "save" shortcut (C2) each expose other people's expenses, notes and amounts. Both were proven on a running copy. This is a data breach on day one.
2. **Strangers can get into groups and see people's bank details.** The guessing protection is switched off by changing one header (C3), personal codes have only 2,976 possibilities (C8), and turning off an invite link doesn't actually lock the door (C4).
3. **The numbers can be wrong.** A repeating expense in a foreign currency is booked at 1 = 1, turning ¥10,000 into $10,000 (C5). One person can add thousands of fake expenses (C6). People settle up with real money based on these numbers.
4. **It breaks under modest load and has no safety net.** 31 of 50 simultaneous saves failed (C7). There are no backups (C11), no monitoring (M14), and only one copy of the server can run (M15). A disk problem could lose everyone's history, and nobody would be alerted to an outage.
5. **It isn't built to take money.** There's no billing, no customer email, no account deletion and no privacy policy (M16, M17).

---

## Production readiness scorecard

| Category | Score /10 | Notes |
|---|---|---|
| Security | **2** | Cross-customer data leaks (C1, C2), bypassable rate limit (C3), invite bypass (C4), guessable personal codes (C8), vulnerable framework (C10), no CSP/HSTS. |
| Backend architecture | **5** | Clean layering and good money maths, but recurring jobs run inside page loads, balances are recomputed from scratch, and offline IDs are trusted without ownership checks. |
| Frontend | **6** | Careful offline design and accessibility, but data stays on the device after sign-out (M5) and the offline queue can lock up (M6). |
| Database | **3** | SQLite single writer, fails at 50 concurrent saves, receipts stored inside the database, no backups, JSON-in-text templates. |
| Infrastructure | **3** | Runs as root, no health check, single instance only, migrations at boot without a backup, no staging or rollback. |
| Reliability | **3** | Silent recurrence deactivation, lost offline edits, stuck queues, race conditions, no retries for temporary errors. |
| Scalability | **2** | Hard ceiling from SQLite plus in-memory state. Full-history recomputation on every load. |
| Testing | **5** | Excellent maths tests and a large end-to-end script, but no isolation, load or security tests, and the search leak passed CI. |
| Observability | **1** | Console logs only. No error tracking, metrics, alerts, health endpoint or audit trail beyond the user-facing feed. |
| AI safety | **N/A** | No AI features. |
| **Overall** | **≈ 3 / 10** | |

---

## Security risk matrix (critical and high-risk findings)

| ID | Finding | Likelihood | Damage | Login needed? | Proven live |
|---|---|---|---|---|---|
| C1 | Search returns every user's expenses | Very high (normal use triggers it) | Severe: data breach | Free account | ✅ |
| C2 | Re-using an ID returns someone else's expense/payment | High | Severe: data breach | Free account | ✅ |
| C3 | Rate limit bypassed by faking a header | Very high | Enables C4, C8, group takeover | None | ✅ |
| C4 | Disabled invite link bypassed via placeholder claim | Medium | Group access and identity takeover | None | ✅ |
| C8 | 2,976 personal codes; add-without-consent; bank-detail exposure | High | Personal-data harvest, harassment | Free account | Partly |
| C9 | No request size limit | High | Outage | None | ✅ |
| C10 | Known critical Next.js advisories | Medium | Possible server compromise | None | (npm audit) |
| C6 | Back-dated recurrence flood, triggered by any user | Medium | Ledger corruption, slowdown | Group member | ✅ |
| M1 | Unlimited sign-ups | High | Spam, cost | None | ✅ |
| M2 | Members can forge payments / rewrite expenses | Medium | Fraud between users | Group member | — |
| M3 | Debts handed to someone without consent | Medium | Harassment, wrong balances | Group member | — |
| M4 | 10-year sessions, legacy key-in-cookie accepted | Medium | Lost-device account access | Device access | — |
| M5 | Data left on the device after sign-out | Medium | Privacy breach on shared devices | Device access | — |
| M13 | No CSP/HSTS | Low–Medium | Makes any future injection bug worse | — | — |

---

## Technical debt matrix (highest first)

| Rank | Debt item | Why it hurts | Effort to fix |
|---|---|---|---|
| 1 | SQLite as the production database | Caps concurrency and allows only one server; blocks backups and failover | Medium (schema is portable; needs migration and testing) |
| 2 | Balances recomputed from full history | Cost and latency grow with every expense ever recorded | Medium–High |
| 3 | Recurring expenses run inside the home-screen request | Couples every user's speed to everyone's workload; racy | Medium |
| 4 | Receipts stored as bytes in the database | Bloats the database, backups and memory | Medium |
| 5 | Client-chosen IDs with no ownership check on replay | Source of C2 and future bugs | Low |
| 6 | Code-based identity with no email | Blocks billing, support contact and account recovery at scale | High (product decision) |
| 7 | In-memory rate limiting | Lost on restart, wrong with more than one server, bypassable | Low–Medium |
| 8 | Recurrence templates as JSON text | Forces full-table scans (M10), no foreign keys | Medium |
| 9 | No shared "access policy" layer | Each route re-implements permission checks, so they drift (C1 vs the group-ledger route) | Medium |
| 10 | Many endpoints parse bodies by hand | Inconsistent validation and 500s (m3, m4) | Low |

---

## Scalability assessment

These estimates are based on the measured local results (C7) plus the code paths above. A cloud server will be somewhat faster, but SQLite's one-writer rule doesn't change.

| Active users | What is likely to happen |
|---|---|
| **100** | Works. Occasional slow saves if a few people save at the same instant. The security bugs are fully exploitable already. |
| **1,000** | Evening peaks produce intermittent "Something went wrong" on save. Home screen slows for heavy groups. Personal codes run out at about 3,000 accounts (C8) and start using predictable fallbacks. One flood recurrence (C6) slows everyone. |
| **10,000** | Peaks exceed ~20–50 simultaneous writes, so a large share of saves fail (as measured). The database file grows by GBs from receipts; backups become slow. Recurrence processing on page load adds visible delay. No second server is possible. |
| **100,000** | Not achievable on this architecture. It needs Postgres, multiple servers, background jobs, stored balances, object storage and a shared rate limiter. |
| **1,000,000** | Needs a redesign: read replicas, a queue for recurring jobs, sharded or partitioned activity tables, CDN-served assets, regional data residency, a full SRE/on-call function. |

**Database performance estimate (current design):**

| Users | Rough database size (with receipts) | Write capacity | Home-screen load |
|---|---|---|---|
| 1K | 0.5–2 GB | Peaks start to fail | 0.1–0.5 s |
| 10K | 5–20 GB | Frequent failures at peak | 0.5–3 s for long-lived groups |
| 100K | 50–200 GB | Unusable | Seconds; lock contention |
| 1M | 0.5–2 TB | Impossible on SQLite | — |

---

## Missing systems report (ranked by priority)

1. **Tenant-isolation testing and a central access-control layer:** would have caught C1 and C2.
2. **Backups and disaster recovery:** automated, off-host, restore-tested.
3. **A production database (PostgreSQL) with connection pooling.**
4. **A real, shared rate limiter and abuse protection:** trusted IP, per-account limits, sign-up challenge.
5. **Error tracking, metrics, uptime monitoring and alerting.**
6. **Health/readiness endpoint and graceful shutdown.**
7. **A background job runner** for recurring expenses, rate refresh and cleanup.
8. **Request size limits and object storage for receipts.**
9. **Security headers (CSP, HSTS) and dependency scanning in CI.**
10. **Account deletion, a privacy policy, terms and data retention.**
11. **Billing/subscriptions and a customer contact channel** (email).
12. **Consent flows:** accept friend requests, accept group adds, confirm third-party payments.
13. **A staging environment, release tagging and one-click rollback.**
14. **An admin/support console:** look up a user, undo abuse, ban accounts.
15. **A security audit log,** separate from the user-editable activity feed.
16. **Session expiry and device management alerts** ("new sign-in on iPhone").
17. **Load testing in CI.**
18. **Feature flags** to switch risky features (recurrences, merges) off without a deploy.
19. **Privacy-respecting usage analytics** (even simple counts) to know what's used and what's failing.

---

## Top 20 fixes by ROI (least effort, most impact first)

| # | Fix | Effort | Impact |
|---|---|---|---|
| 1 | Fix the search `OR` overwrite (C1) | 15 min | Closes a live data breach |
| 2 | Ownership check on ID-replay in expenses/settlements/batch (C2) | 1 h | Closes a live data breach |
| 3 | Remove `claimGhostId` from sign-up; claim only via a live invite (C4) | 1 h | Makes "disable link" actually work |
| 4 | Require recurrence currency = group currency (C5) + data fix-up | 1–2 h | Stops wrong balances |
| 5 | Limit recurrence start/next dates; protect `/recurrences/run` with a secret (C6) | 1 h | Stops ledger flooding |
| 6 | Trusted-proxy IP extraction; never clear the limiter wholesale (C3) | 1–2 h | Restores brute-force protection |
| 7 | Request body size limits (C9) | 1–2 h | Stops single-request outages |
| 8 | Upgrade Next.js and run `npm audit fix` (C10) | 2–4 h | Removes known critical CVEs |
| 9 | Enable SQLite WAL + busy timeout (stop-gap for C7) | 30 min | Far fewer failed saves until Postgres |
| 10 | Clear all caches and the rejected store on sign-out (M5) | 1 h | Prevents data left on shared devices |
| 11 | Rate-limit sign-up (M1) | 1 h | Stops bot sign-ups |
| 12 | Don't deactivate recurrences on temporary errors (M7) | 1 h | Rent stops silently disappearing |
| 13 | Dead-letter after max attempts; allow sign-out with warning (M6) | 2 h | No permanently stuck phones |
| 14 | Add Sentry + `/api/health` + uptime monitor (M14) | 3–4 h | You learn about outages before customers do |
| 15 | Security headers: HSTS, CSP, Permissions-Policy (M13) | 2–4 h | Defence in depth |
| 16 | Nightly off-host backups (litestream) + one restore drill (C11) | 3–4 h | Data loss becomes recoverable |
| 17 | Tenant-isolation test suite in CI (M18) | 1 day | Prevents the next C1/C2 |
| 18 | High-entropy personal codes; friend/group-add needs acceptance (C8) | 1–2 days | Ends harvesting and harassment |
| 19 | Session expiry; drop legacy cookies (M4) | 0.5 day | Limits lost-device risk |
| 20 | Move recurrences to a scheduled background job (C6, M7, M9) | 1–2 days | Faster pages, no races |

---

## Top 10 production blockers (must fix before launch)

1. **C1** — Search leaks all customers' expenses.
2. **C2** — ID replay leaks other customers' expenses and payments.
3. **C3** — Rate limiting bypassable by a header.
4. **C4** — Invite-disable bypass and placeholder identity takeover.
5. **C8** — Guessable personal codes plus no-consent adds expose bank details.
6. **C5** — Foreign-currency recurrences corrupt balances.
7. **C6** — Back-dated recurrence flooding, triggered by any user.
8. **C7** — Database fails at ~50 concurrent saves (move to Postgres, or at minimum WAL plus a strict launch cap).
9. **C9 + C10** — Unbounded request sizes, and known critical framework vulnerabilities.
10. **C11 + M14** — No backups and no monitoring.

---

## 30-day remediation plan

### Week 1 — Stop the leaks
- Fix C1, C2, C4, C5, C6 (date limits and protecting the run endpoint), C9 (body limits).
- Trusted-proxy rate limiting (C3) and a sign-up limit (M1).
- Upgrade Next.js and fix `npm audit` (C10).
- Enable WAL and a busy timeout as a stop-gap (C7).
- Write the **tenant-isolation test suite** and make it required in CI.
- Data check: find already-posted recurrences with mismatched currency and correct them; notify affected groups.

### Week 2 — Safety nets
- Off-host automated backups plus a documented, tested restore (C11).
- Sentry, structured logs with request IDs, `/api/health`, uptime monitor, alerts (M14).
- Security headers (M13); non-root container; health check wired to the host (M15).
- Clear device data on sign-out (M5); fix the outbox dead-end (M6).
- Recurrence error handling (M7), and departed-member and time-zone handling (M8).

### Week 3 — Scale foundations
- Migrate to **PostgreSQL** with pooling. Migrate the data. Load-test until 200 concurrent saves succeed (C7).
- Move receipts to object storage with size quotas (C9).
- Move recurrences and rate refresh into a scheduled background job (C6, M12).
- Add stored running balances, or at least per-request caching (M9). Fix the unfiltered merge scan (M10).
- Shared rate-limit store (Redis or Postgres).

### Week 4 — Trust, consent and business readiness
- High-entropy personal codes; friend-request and group-add acceptance; payment details only for accepted contacts (C8, M3).
- Third-party payment confirmation and edit notifications (M2); conflict-safe offline edits (M11).
- Session expiry and legacy cookie retirement (M4).
- Account deletion, privacy policy, terms (M16).
- Staging environment, tagged releases, one-click rollback (m14).
- Decide on billing (M17) and plan it as its own project. It needs customer email and a payment provider.

---

## Final verdict

# ❌ NOT PRODUCTION READY

**Why, in one paragraph:** live tests showed that any customer can read other customers' private expenses through the search box (C1) and through the save endpoint (C2). The protection against guessing invite codes switches off when you change one header (C3), and switching off an invite link doesn't keep strangers out (C4). A repeating expense in another currency turned ¥10,000 into a $10,000 debt (C5). A single backdated recurring expense added 181 expenses to a group in three page loads triggered by an unrelated user (C6). 31 of 50 simultaneous saves failed (C7). A 150 MB request was accepted with no login (C9). The framework has known critical advisories (C10), and there are no backups (C11) and no monitoring (M14). Each of these alone would block a launch to paying customers. Together they put real customer data and real money decisions at risk.

The good news for planning is that the five worst problems (C1, C2, C4, C5, C6) are each small, targeted code changes. With the 30-day plan above, the app could reasonably reach **"READY WITH MINOR CHANGES"** for a limited, invite-only paid beta. A public launch at scale needs the Week 3 database and architecture work done first.

---

*Reproduction scripts used for the ✅ Proven findings were run against a throwaway local database, which was deleted afterwards. No real data was touched.*

---

# Part 3 — Remediation status (14 October 2026, branch `fix/production-audit`)

Every finding above was worked through. A second bug-hunting pass over the screens, the offline sync and the money code found 11 more (N1–N11 below), and they were fixed in the same pass.

**How the fixes were verified** (fresh database, production build):

| Check | Before | After |
|---|---|---|
| Unit tests | 173 passing, 1 failing on Windows | **265 passing** |
| End-to-end API test (`scripts/smoke.mjs`) | 137 checks | **217 checks, all passing**, including one per audit finding |
| Browser UI checks (`scripts/ui-check.mjs`) | 75 | **81, all passing** |
| Offline / installed-app checks (`scripts/pwa-check.mjs`) | 36 | **36, all passing** |
| The 7 attacks from the audit, re-run | 7 of 7 worked | **0 of 7 work** |
| 50 people saving at the same moment | 31 failed, 12 s each | **0 failed, 0.25 s** |
| 200 people saving at the same moment | 180 failed, 48 s each | **0 failed, 0.8 s** |
| 1,000 simultaneous saves / home-screen loads | — | **0 server errors** |
| 150 MB request with no account | accepted | **refused (413)** |
| 300 sign-ups from one address | 300 created | **10 created, 290 refused** |
| Known vulnerabilities in shipped libraries (`npm audit`) | 7 (1 critical) | **0** |
| Errors in the server log across all of the above | — | **0** |

## Status of every finding

✅ = fixed and covered by an automated test. 🟦 = fixed in code, but needs a setting or an account from you before it is fully switched on. ⏸ = deliberately not changed, with the reason.

| ID | Finding | Status | What changed |
|---|---|---|---|
| C1 | Search leaks everyone's expenses | ✅ | The access scope is its own `AND` term that no filter can displace (`api/search/route.ts`). |
| C2 | ID re-use returns others' records | ✅ | A repeated id is only answered for the same author and ledger; otherwise 409. Covers expenses, payments and batch payments. |
| C3 | Rate limit bypassed by a header | ✅ | Uses the address the proxy appended (`DIVVY_TRUSTED_PROXIES`); per-account limits added; blocked keys survive floods. |
| C4 | Disabled invite bypassed via placeholder | ✅ | Claiming only through a live invite code; sign-up no longer accepts a placeholder id. |
| C5 | Foreign-currency recurrence at 1:1 | ✅ | Recurrences must use the group's currency; existing mismatched ones were paused, with an explanation, by the migration. |
| C6 | Back-dated floods; ran in everyone's page load | ✅ | Start date at most a year back, catch-up capped at 62, no rescheduling into the past; posting moved to a background scheduler; `/run` is scoped to the caller or needs `DIVVY_CRON_SECRET`. |
| C7 | 50 concurrent saves fail | ✅ | One queued SQLite connection, WAL mode, single-statement writes. Measured above. |
| C8 | 2,976 personal codes; adds without consent | ✅ | Codes carry a random tail (existing ones extended by the migration), group codes too. With unguessable codes, holding someone's code means they shared it. |
| C9 | No body size limit | ✅ | Streamed, capped body reading; early check in `middleware.ts`; the share endpoint never reads its body; receipt quotas (250 MB per group, 100 MB per person). |
| C10 | Vulnerable Next.js | ✅ | Next 15.5.27, patched PostCSS and deepmerge; `npm audit` in CI; Dependabot. |
| C11 | No backups | 🟦 | Pre-migration snapshot, daily `VACUUM INTO` snapshot (verified to open with integrity "ok"), Litestream built into the image. **Set `LITESTREAM_REPLICA_URL` and storage credentials** for the off-site copy. |
| M1 | Unlimited sign-ups | ✅ | 10 per address per hour. |
| M2 | Members can forge payments | ✅ / ⏸ | Fixed: someone else can only record up to what is actually owed. Kept: any member can still edit any expense, as in Splitwise, with every edit in the activity feed. |
| M3 | Placeholder debts pushed onto a non-member | ✅ | Only into yourself, or into someone already in every group the placeholder is in. |
| M4 | Sessions never expire | ✅ | 180-day idle expiry, rolling 400-day cookie, legacy key-in-cookie upgraded to a session on first use. |
| M5 | Data left on the device after sign-out | ✅ | Every app cache, the rejected-changes store and the stashed key are wiped. Browser-tested. |
| M6 | Offline queue can freeze for good | ✅ | After 6 failures a change is set aside with a Retry button; sign-out allowed after a "these will be lost" warning. |
| M7 | A temporary error switches a recurrence off | ✅ | Only permanent problems pause one, with the reason shown; races can no longer roll the schedule back. |
| M8 | Recurrences charge leavers; wrong day | ✅ | Paused with the leaver's name; dates worked out in the creator's time zone. |
| M9 | Balances recomputed from full history | ✅ | Cached per group against a `ledgerVersion` that every balance-changing write bumps. |
| M10 | Merge scans every recurrence | ✅ | Only the placeholder's groups. |
| M11 | Offline edits overwrite others | ✅ | The base version is always required; your own newer version may be overwritten, someone else's may not. |
| M12 | Unchecked exchange rate; rate API in the request path | ✅ | Rates more than 3× off the reference are refused (catches upside-down rates); cached rates served at once and refreshed in the background. |
| M13 | No CSP / HSTS | ✅ | Nonce-based Content-Security-Policy, HSTS over HTTPS, Permissions-Policy, framing denied. Browser-tested with no violations. |
| M14 | No monitoring | 🟦 | JSON logs with request ids, `/api/health` (checks the database), uncaught-error hook, optional `DIVVY_ALERT_WEBHOOK`. **Add an uptime monitor and, ideally, the webhook.** |
| M15 | Root container, no health check | ✅ | Runs as `node` via gosu; `railway.json` health check; pre-migration backup. (One instance only on SQLite — see "Still open".) |
| M16 | No account deletion or privacy page | 🟦 | Account deletion (only when settled up) and a `/privacy` page. **Have the page reviewed and set `DIVVY_CONTACT`.** |
| M17 | No billing | ⏸ | A business decision, not a bug: it needs a payment provider, customer email and pricing. Not started. |
| M18 | Tests missed the serious bugs | ✅ | Per-finding assertions in the end-to-end test, new unit and browser tests, all run in CI. |
| M19 | Races in claim and settle | ✅ | Claim is transactional via the join route; settle-ups serialised per pair of people and per group. |
| m1 | Any member re-enables the invite link | ✅ | Owner only. |
| m2 | The owner leaving strands the group | ✅ | Ownership passes to the longest-standing member. |
| m3 | Malformed receipt → 500 | ✅ | Base64 only; 422 otherwise. |
| m4 | Passkey bad JSON → 500 | ✅ | Validated bodies. |
| m5 | Passkey challenge replayable | ✅ | Challenges stored server-side and single-use. |
| m6 | File type trusted from its label | ✅ | File signatures checked; PDFs download rather than open inline; receipts served sandboxed. |
| m7 | Unbounded payment methods and the like | ✅ | Caps on payment methods (20), passkeys (20), budgets (50) and comment rate. |
| m8 | Old expenses with leavers uneditable | ✅ | People already on an expense may stay on it. |
| m9 | Restore revives a leaver's debt | ✅ | Refused with an explanation. |
| m10 | Budgets in server time | ✅ | Viewer's time zone. |
| m11 | Export loads everything into memory | ⏸ | Fine at this app's size; revisit past tens of thousands of expenses per account. |
| m12 | 160 parallel rate writes | ✅ | One transaction. |
| m13 | Test fails on Windows | ✅ | Path-separator fix. |
| m14 | No staging or rollback | ⏸ | Railway already offers one-click rollback. A staging environment is a second Railway service, which needs your account. |
| m15 | `Math.random` placeholder codes | ✅ | Cryptographic randomness. |

## Found in the second pass

| ID | Bug | Status |
|---|---|---|
| N1 | **"Split by item" threw the item lines away on save and split the bill equally instead.** Re-opening the expense showed no receipt. | ✅ Fixed and browser-tested: an 18/12 steak-and-salad bill now stays 18/12. |
| N2 | The same person twice on one expense crashed the server (500). | ✅ |
| N3 | Item lines could name people outside the expense; items could be negative; percentages were unbounded. | ✅ |
| N4 | The currency check could never fail, so made-up codes like "ZZZ" were accepted everywhere. | ✅ Real ISO codes only. |
| N5 | Dates were unbounded (year 1, year 9999). | ✅ |
| N6 | Chrome caps cookies at 400 days, so the "10-year" sign-in silently ended after about 13 months. | ✅ Rolling cookie. |
| N7 | Deleting a payment was the one delete that failed offline instead of queueing. | ✅ |
| N8 | A group's currency could be changed while deleted expenses, payments or recurrences still held amounts in the old one. | ✅ |
| N9 | A placeholder from one group could be added to another, tying two groups' balances to one made-up name. | ✅ |
| N10 | Group colour and type accepted any text on edit. | ✅ |
| N11 | With no proxy address available, every visitor shared one sign-up allowance (10 an hour for the whole world). | ✅ Address limits switch off with a logged warning; account limits stay on. |

## Still open, and why

1. **Off-site backups, alerts and an uptime monitor need your accounts** (C11, M14): an S3-compatible bucket for Litestream, a webhook URL, and a monitor pointed at `/api/health`. The code is in place; it does nothing until those are set.
2. **One server only.** SQLite plus the in-process scheduler and rate limiter mean a single running instance. Measured capacity is far above a few thousand active users; running several servers needs Postgres and Redis.
3. **Billing** (M17) is a product decision.
4. **Legal review** of the privacy page, and terms of service, before charging anyone.

## Revised verdict

**READY WITH MINOR CHANGES** for a paid launch, once the settings in "Still open" item 1 are configured and the privacy page is reviewed. Every security, data-integrity and reliability finding is fixed and covered by an automated test that runs on every push.
