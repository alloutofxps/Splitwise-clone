# Code health audit, 21 October 2026

A read-only look at Divvy's code for four things the earlier audits didn't
cover: code that can be removed, code written twice, code that can be written
more simply, and work the phone or the server does that it doesn't need to.
Nothing has been changed. Every finding below has its evidence, its risk and
how it would be tested, and they are grouped into small pull requests in
phases at the end.

## How it was measured

- **Code:** main at `08b9669`.
- **Download size:** `node scripts/size-report.mjs` against a production
  build served by `next start`, as in PERF-BASELINE section 1. To see which
  source file each byte comes from, a second build was made with source maps
  into a separate folder, and each script's compressed size was shared out by
  how much of it each source file makes up. Those per-file figures are
  estimates (gzip doesn't compress every part equally); each pull request
  measures its real saving.
- **A note on the numbers:** this build sits in a linked worktree, which reads
  about 0.5 KB higher than the main folder for the same code (webpack numbers
  its modules differently; see the group-size session's note). Here a group
  page reads **333.6 KB** and Home **310.9 KB**; in the main folder the same
  code reads 333.0 and 310.4. Every before-and-after in the pull requests will
  compare builds made the same way, in the same sitting.
- **Server:** request times from a script that signs up three people, makes
  three groups of 30 expenses and asks for each screen's data 40 times
  (median). The test database copy holds 7,762 people, 3,786 groups and 12,187
  expenses. The single database lookups were then timed one by one with
  Prisma itself, read-only.

## Where the group page's download goes

What a group page downloads before it can show itself, 333.6 KB:

| What | About |
|---|---|
| Next.js and React (fixed cost) | 122 KB |
| Motion (animations) | 51 KB |
| TanStack Query (data) | 13 KB |
| tailwind-merge (style merging) | 9.5 KB |
| **QR code drawing, only used in the Invite panel** | **9.7 KB** |
| **Sign-up screens, only used before you have an account** | **11.6 KB** |
| **A second and third copy of the shared buttons and doodle** | **5 to 6 KB** |
| **Panels opened by a tap, and the Insights tab** | **10 to 14 KB** |
| **Add expense panel** | **16.8 KB** |
| Everything else Divvy draws | the rest |

The rows in bold are pieces the screen doesn't show until someone taps
something, or never shows to a signed-in person. Together they come to about
54 to 58 KB of the 333.6. Moving them to after the page has loaded, the way
NumberFlow already is, would leave a group page around 280 KB: well under its
333 KB limit, with room for future work.

---

## Findings

### A. What a phone downloads

**1. The QR code library loads on every group page.** (qrcode and its helper,
9.7 KB.) A QR code is only drawn when you open Invite on a group, My code on
Friends, or Link a device in Account.
- *Evidence:* `src/components/ui/qr-code.tsx:4` imports `qrcode` at the top;
  `src/components/group/invite-sheet.tsx:13` brings it into the group page.
  `src/components/identity/devices-sheet.tsx:5` imports it the same way.
  Measured chunk `3925`: 9.3 KB qrcode, 0.4 KB dijkstrajs.
- *Fix:* fetch the library once the page has loaded (same pattern as
  `rolling-figure.tsx`), and draw the code when it is there. The code is
  already drawn a moment after the panel opens, so nothing on screen changes.
- *Risk:* low. Offline: fetching after load means it is cached before anyone
  goes offline.
- *Test:* size report; ui-check (invite tests); open Invite straight after
  loading, and offline after one visit.

**2. The sign-up screens load for people who already have an account.**
(About 11.6 KB on every screen: the welcome and sign-up steps 4.8 KB, the
passkey library 3.7 KB, the currency guess 1.7 KB, the emoji picker 1.5 KB.)
- *Evidence:* `src/components/app-gate.tsx:6` imports `Onboarding` up front.
  The app already knows from the server whether you are signed in
  (`signedIn`, `app-gate.tsx:35`). Measured in the `(app)/layout` chunk and
  chunk `1918`.
- *Fix:* fetch the sign-up screens only when they are needed. With no
  account, start fetching at once, while the welcome outline shows.
- *Risk:* medium. The paths that must keep working: first visit, an
  interrupted sign-up resuming on the recovery key, and an expired sign-in
  landing back on sign-up.
- *Test:* pwa-check (sign-up and recovery), ui-check, flow `08-first-run`
  recorded with and without Reduce Motion, opening timing.

**3. The shared buttons and doodle are downloaded three times.** (About 5 to
6 KB extra on every screen.) The "Something went wrong" screen and the
"Nothing here" screen are loaded with every page in case they're needed, and
each carries its own full copy of `primitives.tsx` (and of the icon code).
- *Evidence:* the Button styles string is in three chunks a group page loads:
  `6847` (2.8 KB of primitives), `9430` (2.5 KB, error screen) and
  `app/not-found` (2.9 KB). `src/app/not-found.tsx:2` and
  `src/components/error-screen.tsx:5-6` import from primitives.
- *Fix:* give those two screens their own small pieces (the doodle in its own
  file, plain buttons), so they stop carrying the whole file.
- *Risk:* low. They are rarely seen; they must look exactly as now.
- *Test:* pixel comparison of both screens in Day and Night; size report.

**4. A group's tap-to-open panels are downloaded before the page shows.**
Settings 2.6 KB, Recurring 2.1, Usual split 1.1, Merge a person 0.6, Invite
0.9, Settle up 3.5, and the Insights tab's charts 3.0 KB (Insights isn't the
tab that opens first).
- *Evidence:* static imports at `src/app/(app)/groups/[id]/page.tsx:22-25`;
  measured in the group page's own chunk.
- *Fix:* one small shared helper for "fetch after the page has loaded" (from
  the NumberFlow code), used for these panels and the Insights tab. Settle up
  stays mounted for its Undo, so it is fetched after load but kept.
- *Risk:* medium. A tap in the first instant, before they have arrived, must
  still open the panel with its normal rise (MOTION-SPEC: never wait for an
  animation before you can tap). The fetch is small and starts as soon as the
  page has loaded.
- *Test:* a script that opens each panel the moment the page has loaded;
  flow `06-panels` frames and timing; Reduce Motion; ui-check.

**5. The Add expense panel is part of every screen's start-up.** (16.8 KB:
the panel, split editor, receipt picker, number pad and pickers.)
- *Evidence:* `src/components/app-gate.tsx:7` imports `ExpenseComposer`;
  measured chunk `4776`.
