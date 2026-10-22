# Performance baseline, 20 October 2026

The numbers every upgrade from here is compared against. Measured before any
of the upgrades in the motion follow-up (View Transitions, NumberFlow, launch
screens, the framer-motion update, the paid-debt work).

- **Now:** main at `bb5e664` (app code identical to `4cd996b`, motion phase 5).
- **Before the motion work:** `ceebc95` (redesign phase 5), served from the
  `divvy-before` worktree.
- **Machine:** this Windows laptop, Microsoft Edge driven by Playwright and by
  the chrome-devtools tools. Both apps were production builds served by
  `next start` on the test database.

To repeat a measurement, run the command given under each heading against a
production build, then add a dated section below rather than editing these
numbers.

---

## 1. Download size

`node scripts/size-report.mjs <base-url>`

What a phone downloads on a cold first visit: compressed bytes over the
wire, fresh browser profile, cache off, service worker blocked. Everything
fetched until the page is quiet is counted, and scripts are split into those
needed to show the screen (finished before the page's load event) and those
fetched afterwards for the next screen. Three runs each, identical every
time.

| | Before motion work | Now | Change |
|---|---|---|---|
| Home: scripts to show it | 296.7 KB | 303.0 KB | +6.3 KB |
| Home: scripts fetched early for the next screen | 0 | 44.1 KB | +44.1 KB |
| A group: scripts | 318.2 KB | 323.7 KB | +5.5 KB |
| Styles (every screen) | 11.4 KB | 12.2 KB | +0.8 KB |
| Fonts (every screen) | 29.8 KB | 29.8 KB | 0 |

- The 44.1 KB on Home is the group screen's own code, fetched once Home has
  finished loading so that opening a group doesn't wait for it. It costs
  data, not time to first see Home.
- The compressed figures can move by about 0.6 KB with no code change, so
  compare before and after built in the same folder, and check the
  uncompressed figure (`ScriptRaw`) when a result is close to a limit. See
  section 22.
- The "First Load JS" column `next build` prints is a different measure
  (it leaves some shared pieces out): Home 225 KB, a group 263 KB today.
- MOTION-SPEC section 7 gave "today" as 195 KB and 225 KB with limits of
  210 KB and 240 KB, i.e. today plus 15 KB. Those figures can't be
  reproduced by any method tried here (the build's column, the build files
  compressed, or the bytes over the wire), so the limits were restated in
  this method. See section 6.

## 2. Smoothness

`node scripts/motion-record.mjs <base-url> <out> timing`

Processor slowed 4x. A frame that takes over 25ms is a late frame.

**Read this first:** the test browser drew about 240 frames a second on this
machine (a typical frame took 4.2ms). The recorder's percentage divides late
frames by all frames drawn, so at 240 a second each late frame counts for a
quarter of what it would on a 60Hz phone. The recorder now also reports
`lateShareAt60Hz`, which divides by the frames a 60Hz phone would draw in the
same time. Use that one to compare against the 2% bar.

### Whole flows, share of late frames (as drawn, 240 a second), three runs

| Flow | Before | Now | Longest freeze now |
|---|---|---|---|
| 01 opening | 2.1 / 2.7 / 2.1% | 1.1 / 1.3 / 1.2% | 261 to 326ms |
| 02 Home to a group and back | 1.0 / 1.3 / 0.9% | 0.9 / 0.5 / 0.9% | 96 to 100ms |
| 03 adding an expense | 1.4 / 1.8 / 1.7% | 1.2 / 1.1 / 1.1% | 162 to 171ms |
| 04 settling up | 1.2 / 0.9 / 1.0% | 0.9 / 1.2 / 0.8% | 125 to 138ms |
| 05 a friend's page | 0.5 / 0.4 / 0.6% | 0.5 / 0.5 / 0.3% | 88 to 113ms |
| 06 panels | 0.8 / 0.8 / 0.9% | 0.8 / 0.9 / 0.7% | 129 to 149ms |
| 07 a part payment | 1.1 / 0.9 / 1.3% | 0.9 / 0.9 / 0.6% | 117 to 134ms |
| 08 first run | 0.9 / 0.6 / 0.5% | 0.9 / 1.1 / 0.7% | 104 to 121ms |
| 09 pull to refresh | 0.5 / 0.4 / 0.6% | 0.4 / 0.4 / 0.3% | 129 to 155ms |

### The 2.5 seconds after Save, late frames per 60Hz frames (150 frames)

This is the window MOTION-SPEC's 2% bar is about: the panel leaving and the
money moving.

| Moment | Before | Now |
|---|---|---|
| Adding an expense | 6 / 5 / 6 late, so 4.0 / 3.3 / 4.0% | 2 / 3 / 1 late, so 1.3 / 2.0 / 0.7% |
| Settling up (debt paid off) | 7 / 5 / 6 late, so 4.7 / 3.3 / 4.0% | 5 / 4 / 3 late, so 3.3 / 2.7 / 2.0% |
| A part payment | 5 / 7 / 4 late, so 3.3 / 4.7 / 2.7% | 5 / 3 / 2 late, so 3.3 / 2.0 / 1.3% |

An hour later, the same build on the same machine (now app only, with the
new `lateShareAt60Hz` figure; the browser was drawing 166 frames a second
by then, not 240):

| Moment | After Save, late frames at 60Hz | Whole flow at 60Hz |
|---|---|---|
| Adding an expense | 4.0 / 3.3% | 4.8 / 5.2% |
| Settling up (debt paid off) | 4.0 / 4.0 / 4.0% | 4.3 / 4.3 / 4.1% |
| A part payment | 3.3% | 4.2% |

(The whole flow includes loading the group screen before the moment, which
is where most of its late frames are.)

What this says:

- **Results drift between sittings on this machine,** by one to three late
  frames per moment, which is 0.7 to 2 points. So a before/after comparison
  only counts when both are run in the same sitting, alternating old and
  new, three runs each. Never compare against a number in this file from
  another day; re-run the "before" alongside.
- In the first sitting, where old and new ran side by side, every money
  moment beat the old app. In neither sitting does any of them reliably
  meet the 2% bar at 60Hz. Settling up is the
  furthest from it, which is what upgrade 4e is for. The final verdict is
  still the real Android phone.

## 3. Lighthouse (mobile)

Run with the chrome-devtools `lighthouse_audit` tool, mobile, navigation
mode, signed in to a seeded test account. This tool covers accessibility,
best practices and SEO; speed is measured with traces in section 4.

| Screen | Theme | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| Home | Day | 96 | 100 | 90 |
| Home | Night | 96 | 100 | 90 |
| A group | Day | 95 | 100 | 90 |
| A group | Night | 95 | 100 | 90 |

What it flagged (all go into the audit list, none fixed here):

- **Faint grey text, both themes.** The `text-subtle` colour on paper and
  cards: 3.5 to 3.7 to 1 in Day (`#8a857e`), 3.6 to 4.1 to 1 at Night
  (`#77726b`). The rule asks for 4.5 to 1. Used for captions, "you owe",
  dates, the unselected group tabs and the tab bar labels.
- **White initials on some person colours** in Day: violet 3.8, sand 3.7.
- **Home's avatar link** is named "You" but shows the initials, so speech
  software and what's on screen disagree.
- **Group "Today" heading** skips a level (h3 straight after h1).
- **No meta description** (the SEO point; only matters for the sign-in page).
- **The flow bar's segments** are buttons pretending to be list items.

## 4. Traces of the three moments

chrome-devtools performance traces, phone screen (390 by 844), processor
slowed 4x, network at "Slow 4G", Day theme. "Tap response" is the time from
the tap to the next drawn frame (Interaction to Next Paint; under 200ms is
good). "Blocking" adds up how far each long task ran past 50ms.

| Moment | Tap response | Layout shift | Tasks over 50ms | Longest | Blocking |
|---|---|---|---|---|---|
| Home, cold load | none | 0 | 6 | 169ms | 319ms |
| Opening a group from Home | 70ms | 0 | 3 | 265ms | 438ms |
| Saving an expense | 61ms | 0 | 2 | 238ms | 207ms |
| Settling up (debt paid off) | 34ms | 0 | 3 | 156ms | 213ms |

- Home's main content appeared at 1.65s (Largest Contentful Paint): 0.59s
  waiting for the server, 1.06s drawing.
- The group's content appeared 0.64s after the tap.
- During the settle-up travel, framer-motion re-measures the page mid-frame
  (its `measureScroll` step, 35ms in all). That's the first lead for 4e.
- About 14.6 KB of the scripts is old-browser support that modern phones
  don't need (Lighthouse's "legacy JavaScript").

