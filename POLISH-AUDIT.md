# Polish audit, 20 October 2026

One list from five read-only reviews, checked against the code and the real
screens, with anything that conflicts with MOTION-SPEC.md or DESIGN-PLAN.md
dropped (see the end).

**Status:**

- **Fixed in the accessibility and wording PR:** items 1, 2, 11 to 18, 20
  and 21. Every text element on Home, a group (all three tabs), Activity, You
  and Friends now passes 4.5:1 in both themes, checked in the browser.
- **Fixed in the motion consistency PR:** items 4, 5, 22 and 23.
- **Fixed in the small design PR:** items 9, 10, 25 and 28.
- **Done in upgrade 4a:** item 6 (the row travelling into the header).
- **Done in upgrade 4e:** item 3 (panels now slide on the browser's own
  thread; PERF-BASELINE section 14). Item 7 was measured and needs no
  change: deleting a row and Undo had no task over 50ms in any 4e run.
  Item 8 was traced: opening a group has one pause of 86 to 97ms left
  (the screen's first draw and layout; drawing the list later was tried
  and dropped), and after Save on an expense, nothing over 50ms
  (PERF-BASELINE sections 13 to 17).
- **Done after 4e:** item 24 (the busy button's line is in the spec, and is
  a still line with Reduce Motion).
- **Item 19:** waits for the phone test.
- **Everything else:** still open.

**Where each finding came from:**

- **[Lighthouse]:** the mobile audits in PERF-BASELINE.md.
- **[Trace]:** the performance traces in PERF-BASELINE.md.
- **[Animations]:** the improve-animations review, using the
  review-animations checklist too. That skill can only be started by the
  person, so its checklist was applied by hand.
- **[Design]:** the impeccable critique and audit, done by hand from its
  checklists and Day and Night screenshots of every main screen. Its own
  helper program refused to download because its file couldn't be
  verified, and it wasn't forced.
- **[Guidelines]:** the web-interface-guidelines rules.
- **[Motion]:** the Motion library's own best-practices. Its scored
  MotionScore audit needs Motion+ and wasn't used.

## A. Fix first

These affect reading the app, the smoothness of the money moments, or
something the spec promises.

1. **Grey caption text is too faint, in both themes.** [Lighthouse, Design]
   - **Where:** the `text-subtle` colour. It's used for captions, "you
     owe", dates, the unselected group tabs and the tab bar labels.
   - **Why:** it measures 3.5 to 3.7 against paper in Day and 3.6 to 4.1 at
     Night, where the reading-comfort rule asks for 4.5. That's one colour
     value per theme.
2. **White initials on some person colours are too faint in Day.** [Lighthouse]
   - **Where:** the violet and sand avatars, at 3.8 and 3.7.
3. **Panels move on the busy main thread.** [Motion, Animations, Trace]
   - **Where:** `src/components/ui/sheet.tsx` 376 to 389. A panel's position
     is a value the code drives by hand (for dragging) and also animates.
     The Motion docs say that combination can't use the fast lane.
   - **Why:** a panel leaves at the very moment the app is saving, so it
     competes with that work. The settle-up trace also shows framer-motion
     re-measuring the page mid-animation (35ms, its `measureScroll` step).
   - **Plan:** prime suspects for the late frames in settle-up and part
     payments. Belongs to upgrade 4e.
4. **The page behind a panel comes forward on the "leaving" curve.** [Animations]
   - **Where:** `src/components/app-shell.tsx` 143.
   - **Why:** that curve starts slowly and stops abruptly. The page isn't
     leaving, it's coming back, which the spec's "in place" curve is for.
5. **Expenses / Balances / Insights don't move as the spec says.**
   [Animations, spec check]
   - **Where:** `src/app/(app)/groups/[id]/page.tsx` 221 to 232.
   - **Why:** the spec says the content slides with the underline (250ms).
     The code fades the old tab out, waits, then fades the new one in,
     which leaves a short blank moment.
6. **The tapped row travelling into the group's header was never built.**
   [spec check]
   - **Why:** the spec (sections 1 and 4) promises it. Opening a group today
     is just the slide. This is upgrade 4a.
7. **Deleting a row animates its height,** which re-lays-out the page every
   frame. [Animations, Motion]
   - **Where:** `src/components/ui/arrival.tsx` 84.
   - **Why:** that same cost was removed from arriving rows because it
     doubled the stutter. It needs measuring for delete and Undo.
8. **Long freezes in two moments.** [Trace]
   - **What:** one 265ms freeze while a group opens, and one 238ms freeze
     after Save on an expense, on the slowed phone profile.
   - **Plan:** to be traced to their cause during 4a and 4e.
9. **A newcomer first sees the wrong screen's outline.** [Design]
   - **What:** before the welcome screen, the loading outline is shaped like
     a signed-in Home, with its lists and the tab bar. Then the welcome
     replaces it.
   - **Why:** the spec says the outline is shaped like the screen that's
     coming.