- *Fix:* fetch after load, as in item 4.
- *Risk:* medium to high. Three ways in must keep working: the + button, a
  receipt shared into the app (opens the panel at launch), and Edit from a
  row's menu (fixed in #50).
- *Test:* flow `03-add-expense` frames and timing, pwa-check share-target,
  `perf-runs/2026-10-20-unchanged-rows/edit-check.mjs`.

**6. Home downloads three tap-to-open panels up front.** New group 2.2 KB,
Import from Splitwise with its file reader 2.8 KB, Join with the code scanner
3.5 KB. Home has 1.6 KB of room left.
- *Evidence:* Home's page chunk and chunk `5431`.
- *Fix and risk:* as item 4.
- *Test:* as item 4, plus the import and join tests in ui-features.

### B. Code that can be removed

**7. Components nothing uses, left from the redesign.** `Card`,
`PressableCard`, `Badge` and `SectionHeader` in
`src/components/ui/primitives.tsx:188, 207, 454, 484`. Nothing imports them.
- *Risk:* none (the type check proves it). *Test:* type check, lint, tests.

**8. Helpers nothing uses, or only their own tests use.**
- Unused: `magnitude` (`src/lib/balances.ts:340`, a second name for `abs`),
  `ALL_EMOJI` and `EMOJI_QUICK_PICKS` (`src/lib/emoji.ts:65, 74`; the first
  is worked out every time the app starts), `clearLedgerCache`
  (`src/server/ledger.ts:145`, a "test hook" no test calls).
