# Motion and depth spec

Approved 16 October 2026. Evidence and the review pages:

- Spec with slow-motion recordings of the app before this work: https://claude.ai/artifact/KaxPtwkdT5GzXYKTnPuBNo
- The three money moments, prototyped: https://claude.ai/artifact/KfprVZukkHJeiiBGLRQLgu

The yardstick is Apple's Human Interface Guidelines (Motion) and Google's
Material 3 (Motion, Elevation). Where this document gives a number, it came
from one of them unless it says otherwise.

The one rule: **motion explains a change, or it doesn't happen.**

---

## 1. Where each screen sits

Three layers, and every movement agrees with them.

| Layer | What | How you move |
|---|---|---|
| Tabs | Home, Friends, Activity, You | Side by side, no direction. Switch with a fade (old out, new in growing 98% to 100%, 200ms). Nothing slides. |
| One step in | A group, a friend | Slides in 32px from the right with a fade (300ms). Back reverses it (250ms). The row you tapped carries its icon, name and amount into the new header (400ms). |
| Panels | Add expense, Settle up, an expense's details, Split | Rise from the bottom over everything (400ms) and leave downwards (250ms). The screen underneath dims and steps back. A panel opened from a panel makes the first one step back too. |

- The bottom tab bar and the top bar never move during navigation.
- No blank screens between screens. The old screen stays until the new one is
  ready; past 300ms, a still outline shaped like the coming screen, then a
  150ms fade into it.
- Going back returns you to the same scroll position, with nothing reshuffling.

## 2. Depth

Four levels, matching Material's 0 to 3. Used by role, not on every box.
Tokens live in `src/app/globals.css`.

| Level | Used for | Day | Night |
|---|---|---|---|
| 0 Paper | The page | no shadow, `#fafaf8` | no shadow, `#0b0b0a` |
| 1 Card | Groups, friends, lists on the page (`shadow-card`) | white, `0 1px 2px / .05, 0 1px 1px / .03` + hairline | `#141413`, lit top edge `.03`, `0 1px 2px / .5` |
| 2 Raised | Tab bar, a sticky bar once scrolled, a swiped row, toasts, menus (`shadow-raised`, `bg-raised`) | white, `0 2px 4px / .04, 0 6px 16px / .08` | `#1c1c1a`, lit top edge `.05`, `0 6px 16px / .55` |
| 3 Floating | Panels, dialogs, the + button (`shadow-float`, `shadow-sheet`, `bg-elevated`) | white, `0 4px 8px / .06, 0 16px 40px / .14` | `#232321`, lit top edge `.07`, `0 16px 40px / .65` |

At night a shadow barely shows on a dark page, so height is mostly told by the
surface getting a step lighter per level.

Touch moves something exactly one level: a pressed card sinks (loses its
shadow), a dragged row lifts to level 2. Behind a panel the page dims (36% Day,
60% Night).

## 3. Timing and easing

| Curve | Value | For |
|---|---|---|
| Arriving | `cubic-bezier(0.05, 0.7, 0.1, 1)` (Material emphasized decelerate) | Things entering |
| Leaving | `cubic-bezier(0.3, 0, 0.8, 0.15)` (emphasized accelerate) | Things exiting |
| In place | `cubic-bezier(0.2, 0, 0, 1)` (standard) | Things that stay on screen |
| Rolling | `cubic-bezier(0, 0, 0, 1)` | A balance's digits rolling to a new figure |
| Journey | `cubic-bezier(0.4, 0, 0.7, 0.6)` | A payment travelling between two people; still moving when it lands |
| Finger | spring, no bounce, starting at the finger's speed | Anything released from a drag |

| Duration | Used for |
|---|---|
| 0ms | Typing a digit, ticking a box in a list |
| 100ms | Press going down |
| 150ms | Fades, press release, a bar gaining its shadow, the Reduce Motion fallback |
| 200ms | Tab switch, toggles, menus, toasts arriving, a screen leaving |
| 250ms | Panels closing, heights changing, rows collapsing, the group's three tabs sliding |
| 300ms | A screen arriving, a new row landing |
| 400ms | Panels opening, the tapped row becoming the new header |
| 600ms | A balance rolling its digits |
| 700ms | A payment travelling |
| up to 1.2s | The drawn moments. Never blocks a tap. |