## 5. Files

Raw recordings, traces (`.json.gz`, open in the browser's Performance
panel) and Lighthouse reports are in `perf-runs/2026-10-20-baseline/`,
which git ignores.

## 6. Download limits

Restated on 20 October 2026 (the person's decision) as before the motion
work plus 15 KB, in this method, rounded:

- Home, scripts to show it: 312 KB (303.0 at the baseline, 305.6 with
  framer-motion 14.4, so 6.4 KB left)
- A group: 333 KB (323.7 at the baseline, 328.3 with framer-motion 14.4,
  so 4.7 KB left)

The early fetch on Home sits outside the limit because it doesn't delay
Home. MOTION-SPEC section 7 carries the same numbers.

---

## 7. Trial: framer-motion 14.1.0 to 14.4.0 (20 October 2026)

Upgrade 4d. Both builds served side by side in one sitting (14.1 on port
3102, 14.4 on port 3100), runs alternating, processor slowed 4x. Raw runs
and a side-by-side video in `perf-runs/2026-10-20-framer-14-4/`.

What changed in the library (its changelog): 14.2 runs `x`, `y` and `scale`
animations on the browser's fast lane (the compositor); 14.3.1 fixes a bug
in that and a drag jump; 14.4 adds a feature Divvy doesn't use. Nothing is
marked as breaking. 14.3.1 and 14.4.0 were both published on 19 October.

**Checks:** type check, lint, 341 unit tests, ui-check (81), ui-features (32)
and pwa-check (36) all pass on 14.4. Frame-by-frame, the motion looks the
same: panels, rows, toasts, nothing growing from a dot.

**Download size:**

| | 14.1 | 14.4 | Room left under the limit with 14.4 |
|---|---|---|---|
| Home, scripts to show it | 303.0 KB | 305.6 KB | 6.4 KB |
| A group | 323.7 KB | 328.3 KB | 4.7 KB |

**Smoothness, late frames at 60Hz, after Save (eight runs each):**

| Moment | 14.1 typical / average | 14.4 typical / average |
|---|---|---|
| Adding an expense | 2.0 / 2.4% | 4.7 / 3.5% |
| A part payment | 2.0 / 1.9% | 3.3 / 3.4% |

Whole flows over three runs each were within noise of each other, slightly
better on 14.4 for opening the app, Home to a group, first run and pull to
refresh.

**Reading:** on this laptop 14.4 adds frequent small hitches after a save
(the single worst freezes are no worse). The likely reason is that the
fast lane hands more to the graphics side, which on this machine is done in
software. On a phone with a real graphics chip it may be the other way
round, so the phone test is the fair judge.

**Decision (the person, 20 October 2026):** adopted for the bug fixes.
Smoothness after a save is to be judged on the real Android phone in
phase 6; if it stutters there too, going back to 14.1 is a one-line change.
The numbers in sections 1 to 4 above are from 14.1; compare future changes
against a fresh 14.4 run in the same sitting.

---

## 8. Motion consistency (20 October 2026)

POLISH-AUDIT items 4, 5, 22 and 23, measured against main at `8a8b25b`
(port 3103) in one sitting, runs alternating, processor slowed 4x. Raw runs
and side-by-side videos in `perf-runs/2026-10-20-motion-consistency/`. The
recorder gained a `10-group-tabs` flow (Expenses, Balances, Insights and
back).

**Download size:** Home 305.6 to 305.7 KB, a group 328.4 to 328.7 KB, styles
12.3 to 12.2 KB. No real change.

**Late frames at 60Hz:**

| Moment | Before | After |
|---|---|---|
| Group tabs, 2.5s after the first tap (three runs) | 2.7 / 5.3 / 3.3% | 2.7 / 2.7 / 4.7% |
| Panels, whole flow (three runs) | 3.7 / 3.0 / 3.5% | 3.3 / 3.4 / 3.1% |
| Settling up, after Save (eight runs) | typical 3.3%, average 3.2% | typical 2.7%, average 2.9% |

The longest freeze switching tabs went from up to 275ms to about 185ms. In
two of the eight settle-up runs the longest single freeze after Save was
longer (192 and 242ms against at most 142ms before); the share of late
frames was no worse.

---

## 9. Small design fixes (20 October 2026)

POLISH-AUDIT items 9, 10, 25 and 28. Download size after them: Home 306.6 KB
of scripts to show it (5.4 KB under the limit), a group 329.4 KB (3.6 KB
under). The welcome-shaped opening outline and the label placement cost
about 0.9 KB and 0.7 KB. The room left matters for NumberFlow (4b).

---

## 10. The row travelling into the header (20 October 2026)

Upgrade 4a (POLISH-AUDIT item 6). Raw runs and side-by-side videos in
`perf-runs/2026-10-20-row-travel/`. The recorder gained an `11-group-row`
flow, which taps the group's own row in Home's Groups list (`02` taps the
first link naming the group, usually a "Needs you" row, which doesn't
travel).

**Native view transitions, measured first:** Next.js 15.5's
`experimental.viewTransition` switches the app to React's experimental
build. On its own, before any animation, that took Home to 319.3 KB and a
group to 342.0 KB (+12.7 and +12.6 KB), over both limits, so it was dropped.

**The hand-built travel, against main `36753ff` in one sitting:**

| | Before | After |
|---|---|---|
| Home, scripts to show it | 307.1 KB | 308.0 KB (4.0 KB under the limit) |
| A group | 329.6 KB | 330.7 KB (2.3 KB under) |
| Opening a group and back, whole flow at 60Hz (five runs) | typical 3.1% | typical 3.2% |
| The 2.5s after the tap (five runs) | typical 4.7% | typical 4.7% |
| Longest freeze after the tap | 96 to 104ms | 96 to 108ms |

With Reduce Motion on, nothing travels. The friend version was checked
frame by frame; it uses the same code.

---

## 11. Rolling digits for the group balance (20 October 2026)

Upgrade 4b. The group's balance rolls its digits (NumberFlow,
`@number-flow/react` 0.6.2, MIT) instead of counting through the numbers.
Raw runs and side-by-side videos in `perf-runs/2026-10-20-rolling-digits/`,
against main `6512053` in one sitting.

