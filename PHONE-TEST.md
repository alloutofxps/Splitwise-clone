# Divvy: the phone test

A checklist for trying Divvy on a real Android phone. The laptop
measurements (PERF-BASELINE.md) slow the processor down to imitate a phone,
but only a real one gives the final word on smoothness. About 20 minutes.

## Before you start

- **The live site must be up to date.** Open
  https://divvy.up.railway.app/api/health on the phone. The `build` it shows
  should match the latest merge on GitHub (the first 12 letters of the
  commit). If it doesn't, the newest work isn't there yet.
- Use an Android phone in the middle of the price range if you can: a
  flagship hides problems.
- Open Divvy in Chrome, or from the home screen if it's installed. Sign in
  to a test account, set up as in TEST-SCRIPT.md ("Before you start"), so
  there's a group with a few people and expenses.
- Have somewhere to jot notes: for each item, "fine", or what you saw.

## What to try

For each one, do it twice: once just using it, once watching closely.

**Getting around**
1. On Home, tap the trip in Groups. The name and amount should fly up into
   the header as the screen slides in. Any stutter or jump?
2. Go back. They should fly back into the row. If "Needs you" changes, the
   rows should cross-fade in place, with nothing below moving.
3. Switch between Expenses, Balances and Insights. The content should slide
   with the underline.

**Panels**
4. Open "Add an expense", then close it by swiping it down from the handle.
   It should follow your finger and leave from where you let go.
5. Open it again and close it with the X. It should slide away smoothly,
   straight away, with no pause first.
6. While adding an expense, open the split options. The expense panel
   should step back and dim behind it.
7. Settle up: check whether the keyboard covers "How was it paid?" or the
   Save button when the panel opens (POLISH-AUDIT item 19).

**Money moments** (these are the ones most worth watching)
8. Add an expense and save. The panel leaves, the new row appears with a
   soft highlight, then the balance at the top rolls its digits to the new
   value. Is the order clear, and is the roll smooth?
9. Settle up part of a debt. The panel leaves, Balances shows, a dot travels
   along the line from the payer, the line shortens, the balance rolls.
10. Settle up a whole debt. As above, then the small "paid" drawing.
11. Delete an expense, then tap Undo. It should fold away and fold back in
    the same place.

**With motion turned off**
12. Turn on "Remove animations" (Settings, Accessibility). Repeat 4, 8 and
    9. Nothing should slide, travel or roll: panels fade in and out, the new
    figure simply appears. A busy button shows a still line along its
    bottom instead of a moving one. Turn the setting back off afterwards.

## What to note

For anything that isn't "fine", note:
- which item, and what you were doing;
- what you saw: a pause, a stutter, a jump, something in the way, or
  something you didn't understand;
- whether it happened every time or once.

"Slow" and "fussy" are both useful words here. So is "I didn't notice
anything", which is the goal for most of these.

## Optional: a recording of the money moments

If you'd like numbers as well as impressions, with the phone plugged into a
computer by USB:
1. On the phone: Settings, About phone, tap "Build number" seven times to
   turn on Developer options; then in Developer options, turn on "USB
   debugging".
2. On the computer, open Chrome and go to `chrome://inspect`. The phone's
   Divvy tab appears; click "inspect".
3. In the window that opens, go to the Performance tab, click record, do
   items 8 and 9 on the phone, then stop.
4. Save the recording (the download arrow) and share the file in the next
   Divvy session.

## Afterwards

Bring the notes (and the recording, if you made one) to the next session.
Each problem becomes its own small fix, measured the same way as the
others.
