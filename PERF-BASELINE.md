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