**Download size:** NumberFlow is 6.1 KB compressed (7.0 KB with its request),
fetched after the page has loaded, so it sits outside the limit.

| Scripts to show it | Before | After | Limit | Room left |
|---|---|---|---|---|
| Home | 308.3 KB | 309.6 KB | 312 KB | 2.4 KB |
| A group | 330.9 KB | 332.3 KB | 333 KB | 0.7 KB |

**Hand-over:** checked frame by frame, in Day and Night. Plain text to
NumberFlow keeps the same size and place (122.8 by 37.5 px). Pixels that
differ are confined to the cents, where NumberFlow sets each digit on its
own (about 0.1% of the header).

**Smoothness, late frames at 60Hz in the 2.5s after Save (five alternating
runs each):**

| Moment | Counting | Rolling, with fade masks | Rolling, masks off (adopted) |
|---|---|---|---|
| Adding an expense | typical 2.7% | typical 2.0% | not re-run |
| Settling up a debt | typical 1.3% | typical 2.0% | typical 2.0% |
| A part payment | typical 1.3% | typical 4.0% | typical 2.0% |

The longest freezes are the same either way (about 100ms). With masks off,
the spinning digits are clipped at the line instead of fading. Rolling sits
at the 2% bar on this laptop, which draws without a real graphics chip; the
person chose to adopt it and judge smoothness on the Android phone.