Ceiling: anything you trigger more than once a session finishes within 400ms
and can be tapped through. Departures are always shorter than arrivals. No
bounce in the app's own motion; the drawn moments may have a little.

Values: `src/app/globals.css` (`--ease-*`) and `src/components/ui/motion.tsx`
(`EASE_ENTER`, `EASE_EXIT`, `EASE_STANDARD`, `EASE_COUNT` and `DURATION`).
Every animation picks from these rather than typing its own numbers. Only
the finger spring, the payment's journey curve and the drawings' keyframes
are written where they are used.

## 4. Every moment that moves

### Getting around
| Moment | What moves | ms | What it explains |
|---|---|---|---|
| Switching tabs | Fade through, new tab grows 98% to 100% | 200 | Equals; you haven't gone deeper |
| Opening a group or friend | Slide in from the right; the row's icon, name, amount travel into the header | 300 / 400 | You went into the thing you tapped |
| Going back | The same, reversed | 250 | You're back where you were |
| A "Needs you" row is done with | It and the row taking its place cross-fade in the same spot | 150 | That's dealt with; this is next |
| Expenses / Balances / Insights | Content slides with the underline | 250 | They sit side by side |
| Slow load (over 300ms) | Still outline shaped like the screen, then a fade | 150 | Something's coming, and this is its shape |
| Scrolling under a sticky bar | Bar gains a level 2 shadow | 150 | Content is passing underneath |

**The row travelling into the header** (`src/components/ui/travel.ts`):

- **Which rows:** a group's row in Home's Groups list, and a friend's row in
  Friends.
  - The icon (a group's emoji, a friend's avatar), the name and the amount
    fly from the row to the same pieces in the new screen's header.
  - They grow on the way, on the in-place curve, in 400ms.
  - Going back, the header's pieces fly into the row in 250ms.
  - "Needs you" and Activity rows are about an event, not the group, so they
    keep the plain slide.
- **How:** what flies is a copy of each piece laid over the page, so nothing
  clips it and the page's slide doesn't bend its path. The real piece is
  hidden underneath until the copy lands.
- **Smooth while the app is busy:** the copies move by the browser's own animation
  engine, so they keep moving while the new screen is still being drawn.
- **An amount travels only when there is one balance,** so it always lands on
  the same figure.
- **Nothing travels when:**
  - Reduce Motion is on;
  - the new screen took over a second (it showed its outline instead);
  - either end is off screen.
- **Native view transitions were tried first and ruled out** (20 October
  2026). On Next.js 15 they need the experimental React build, which adds
  12.6 KB on its own, over both download limits.

### Touch
| Moment | What moves | ms | What it explains |
|---|---|---|---|
| Pressing a button or a standalone card | Shrinks to 96% (buttons) or 98% (cards), sinks one level (`press-firm`, `press`) | 100 / 150 | The app felt your tap |
| Pressing a row in a list | Darkens a step (`active:bg-surface-2`). Rows don't shrink: one row shrinking inside its card leaves gaps, and system lists don't do it either | 100 | The app felt your tap |
| Swiping a row | Follows the finger, lifted to level 2, lets go at the finger's speed | finger | You're holding this row |
| Pull to refresh (drawn) | Follows the pull, plays while loading, settles | finger | How far to pull, and that it's working |

### Panels
| Moment | What moves | ms | What it explains |
|---|---|---|---|
| A panel opens | Rises with its button bar attached; page dims and steps back to 97% | 400 | It sits on top of where you were |
| A panel closes | Drops away; after a swipe, from where the finger let go | 250 | Gone, and you're back |
| A panel on a panel | The first steps back and dims | 400 | This belongs to the one underneath |
| Keypad makes way for the keyboard | Folds away instead of vanishing | 250 | The pad stepped aside for typing |
| Menus and pickers | Grow from the button that opened them | 200 | This came from that button |
| Toasts | Rise once the panel has gone; fade away | 200 / 150 | Confirmation, once the action is complete |

