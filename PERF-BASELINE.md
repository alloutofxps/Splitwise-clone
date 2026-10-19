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
  compressed, or the bytes over the wire), so the limits need restating in
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

## 6. Waiting on a decision

The download limits in MOTION-SPEC section 7. They were meant as "today
plus 15 KB". Measured this way, before the motion work plus 15 KB is:

- Home, scripts to show it: 311.7 KB (now 303.0, so 8.7 KB left)
- A group: 333.2 KB (now 323.7, so 9.5 KB left)

The early fetch on Home sits outside that limit because it doesn't delay
Home.