---

## 12. iPhone and iPad launch screens (20 October 2026)

Upgrade 4c. 60 images (12 iPhone and 9 iPad screens, iPads both ways up,
Day and Night), 2.6 MB in `public/launch/`. iOS downloads only the one that
fits, when the app is added to the home screen. Scripts are unchanged; every
page's HTML grows from 8.9 to 13.1 KB compressed, because the 60 links are
in each page's head (Next writes them twice: in the HTML and the page data).

---

## 13. Closed panels stop redrawing (20 October 2026)

Upgrade 4e, fix 1 of 5. Every row of a ledger carried its own hidden menu
panel, and the group's settings, invite and confirm panels sat hidden on the
page too. Hidden, they still redrew each time the screen behind them did.
Now a panel exists from the moment it opens until its closing slide ends
(`WhileOpen` in `src/components/ui/sheet.tsx`). Settle up and the expense
detail panel stay on the page, because the Undo in their messages needs
them after they close. Raw runs in `perf-runs/2026-10-20-closed-panels/`,
against main `4b70149` in one sitting.

**Redraws, counted with React's profiler (three runs each, same every time
but for a few):**

| Moment | Panels redrawn, before | After | Everything redrawn, before | After |
|---|---|---|---|---|
| Opening a group | 79 | 11 | 148 | 80 |
| Adding an expense | 113 to 121 | 30 to 31 | 231 to 250 | 159 to 171 |
| Settling up a debt | 90 | 15 | 206 | 131 |
| A part payment | 90 | 15 | 214 | 139 |
| Delete, then Undo | 87 to 94 | 18 to 19 | 170 to 185 | 98 to 108 |

**Longest freeze, CPU slowed 4x (six alternating runs, median):**

| Moment | Before | After |
|---|---|---|
| Opening a group | 95 ms | 88 ms |
| Settling up a debt | 87 ms | 80 ms |
| A part payment | 87.5 ms | 87.5 ms |
| Adding an expense, delete and Undo | none over 50 ms | none over 50 ms |

**Smoothness:** late frames at 60Hz are the same within the noise in all
five recorded flows (add, settle up, payment, group row, panels): for
example 3.6% to 3.9% over the whole settle-up flow either way. The freeze
after Save is mostly the whole screen updating and the Balances tab
appearing; that is fixes 2 to 4.

**Closing still slides:** sampled frame by frame, the settings panel and a
row's menu travel all the way off the bottom before they leave the page.

**Download size:** Home 309.7 KB, a group 332.4 KB of scripts (0.1 KB more
each), under the 312 and 333 KB limits.

**Checks:** types, lint, 353 unit tests, ui-check 81, ui-features 32,
pwa-check 36, all passing.

---

## 14. Panels slide on the browser's own thread (20 October 2026)

Upgrade 4e, fix 2 of 5, and POLISH-AUDIT item 3. A panel's position was
also the value a finger drags, so framer-motion slid it by script, one
frame at a time, on the same thread that is busy saving. The slide is now
on a wrapper of its own as a plain `transform`, which framer-motion hands
to the browser to run by itself; the finger still drags the panel inside.
Raw runs in `perf-runs/2026-10-20-panel-fast-lane/` and
`perf-runs/2026-10-20-closed-panels/` (the checking scripts), against main
`5854549` in one sitting.

**Which thread runs the slide** (`lane-check.mjs`, the settings panel):

| | Before | After |
|---|---|---|
| Script writes to the panel's position, opening | 77 | 3 |
| Script writes to the panel's position, closing | 61 | 3 |
| The slide is a browser animation | no | yes |

**Nothing else changed** (`panel-check.mjs`, phone and desktop sizes):
the settings, expense, add, settle-up and menu panels, and a panel on a
panel, are pixel-identical to before, at the same size and place, and slide
along the same path. Dragging a panel down and letting go now leaves from
where the finger let go; before, it went straight down too, and an early
version of this change had it rise about 18px first, which is fixed.