A panel's rise and drop are run by the browser itself, not by the app's
scripts, so they stay smooth while the app is busy saving
(`components/ui/sheet.tsx`). A panel exists only while it's open or leaving.

### Money
Changes made inside a panel wait for it to leave (`components/ui/stage.ts`),
then play in order: the panel leaves, the change lands, the money rolls.

| Moment | What moves | ms | What it explains |
|---|---|---|---|
| Saving an expense | Panel leaves; the new row opens into its place, lit by a wash that fades over 1.2s; balances roll, starting halfway through the landing | 250 + 300 + 600 | Here's your expense and exactly what it changed |
| Saving a payment | Panel leaves; a dot in the payer's colour carries the money along the line, which shortens behind it; one ring on the payee; balances roll | 700 + 600 | Money went from them to them, and the debt shrank |
| Paying a debt off | As above, then the "paid" moment on the payee (drawn) | up to 1.2s | You're square. Only when a debt reaches zero |
| Deleting, and undo | Row folds away; undo folds it back into the same place | 250 | It left from here and came back here |
| Someone else changes a balance | The amount rolls; the row tints briefly | 600 | This changed while you were looking |

**A balance rolling its digits** (`src/components/ui/rolling-figure.tsx`, the group's balance at the top of the screen):

- **What moves:** each digit that changes spins to its new value, like an odometer; the digits that don't change stay still. The colour, arrow and "You're owed" wording change once the roll lands.
- **How:** NumberFlow (`@number-flow/react`, MIT). It is 6 KB, more than the download limit has room for, so the figure starts as plain text and NumberFlow is fetched once the page has loaded, then takes over showing the same figure. The hand-over is checked to be invisible: the same size and place, with only a fraction of a pixel of letter spacing in the cents.
- **Nothing rolls when:** Reduce Motion is on, NumberFlow hasn't arrived yet, or the browser can't format the currency. The new figure simply appears.
- It replaced counting through the numbers on 20 October 2026.

### Illustrated (drawn in code)
Each is a small set of named states; the app only ever says which state to be in.
They were first drawn in Rive, but Rive's free plan stamps a watermark on
anything with states and its terms put shipping files behind a paid plan, so
all five are drawn in code instead: SVG moved by CSS or the browser's own
animation engine, no player to download.

| Piece | States | The app sends |
|---|---|---|
| Welcome untangle | tangled, untangling, untangled | Progress through the welcome, 0 to 1 |
| Empty states (3) | arrive (an empty list), start (a new account), settled (nobody owes); a tap makes the three hop | Which one, and a tap |
| Paid | hidden, paying, paid, done: a jade disc pops over the payee, a tick draws, six sparks fly, then it fades (1.2s) | "paid" when a debt reaches zero |
| Pull to refresh | resting, pulling (the doodle draws as far as you've pulled), loading (the three take turns to hop), done ("Up to date") | Pull distance 0 to 1, then "loading", "done" |
| App opening | drawing (the logo draws its line from one person to the other), waiting (the two breathe), ready (Home replaces it) | "ready" the moment data arrives |

The opening needs no script at all, so it moves from the very first frame,
before the app has even started.

On iPhone and iPad, opening from the home screen, iOS first shows a launch
image (`public/launch/`, made by `node scripts/launch-screens.mjs`). Each is
the app's own first frame on that device, Day or Night: Home's outline below
the notch, the logo not yet drawn. So the app appears over an identical
picture instead of a white flash, and the drawing starts from there. Re-run
the script after changing Home's outline, the tab bar or the colours.

## 5. What never moves

- Digits while you type an amount.
- Amounts on first load. They show their real value; rolling only happens when a value changes in front of you.
- Lists arriving one row after another. Lists appear all at once.
- Anything on scroll except a sticky bar's shadow. No parallax, no reveal-on-scroll.
- The tab bar and top bar during navigation.
- Anything that loops, bobs or pulses forever. The only loops are the opening, pull-to-refresh and the short line running along a busy button's bottom edge, and only while work is actually happening.
- Error messages shaking. They fade in with a short buzz on the phone.
- Motion as the only signal. Every change also shows in text or colour.
- Waiting for an animation before you can tap.
- Blurred backgrounds behind panels (too costly on Android; a dim does the job).
- Settings, Activity entries and anything you read rather than act on.

## 6. With motion turned off

With Reduce Motion (iPhone) or Remove animations (Android) on, every slide,
scale, travel and roll becomes a 150ms fade or simply the end result. The
drawings show their final still frame. Depth stays: shadows aren't motion.
Panels fade in and out where they sit instead of rising and dropping. A busy
button's running line becomes a still one along its bottom edge.

## 7. Download size

Compressed scripts the phone downloads on a cold first visit, over the wire:
`node scripts/size-report.mjs <base-url>` against a production build. Method
and full numbers in `PERF-BASELINE.md`.

| | Before the motion work (ceebc95) | Today (20 October 2026) | Limit |
|---|---|---|---|
| Home, scripts to show it | 296.7 KB | 309.6 KB | 312 KB |
| A group, scripts | 318.2 KB | 332.3 KB | 333 KB |
| All five drawings, in code (phase 5) | | 1.4 KB (1 KB script, 0.4 KB styles) | 5 KB |

The limits are "before the motion work plus 15 KB", which was always the
intent. They were first written as 210 KB and 240 KB, from "today" figures
of 195 KB and 225 KB whose method wasn't recorded and can't be reproduced;
restated in this method on 20 October 2026. Moving framer-motion from 14.1
to 14.4 added 2.6 KB to Home and 4.6 KB to a group; the row travel and the
rolling digits about 1 KB each. That leaves 2.4 KB on Home and 0.7 KB on a
group. NumberFlow itself (6 KB) is fetched once the group page has loaded, and
so, since 21 October 2026, is the QR code library (9.6 KB), which only draws
when Invite, My code or Add another device opens; that took a group from 333.0
to about 323.4 KB (PERF-BASELINE 19). The error and "Nothing here" screens
stopped carrying their own copies of the shared buttons the same day, 2.1 KB
off every screen, which leaves a group about 321.3 KB and Home about 308.2 KB
(PERF-BASELINE 20). Then the sign-up screens stopped loading for people who
already have an account: a group about 312.6 KB, Home about 292.6 KB
(PERF-BASELINE 21). A group's panels (Settings, Invite, Settle up) and the
Insights tab now come after load too, through one shared helper
(`components/ui/after-load.tsx`): a group about 299.0 KB (PERF-BASELINE 23).
Home's New group, Join and Import panels the same way: Home about 285.8 KB
(PERF-BASELINE 24).
Home also fetches the group screen's code (44 KB) once it
has loaded, so opening a group doesn't wait; that doesn't delay Home and
sits outside the limit.

Rive would have cost about 460 KB: a 340 KB player plus around 120 KB of
drawings.

## 8. Proof

- Smoothness: under 2% of frames over 25ms with the processor slowed 4x
  (`node scripts/motion-record.mjs <url> <out> timing`), and on a real
  Android phone. Read `lateShareAt60Hz`: it counts against the frames a 60Hz
  phone would draw, so a fast desktop screen doesn't flatter the result.
- Reduce Motion: every flow re-recorded with `REDUCE=1`; nothing slides or scales.
- Before and after: `scripts/motion-compare.mjs` builds side-by-side videos,
  frame-exact (`scripts/motion-video.mjs`).
- A five-person test script with questions and pass marks.

## 9. References

21st.dev is a reference only. A component worth borrowing is rebuilt with
Divvy's colours and the depth levels above, with its licence and size checked
first.