- Only used by tests: `personalBalance` and `aggregateNet`
  (`src/lib/balances.ts:308, 326`; Home adds its totals itself in
  `src/server/me.ts:231`), `diffEdges` (`src/lib/flow.ts:176`; its comment
  says the untangle animation uses it, which it no longer does),
  `badgingSupported` and `clearBadge` (`src/lib/client/badge.ts:33, 59`).
- A field always empty: `FriendDto.lastActivityAt` is always `null`
  (`src/server/me.ts:203`) and no screen reads it.
- About 70 things are exported but only used inside their own file (mostly
  types). They can become private to their file.
- *Risk:* none to low. *Test:* type check, lint, tests (tests for removed
  helpers go with them).

**9. Styles nothing uses.** In `src/app/globals.css`: the classes
`.surface-card` (477), `.pb-safe`, `.pt-safe`, `.mb-safe` (448-456) and
`.no-select` (390); the colours `--brand-ring` (49, 150), `--chart-positive`
and `--chart-negative` (72-73, 168-169, 281-282); and `--ease-exit` (497).
Plain CSS like this is always sent, used or not.
- *Risk:* none. *Test:* style size; screenshots of every main screen in Day
  and Night (`perf-runs/critique/shots.mjs`).

**10. Six refreshes that refresh nothing.** After some saves the app asks for
"people" and "friends" data to be refetched, but no screen reads data under
those names (it comes inside Home's data). `src/lib/client/queries.ts:346,
903, 904, 927, 993, 997`; the names at `src/lib/client/cache-contract.ts:22,
26`.
- *Risk:* none. *Test:* tests, ui-check.

**11. A package nothing uses.** `date-fns` is listed in `package.json` but
imported nowhere; it is 20 MB in every install and in the server image.
`@types/qrcode` is a development-only package listed with the app's own
packages.
- *Risk:* none. This changes `package.json`, so it needs your OK.
- *Test:* build, CI image build, image size before and after.

### C. Code written twice, or more simply

**12. "Ignore the minus sign" is written out by hand in 21 places**, although
`abs` already exists in `src/lib/money.ts:414`. Examples:
`src/app/(app)/friends/page.tsx:111, 304, 306`,
`src/components/friends/settle-across-sheet.tsx:70, 82, 218`,
`src/lib/splitwise-import.ts:132, 171`, `src/server/read.ts:580-581`,
`src/server/me.ts:184-188`, `src/lib/flow.ts:211`.
- *Risk:* none. *Test:* tests, type check.

**13. Two "biggest first" sorts are written twice and never call two amounts
equal**, so equal amounts can come out in a different order each time
(`src/server/read.ts:580`, `src/server/me.ts:188`). One shared sort fixes
both.
- *Risk:* low. *Test:* a new unit test with equal amounts.

**14. The date field helper is written twice.** `toDateInput` is in both
`src/components/expense/composer.tsx:1201` and
`src/components/group/recurring-sheet.tsx:397`, and reading the picked date
back is written twice too (`composer.tsx:1206`, `recurring-sheet.tsx:347`).
The comment says "local midnight" while both use midday. One helper, with a
correct comment and a test.
- *Risk:* low. *Test:* a unit test around a time-zone change; ui-check.

**15. A group's details are put together in two places, with two different
rules for "unread".** The group screen's data (`src/app/api/groups/[id]/route.ts:42-82`)
and Home's group rows (`src/server/read.ts:675-697`) build the same fields
separately. The group screen also counts reminders between two other people
and ignores when you last opened Activity; Home doesn't. So opening a group
can send an extra "mark read" and refetch Home and Activity when Home showed
nothing unread.
- *Fix:* one builder for the shared fields, one rule for unread.
- *Risk:* low to medium. *Test:* unit tests for the unread rule; ui-check's
  unread-dot tests.

**16. Smaller tidy-ups.**
- `src/server/read.ts:456-469`: two comments that belong to other functions
  sit stranded above `EMPTY_SHEET`.
- `src/server/read.ts:64-67` passes `convertedBreakdown` on for two routes
  that can import it from `src/lib/split` directly.
- `src/app/(app)/groups/[id]/page.tsx:344`: `const shown = rest;` is a second
  name for the same value.
- `directUnreadCount` (`src/server/read.ts:382-391`) includes a case that can
  never match: it asks for entries by you while also requiring entries not by
  you (via `feedScope`, line 367).
- *Risk:* none. *Test:* type check, tests.

**22. The attachment limit is written twice** (found 27 October, while making
file-only values private). `MAX_ATTACHMENTS = 6` is in both
`src/server/expense-input.ts:12` and `src/lib/client/attachments.ts:34`. Both
are 6 today; nothing makes them stay equal, and if they drifted the app
would accept receipts the server then refuses.
- *Fix:* one constant in a small shared file both import.
- *Risk:* none. *Test:* type check, tests, the receipt tests in ui-features.

### D. Work the server does

**17. Home's data takes about 99 ms; four of its lookups search everybody's
data, not just yours.** Home's request measured 98.5 ms (90% under 108 ms);
a group's 15.7 ms. Timed one by one, every lookup took under 2 ms except four:

| Lookup | Now | Asked in two steps | Same answer |
|---|---|---|---|
| People you share a group with (`src/server/me.ts:78-88`) | 16 ms; **150 ms** for the busiest test account | 6 to 8 ms | yes |
| Expenses outside groups (`src/server/read.ts:92-105`) | 11 ms | 4 to 5 ms | yes |
| Unread entries outside groups (`src/server/read.ts:382`) | 20 ms | not timed yet | |
| Everyone you can see (`src/server/me.ts:292-304`) | 20 to 22 ms | **1 ms** | yes |

The database has the right indexes; the way these four questions are worded
makes it check every person or every expense. They grow with the whole
database, so every new person on Divvy slows everyone's Home a little.
Production holds far fewer people than the test copy today, so its numbers are
smaller now. The Activity request (47 ms) uses the same wording for its feed
and likely has the same cause; that PR measures it.
- *Fix:* ask each in two steps: first your own groups or rows (a quick,
  indexed lookup), then only those.
- *Risk:* medium (these decide who sees what). Each rewrite is checked to
  give exactly the same answer on the test database.
- *Test:* a script comparing old and new answers for every account in the
  test database; timing before and after; the full test suites.

**18. Home's request repeats work and waits when it needn't.**
(`src/server/me.ts:217-286`, `src/server/read.ts:586-672`.) Your group list is
fetched twice; your "last opened Activity" time is read again although the
request already has it; the unread count outside groups only starts after
everything else has finished; and "everyone you can see" re-finds friends and
group members the friends list has just found.
- *Risk:* low. *Test:* timing, tests, ui-check.

**19. Every group request asks two questions one after the other** (the
group, then your membership, `src/server/access.ts:28-39`). One question does
both. Saves a fraction of a millisecond on every group request.
- *Risk:* low. *Test:* tests (access rules are covered).

**20. A few writes are made one at a time in a loop.** All are limited by the
size of a group, so the gain is small:
- joining a group: one friendship per member
  (`src/app/api/invite/[code]/join/route.ts:116-123`);
- merging a placeholder: one feed entry per group
  (`src/app/api/people/[id]/merge/route.ts:54-65`);
- restoring a set of payments: three passes, each asking per payment
  (`src/app/api/settlements/[id]/restore/route.ts:49-80`);
- new group: one membership per person (`src/app/api/groups/route.ts:93-97`);
- deleting your account: one lookup per group you own
  (`src/app/api/identity/account/route.ts:47-55`).
- *Risk:* low. *Test:* existing tests for each, plus a count of database
  calls before and after.

**21. Five database indexes are duplicates** of a unique index that already
covers them: `Person.inviteCode`, and the first column of the unique pairs on
`Membership`, `ExpensePayer`, `ExpenseSplit` and `Friendship`
(`prisma/schema.prisma`). Each costs disk space and a little time on every
write.
- *Risk:* low to medium: a database migration on production (the daily
  backups and R2 copy are in place).
- *Test:* migration on a copy of the test database; timings; full suites.

### E. Looked at, and best left as they are

- **tailwind-merge (9.5 KB on every screen).** It runs in 121 places, almost
  all of them where a screen passes its own style to a component and relies on
  it to win. Removing it risks styles going
  quietly wrong in places no test looks at. Keep.
- **Motion (51 KB on every screen).** Motion can load only the features in use,
  but Divvy uses dragging (panels, swipeable rows), which needs most of them,
  and anything that moved before the rest arrived would jump instead. The
  saving is uncertain and the risk falls on MOTION-SPEC. If you want, it can be
  a measured trial at the very end; it isn't in the plan below.
- **Next.js and React (122 KB).** The framework's fixed cost.
- **lucide-react icons.** Already loaded one icon at a time.

---

## The plan

One small PR per line, each with before-and-after numbers from the same
sitting, merged only when CI's `verify` and `image` are green, then main's run
confirmed. Each PR also gets a `/code-review` at medium before it is opened.

### Phase 1: room on the group page and Home (start now)

Ordered from least to most risky. Expected savings are estimates.

| PR | Items | Expected saving |
|---|---|---|
| 1. Draw QR codes with a library fetched after load | 1 | Group 9.7 KB, Friends 9.7 KB |
| 2. Error and "Nothing here" screens with their own small pieces | 3 | 5 to 6 KB, every screen (measured: 2.1 KB, PERF-BASELINE 20) |
| 3. Sign-up screens only when needed | 2 | 11.6 KB, every signed-in screen (measured: group 8.7 KB, Home 15.6 KB, PERF-BASELINE 21) |
| 4. A group's panels and Insights after load | 4 | Group 10 to 14 KB (measured: 13.6 KB, PERF-BASELINE 23) |
| 5. Home's panels after load | 6 | Home 8.5 KB (measured: 7.2 KB, PERF-BASELINE 24) |
| 6. Add expense panel after load | 5 | 16.8 KB, every screen (measured: Home 20.7 KB, group 14.6 KB, PERF-BASELINE 25) |

MOTION-SPEC section 7 gets a line for each, as NumberFlow's did.

### Phase 2: remove what nothing uses (start now)

| PR | Items |
|---|---|
| 7. Unused components, helpers and exports, and their tests | 7, 8 (done 27 October, with `clearLedgerCache` since #65 had merged; 22 file-only values made private, types left exported; download unchanged to the byte) |
| 8. Unused styles | 9 (done 27 October, plus `.card`, which the audit's check had counted as used because the word "card" appears in comments; styles 12.5 to 12.3 KB) |
| 9. Refreshes that refresh nothing | 10 |
| 10. Drop `date-fns`, move `@types/qrcode` (needs your OK) | 11 |

### Phase 3: one copy of things written twice (start now)

| PR | Items |
|---|---|
| 11. `abs` everywhere, outside the files the Prisma 7 PR changes | 12 |
| 12. One date field helper, the `shown` alias, one attachment limit | 14, 16 (third point), 22 |

### Phase 4: the server (after #64 and #65 merge)

PR #65 changes `src/server/read.ts`, `me.ts`, `access.ts`, `ledger.ts`,
`merge.ts`, `write.ts`, `recurrence.ts`, `src/lib/db.ts` and `prisma/`, so
these wait until it is merged.

| PR | Items | Expected saving |
|---|---|---|
| 13. Four lookups asked in two steps | 17, 16 (fourth point) | Home's request: about 60 to 70 ms of its 99 ms on the test data |
| 14. Home's request stops repeating work | 18 | a few ms |
| 15. One rule for unread, one builder for group details | 15 | an extra refresh when opening some groups |
| 16. Server-side `abs`, one shared sort, read.ts tidy-ups | 12, 13, 16 | |
| 17. Group access in one question | 19 | under 1 ms per group request |
| 18. Writes in one go instead of one at a time | 20 | small |
| 19. Remove duplicate database indexes | 21 | smaller database, slightly faster writes |

### Not in this audit

- Smoothness: nothing here should make it worse, and loading less at start-up
  may shorten the pause when a group opens (PERF-BASELINE 17, 86 to 97 ms).
  That is unproven; phase 1's PRs record the flows they touch.
- The group-size session's change to `size-report.mjs` (raw size next to
  compressed) is separate and not repeated here.