**Reduce Motion:** panels used to jump in and out with only the backdrop
fading. They now fade in and out in 150ms where they sit, as MOTION-SPEC
section 6 asks.

**Smoothness and freezes** (six alternating runs, CPU slowed 4x): the same
within noise. The recorder times the app's own thread, which the slide no
longer uses, so it can't show the gain. Longest freeze after saving a
payment 105.5 to 92.5 ms, settling up 91.5 to 86 ms, opening a group 100
to 99 ms; delete and Undo has a few pauses of 50 to 59 ms on both sides.
Frame-by-frame videos with the CPU slowed (`SLOW=1`, new in
`motion-record.mjs`) paint the same 45 frames in the half second after
saving a payment either way: on this laptop the old slide wasn't visibly
held up, and the difference is for slower phones, where saving and the
slide meet.

**Download size:** Home 309.8 KB, a group 332.5 KB of scripts (0.1 KB more
each), under the 312 and 333 KB limits.

**Checks:** types, lint, 353 unit tests, ui-check 81, ui-features 32,
pwa-check 36, all passing.

---

## 15. Only the ledger rows that changed redraw (20 October 2026)

Upgrade 4e, fix 3 of 5. Saving anything redrew the ledger, and every row in
it redrew too, even the ones that hadn't changed: each was handed new "open
me" instructions every time, and the add-expense helper every row reads was
a new object whenever the app's outer frame redrew (the add panel opening
or closing). Rows are now kept as they are unless their own entry changes
(`LedgerExpenseRow` and `LedgerSettlementRow` in
`src/components/group/ledger.tsx`), and the helper stays the same object
(`src/components/app-gate.tsx`). Raw runs in
`perf-runs/2026-10-20-unchanged-rows/`, against main `90be37d` in one
sitting.

**Redraws, counted with React's profiler (three runs each):**

| Moment | Rows redrawn, before | After | Everything redrawn, before | After | Drawing the open tab, before | After |
|---|---|---|---|---|---|---|
| Opening a group | 20 | 4 | 80 | 64 | 74 ms | 55 ms |
| Adding an expense | 35 to 40 | 6 | 159 to 171 | 111 to 118 | 82 ms | 38 ms |
| Settling up a debt | 12 | 3 | 131 | 106 | 70 ms | 65 ms |
| A part payment | 12 | 3 | 139 | 114 | 78 ms | 59 ms |
| Delete, then Undo | 19 to 26 | 7 | 101 to 118 | 80 to 90 | 69 ms | 37 ms |

The test group has a handful of expenses; a real group with dozens saves
proportionally more. Drawing times are from the profiling build with the CPU
slowed 4x, one run each.

**Smoothness, late frames at 60Hz in the 2.5s after Save (six alternating
runs, median):**

| Moment | Before | After |
|---|---|---|
| Adding an expense | 2.0% | 1.3% |
| Settling up a debt | 2.4% | 2.0% |
| A part payment | 2.4% | 1.3% |

All three are now at or under the 2% bar. The longest freeze is about the
same (settling up 87 to 81.5 ms, a part payment 90 to 89.5 ms, opening a
group 98 to 99 ms): that one is the Balances tab appearing and the whole
screen updating after Save, which is fix 4.

**Download size:** Home 309.7 KB, a group 332.6 KB of scripts, under the
312 and 333 KB limits (a group has 0.4 KB of room left).

**Checks:** types, lint, 353 unit tests, ui-check 81, ui-features 32,
pwa-check 36, all passing. Tapping each row still opens that expense.

---

## 16. A saved panel starts leaving before the work its save sets off (20 October 2026)

Upgrade 4e, fix 4 of 5. When the server answered a save, three things ran
in one go before the panel could even start to leave: marking the saved row
as confirmed (the whole screen redrew), building the Balances tab, and the
close itself, which redrew the open tab because the group screen holds
which panels are open. Now the first two wait until the panel has started
leaving (`whenPanelLeaving` in `src/components/ui/stage.ts`, two frames
after the close), and the group's three tabs only redraw when what they
show changes. The beat the money waits for is still set at once, so the
order on screen is unchanged. Raw runs in `perf-runs/2026-10-20-after-save/`,
against main `c79bfb2` in one sitting.

**From the server's answer to the panel starting to leave**, CPU slowed 4x
(`leave-check.mjs`, six alternating runs, median and range):

| Moment | Before | After | Runs with a long task first, before | After |
|---|---|---|---|---|
| A part payment | 174 ms (118 to 236) | 99 ms (84 to 131) | 6 of 6 | 0 of 6 |
| Adding an expense | 114 ms (94 to 147) | 88 ms (84 to 100) | 0 of 6 | 0 of 6 |
| Settling a whole debt | 245 ms (122 to 354) | 163 ms (96 to 241) | 6 of 6 (up to 241 ms) | 4 of 6 (up to 70 ms) |

What's left in settling a whole debt is two things, for fix 5: the instant
update made when Save is tapped (the debt leaving the screen) sometimes
still running when this laptop's very quick server answers, and, in the
same task that starts the slide, everything that watches whether a panel
is open being told it has closed.