10. **Amounts overlap on the Balances map.** [Design]
    - **What:** with four people, two labels (€16.40 and €25.20) sit on top
      of each other where the lines cross.

## B. Should fix: accessibility and clarity

11. **The "What was it for?" field shows no outline when reached by keyboard.**
    [Guidelines]
    - **Where:** `src/components/expense/composer.tsx` 414 and 439. The other
      fields have one.
12. **Home's avatar button is named "You" for speech software but shows the
    initials.** [Lighthouse]
13. **A group's date headings ("Today") skip a heading level.** [Lighthouse]
14. **The coloured flow bar's segments are buttons labelled as list items.**
    [Lighthouse]
15. **"1 categories"** on Insights. [Design]
    - **Where:** `src/components/group/charts.tsx` 301.
16. **The Insights summary wraps with a stray "·" at the start of the second
    line.** [Design]
17. **A direct expense with a friend has no "with Ravi" line in Activity.**
    [Design]
    - **Why:** group expenses all show their group, so this row loses its
      context.
18. **Inside a group, no tab in the bottom bar is lit.** [Design]
    - **Why:** you lose your place. Home could stay lit for groups, and
      Friends for a friend's page.
19. **Settle up's amount field takes focus as the panel opens.** [Guidelines]
    - **Why:** on a phone, the keyboard may then cover "How was it paid?"
      and Save. To check on the real phone.
20. **"Who paid · split equally" heads a list of everyone,** not just who
    paid. [Design]
21. **A broken style class on the Search field** (`[&:not(:focus-within)]:`).
    [Guidelines]
    - **Where:** `src/app/(app)/search/page.tsx` 62. Harmless, tidy it.

## C. Polish and consistency

22. **Hand-typed curves and timings outside the shared settings.** [Animations]
    - `src/components/onboarding.tsx` 129: its own curve, 280ms.
    - `src/components/pwa.tsx` 253: the in-place curve for something
      arriving.
    - `src/components/flow/flow-map.tsx` 14, 192 and 198: a copy of the
      curve, 320ms and 240ms from the older design plan.
    - `src/components/offline-banner.tsx` 85: 220ms.
    - `src/components/group/ledger.tsx` 192: 180ms.
    - The older `DURATION` set in `src/components/ui/motion.tsx` 26 and 27.

    Move them all onto the spec's values.
23. **The drawings' dots pop up from nothing** (`scale(0)` in `divvy-pop`,
    `src/app/globals.css` 573). [Animations]
    - **Fix:** starting from about half size reads as more physical. Small,
      and the spec does allow the drawings a little bounce.
24. **The "working" sweep on busy buttons is a loop the spec doesn't list.**
    [Animations, spec check]
    - **Why:** section 5 names only the opening and pull to refresh. It only
      runs while work is happening, so the fix is likely a line in the spec.
25. **New groups get the same default colour.** [Design]
    - **Why:** the little colour disc on each group's icon looks like a
      second "new" dot beside the real unread dot on Home.
26. **About 14.6 KB of script is support for old browsers that phones don't
    need.** [Trace]
    - **Checked on 20 October 2026, and not worth doing.** Telling Next.js
      to build only for the browsers Divvy's styling already needs (Safari
      16.4, Chrome 111, Firefox 128) saved 0.4 KB on Home and 0.3 KB on a
      group. The add-on file Next.js always includes is 0.6 KB compressed.
      Lighthouse's 14.6 KB was an estimate before compression.
    - **Why:** trimming it would free room under the size limit, which
      matters for NumberFlow (4b).
27. **A "Needs you" row on Home swaps abruptly after you've visited a group**
    (noted in the handoff). It could use the same fade as new ledger rows.
28. **Settle up shows suggested amounts in grey,** while Balances shows the
    same amounts in jade with an arrow. [Design]
29. **No page description for link previews** (Lighthouse SEO 90). Only the
    welcome page matters here.
30. **`framer-motion` has been renamed `motion`.** [Motion]
    - **Fix:** the same library under its current name. Not done in the
      14.4 upgrade (4d); it needs the person's OK because it swaps one
      package for another.

## Dropped, and why

- **"Rows should arrive one after another (a stagger)."** The spec says
  lists appear all at once (section 5).
- **"A curve that starts slowly is always wrong."** The spec's leaving curve
  for panels and toasts going away is Material's, and approved. Only item 4
  is kept, where the thing isn't leaving.
- **"Panels over 300ms."** The spec sets 400ms in and 250ms out, and drawers
  are allowed up to 500ms.
- **"Reduce Motion shouldn't cut transitions to nothing."** Section 6 allows
  "the end result".
- **The empty "Version" row.** It's by design: tap to show the version.
- **The group colour disc itself.** DESIGN-PLAN 1.1 asks for it; only the
  shared default colour is kept (item 25).
- Haptics, Vaul, Lenis, React Bits, Rive and Lottie: already ruled out.

## Not checked yet

- A real phone: the final word on items 3, 7, 8 and 19.
- A full keyboard-only pass and a screen-reader pass.
- Very long names and amounts on every screen.