**Smoothness, late frames at 60Hz in the 2.5s after Save** (six alternating
runs; this sitting ran higher than earlier ones on both sides):

| Moment | Before | After |
|---|---|---|
| Adding an expense | 3.7% | 4.0% |
| Settling up a debt | 5.0% | 7.0% |
| A part payment | 4.0% | 4.0% |

The work after Save now comes in more, smaller pieces while the panel
slides on the browser's own thread; the recorder times the app's thread, so
it counts each piece. The longest freeze is shorter: settling up 89.5 to
70 ms, a part payment 95 to 78.5 ms.

**Order on screen** (`payment-strip.png`, frames at set times after Save,
CPU slowed 4x): the same before and after. The panel leaves, Balances
shows, the dot travels, the balance rolls from €31.40 to €28.40.

**Download size:** Home 310.0 KB, a group 332.7 KB of scripts, under the
312 and 333 KB limits (a group has 0.3 KB of room left).

**Checks:** types, lint, 353 unit tests, ui-check 81, ui-features 32,
pwa-check 36, all passing.

---

## 17. Re-tracing opening a group and settling up (21 October 2026)

Upgrade 4e, fix 5 of 5, and POLISH-AUDIT items 7 and 8. Re-traced with
React's profiler on main `c577098` (fixes 1 to 4 in place), then measured
against it in one sitting. Raw runs in `perf-runs/2026-10-21-open-group/`.

**What's adopted:** only what is waiting on a panel listens to panels
opening and closing (`useStageWhile` and `useStageCovered` in
`src/components/ui/stage.ts`). Before, every row's arrival wrapper, the
balance figure and the app's outer frame redrew each time any panel opened
or closed, or a save set the money's timing, in the same task that starts a
closing panel's slide. Now a row listens only while it is waiting to land,
the figure only while it has a new number to show, and the frame only to
whether a panel is open.

| | Main | After |
|---|---|---|
| Arrival wrappers redrawn, settling up (profiler) | 15 | 7 |
| Arrival wrappers redrawn, delete and Undo | 17 to 19 | 11 to 13 |
| Panel starts leaving after the answer, settling a whole debt | 130 ms | 117 ms |
| The same, a part payment | 89.5 ms | 80.5 ms |
| The same, adding an expense | 87.5 ms | 73 ms |
| Late frames in the 2.5s after Save, adding an expense (eight runs) | 1.7% | 2.0% |
| Late frames after Save, settling up (six runs) | 6.0% | 5.0% |

The timings are within noise on this laptop; the test group has a handful
of expenses, and the redraws saved grow with every row a real group has.
Settling a whole debt still pauses before the panel moves in some runs (3
of 6, up to 74 ms; main 2 of 6, up to 65 ms): that is the instant update
made when Save is tapped, still running when this laptop's very quick
server answers. On a phone's network the answer comes later.

**What was tried and dropped:** drawing a group's tab content a moment
after the rest of the screen (`useDeferredValue`), to let the header's
travel in from Home start sooner. It did: the screen showed at +300 ms
instead of +400 ms (CPU slowed 4x). But the Expenses list then sat empty
for about 200 ms while the header flew in, and appeared at +500 ms, later
than before (`open-strip.png`). A blank, then a list popping in, is worse
than the pause it removes.

**Opening a group** is left at one pause of 86 to 97 ms, 0.2s after the
tap: the whole screen's first draw (about 70 ms) and its first layout
(about 58 ms) on the slowed profile. The baseline's 265 ms (section 4)
was measured with a slow network too, so the two aren't like for like.

**Download size:** Home 310.0 KB, a group 332.8 KB of scripts, under the
312 and 333 KB limits (a group has 0.2 KB of room left).

**Checks:** types, lint, 353 unit tests, ui-check 81, ui-features 32,
pwa-check 36, all passing.

---

## 18. Before and after the motion work (21 October 2026)

Phase 6. Before: main at `ceebc95`, served from the `divvy-before` copy.
After: main at `9dabd1d`, with every change since. Raw recordings, timings
and videos in `perf-runs/2026-10-21-phase6/`; the evidence page puts them
side by side.

**Smoothness, every flow** (`motion-record.mjs` timing, CPU slowed 4x,
three alternating runs, median late frames at 60Hz):

| Flow | Whole flow, before | After | 2.5s after Save, before | After |
|---|---|---|---|---|
| Opening the app | 5.8% | 3.1% | | |
| Home to a group | 4.0% | 3.1% | | |
| Adding an expense | 5.2% | 4.8% | 4.7% | 3.3% |
| Paying a debt off | 3.9% | 3.8% | 4.7% | 4.0% |
| A friend's page | 1.7% | 1.4% | | |
| Panels | 2.8% | 2.6% | | |
| A payment | 3.7% | 3.2% | 4.7% | 2.0% |
| First run | 2.4% | 2.7% | | |
| Pull to refresh | 1.5% | 1.2% | | |
| The three tabs | 3.7% | 3.9% | 3.3% | 2.7% |
| A group row and back | 2.3% | 2.2% | 3.3% | 3.3% |

Two flows are under the 2% bar on this laptop; the phone test
(`PHONE-TEST.md`) gives the verdict.

**Download size** (`size-report.mjs`):

| | Before | After | Limit |
|---|---|---|---|
| Home, scripts to show it | 296.7 KB | 310.4 KB | 312 KB |
| A group, scripts to show it | 318.2 KB | 333.0 KB | 333 KB |
| A group, after load | 0 KB | 7.0 KB | |
| Styles | 11.4 KB | 12.3 KB | |
| Home's page itself (HTML) | 7.7 KB | 13.7 KB | |

A group page is exactly at its limit. Home's HTML grew with the launch
screens (section 12) and the link previews.

**Reduce Motion:** every flow re-recorded with `REDUCE=1` on both sides.
Nothing slides, travels or rolls. Panels fade in 150ms where they sit
(before, they vanished in one frame); new rows fade into place once the
panel has gone; balances show their new value.

**Videos:** a before/after pair for each of the 11 flows, at quarter and
real speed, made frame by frame (`motion-compare.mjs`).

## 19. The QR code library after load (21 October 2026)

CODE-HEALTH-AUDIT item 1. Before: main at `08b9669`. After: the same plus
the change. Both built one after the other in the same linked worktree and
measured three times each, identical every run (`size-report.mjs`). A linked
worktree reads about 0.5 KB higher than the main folder for the same code
(main measures 333.0 there), so compare the change, not the totals with
section 18.

| | Before | After | Change |
|---|---|---|---|
| A group, scripts to show it | 333.6 KB | 324.0 KB | -9.6 KB |
| A group, after load | 7.0 KB | 16.5 KB | +9.5 KB |
| Home, scripts to show it | 310.9 KB | 310.8 KB | -0.1 KB |
| Home, after load | 45.5 KB | 45.4 KB | -0.1 KB |

Friends and Account no longer load the library at start either (checked in
the build's page lists; `size-report.mjs` measures Home and a group only).

Checked in the browser (`perf-runs/2026-10-21-qr/qr-check.mjs`): the group's
Invite code appears 7ms after the tap once the page has loaded, when tapped
before the page has finished loading, and offline after one visit; My code on
Friends and Add another device on Account still show theirs. ui-check (81),
ui-features (32) and pwa-check (36) all pass. No recorded flow opens a QR
panel, so smoothness isn't affected.

## 20. The error and "Nothing here" screens without primitives (21 October 2026)

CODE-HEALTH-AUDIT item 3. Before: main at `998ac1a`. After: the same plus
the change. Measured as in section 19 (same linked worktree, one after the
other, three runs each, identical every run).

| | Before | After | Change |
|---|---|---|---|
| A group, scripts to show it | 324.0 KB | 321.9 KB | -2.1 KB |
| Home, scripts to show it | 310.8 KB | 308.7 KB | -2.1 KB |
| After load (both) | unchanged | unchanged | 0 |

The audit estimated 5 to 6 KB. The rest stays because the build still gives
the error screen its own copy of anything small it shares with the pages (the
doodle, the button styles, the buzz and the icon code, about 2 KB together).
Removing that too would mean copying code, or fetching the error screen only
when an error happens, which could fail exactly when the network is the
problem; neither is worth 2 KB.

Pixel comparison (`perf-runs/2026-10-21-boundaries/`, main against the
branch, phone width, Day and Night): "Nothing here", Offline, the error
screen and a settled group's doodle are identical, 0.00% of pixels. The
pull-to-refresh doodle ends up with the same four classes as before. ui-check
(81), ui-features (32) and pwa-check (36) pass.

## 21. The sign-up screens only when needed (21 October 2026)

CODE-HEALTH-AUDIT item 2. Before: main at `ced5932`. After: the same plus
the change. Measured as in section 19.

| | Before | After | Change |
|---|---|---|---|
| A group, scripts to show it | 321.9 KB | 313.2 KB | -8.7 KB |
| A group, after load | 16.5 KB | 16.5 KB | 0 |
| Home, scripts to show it | 308.7 KB | 293.1 KB | -15.6 KB |
| Home, after load | 45.4 KB | 52.3 KB | +6.9 KB |

Home gains more than the sign-up screens themselves because the welcome
screen draws a money map too: the map, the travel and the rolling-digit code
used to load with every screen for its sake, and now come only with the group
screen's code, which Home fetches early once it has loaded. That is the 6.9 KB
moving to after load.

Checked in the browser (`perf-runs/2026-10-21-signup/signup-check.mjs`): a
first visit shows the welcome (407ms locally) and fetches the sign-up screens
once; the opening's outline is taken off the screen once, by the welcome, so
its drawing never restarts; Home, a group, Friends and Account never fetch
them when signed in; an expired sign-in lands on the welcome; if they can't be
fetched, "Couldn't reach Divvy" shows. ui-check (81, including a reload on
the recovery key step), ui-features (32) and pwa-check (36, the whole sign-up)
pass.

Smoothness (`motion-record.mjs` timing, CPU slowed 4x, main and the change
served side by side, three alternating runs, late frames at 60Hz):

| Flow | Main | Change |
|---|---|---|
| Opening the app | 3.1, 3.7, 3.7% (median 3.7%) | 3.7, 3.7, 3.1% (median 3.7%) |
| Home to a group | 3.2, 2.8, 3.7% (median 3.2%) | 2.6, 2.8, 2.8% (median 2.8%) |

## 22. Why the same code can measure 0.6 KB apart (21 October 2026)

Main at `08b9669` measured 333.6 KB for a group page, over the 333 KB limit,
where section 18 had recorded 333.0 KB for the same app code. No code or
package had changed. The difference is where the app was built: section 18's
build was made in the main folder, the 333.6 one in a worktree. Measured in
one sitting, the two builds alternating, three runs each, identical every
run:

| Same code (`08b9669`) | Main folder | Worktree | Difference |
|---|---|---|---|
| A group, scripts to show it, compressed | 333.0 KB | 333.6 KB | +0.6 KB |
| The same, uncompressed (`ScriptRaw` minus `ScriptRawAfterLoad`) | 982.9 KB | 982.8 KB | -0.1 KB |
| Home, scripts to show it, compressed | 310.4 KB | 310.9 KB | +0.5 KB |
| The same, uncompressed | 910.0 KB | 909.9 KB | -0.1 KB |

**Why:** the build gives every piece of code an internal number, worked out
from the names of the files involved, including where the build tool itself
sits. In another folder, or after unrelated changes to the server's code,
those numbers come out different, and the files compress a little better or
worse. The app's biggest shared file is 174,444 bytes in one build and
174,446 in the other, yet 46,368 and 46,734 bytes compressed. The Prisma
session saw the same wobble between two fresh installs whose only
difference was server code, so it isn't the worktree's linked
`node_modules` (section 19's guess); turning off link-following in the
build changed nothing either.

**What was ruled out:** the move to `motion` (#62). The commit before it,
`ca63855`, measures 333.6 KB in the worktree and 333.0 KB in the main
folder too, and its shared files have the same fingerprints as main's in
each folder.

**Which figure counts:** production is built in Docker, in its own folder
with its own installed packages, like the main folder. But the wobble can
go either way after any change, so treat a compressed result within about
0.6 KB of a limit as a tie and look at the uncompressed figure: it only
moves when code really does.

**Change:** `size-report.mjs` now also reports `ScriptRaw` and
`ScriptRawAfterLoad`, the same scripts uncompressed (and both sizes per
script with `DETAIL=1`). The compressed figures it prints are unchanged.

**Then,** main at `998ac1a` (after section 19, before section 20), built in
the worktree: a group 324.0 KB compressed (959.4 KB uncompressed), Home
310.8 KB (909.9 KB), three runs, identical.

## 23. A group's panels and Insights after load (21 to 22 October 2026)

CODE-HEALTH-AUDIT item 4. Before: main at `178a200`. After: the same plus
the change. Measured as in section 19.

| | Before | After | Change |
|---|---|---|---|
| A group, scripts to show it | 313.2 KB | 299.6 KB | -13.6 KB |
| A group, after load | 16.5 KB | 32.9 KB | +16.4 KB |
| Home, scripts to show it | 293.1 KB | 293.1 KB | 0 |
| Home, after load | 52.3 KB | 55.1 KB | +2.8 KB |

Settings (with Recurring, Usual split and Merge), Invite, Settle up and the
Insights tab are one file fetched once the page has loaded. Split into four
files they compressed to 7.7 KB more in total than inside the page's own file
(the same code: compression works better on one large file); one file costs
2.8 KB more, which is the whole of the extra data a cold visit now pays, after
load.

Checked in the browser (`perf-runs/2026-10-22-panels/panel-check.mjs`), main
and the change side by side, two alternating rounds: every panel and Insights
opens 30 to 65ms after the tap on both, whether tapped once the page has
loaded or before (fonts held back so the load event is late); arriving with
`?open=settle` opens Settle up. On a slow connection a tap before the page has
loaded would wait for the panels' file (16.4 KB); locally that can't be seen.
The QR check (section 19) passes again, as the QR library now uses the same
helper. ui-check (81), ui-features (32) and pwa-check (36) pass.

Smoothness (`motion-record.mjs` timing, CPU slowed 4x, side by side,
alternating runs, median late frames at 60Hz; three runs, five for Settle up
and Panels):

| Flow | Main | Change |
|---|---|---|
| Home to a group | 2.8% | 2.8% |
| Paying a debt off | 4.0% (after Save 4.0%) | 4.1% (after Save 4.0%) |
| Panels | 2.9% | 2.8% |
| A payment | 4.0% (after Save 2.0%) | 3.2% (after Save 2.7%) |
| The three tabs | 4.0% (after Save 3.3%) | 3.9% (after Save 3.3%) |

No change beyond run-to-run spread (a payment's after-Save ran 2.0 to 4.0% on
main and 2.0 to 4.7% with the change).
