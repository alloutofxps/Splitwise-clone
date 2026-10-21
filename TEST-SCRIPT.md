# Divvy: five-person test

A script for testing Divvy's motion with five people, one at a time. It
checks the promise in MOTION-SPEC.md: "Motion explains a change, or it
doesn't happen." Each moment should tell people what just happened, without
anyone explaining it, and nothing should feel slow, fussy or in the way.

Anyone can run it. You don't need to know how the app is built.

## Before you start

**You need:**
- One phone with Divvy on it (an Android phone in the middle of the price
  range is best, because that is where smoothness problems show), signed in
  to a test account, not your own.
- This script, printed or on another screen, and a way to take notes.
- About 25 minutes per person.

**Set up the test account once, before the first person** (10 minutes):
1. Create a group called "Lisbon trip" with three made-up people in it:
   Ana, Sam and Ravi (Group settings, Add people, type a name).
2. Add four expenses to it:
   - Museum tickets, €60, paid by Ana, split equally.
   - Taxi to the airport, €42, paid by Ravi, split equally.
   - Dinner, €96, paid by you, split equally.
   - Pastries, €18.40, paid by Sam, split equally.
3. Create a second group, "Flat", with Sam in it, and add one expense: Big
   shop, €83.40, paid by Sam, split equally.
4. Note on paper what Home says you're owed and what you owe, and what the
   Lisbon trip balance is. You'll compare against what people tell you.

**Between people,** undo what the last person did: delete expenses they
added, and remove payments they made (open the payment in the group's list,
then Remove). Check the balances match your note.

**How to run each task:**
- Read the task out as written. Don't point, and don't name buttons that
  aren't in the task.
- Then stay quiet and watch. If they're stuck for 30 seconds, say "What
  would you try?" and, after another 30, show them and mark the task as
  "needed help".
- Ask the questions straight after the task, while it's fresh. Write down
  their words, not your summary.

**Scoring:** each task has a pass mark out of five people. A task passes if
at least that many people pass it. A person passes a task if they answer
the "pass if" question correctly without help.

---

## The tasks

### 1. Opening a group

**Say:** "You're on a trip with friends. Open the trip."

**Watch for:** as the group opens, its name and amount should fly from the
row on Home into the top of the group's screen. Do they look at the top of
the new screen straight away, or search for where they are?

**Ask:**
- "Where are you now?"
- "What does the amount at the top mean?"
- **Pass if** they say they're in the Lisbon trip group, and that the amount
  is what they're owed (or owe) in it.

**Pass mark:** 4 of 5.

### 2. Going back

**Say:** "Go back to where you started."

**Watch for:** the name and amount should fly back into the trip's row. If
"Needs you" changed (news they've now seen), the old row and its
replacement should cross-fade in place. Does anything jump?

**Ask:**
- "Did anything on this screen change when you came back?"
- **Pass if** they notice nothing jarring. If they mention a change, ask
  "Was that clear, or did it catch you out?" and note the answer.

**Pass mark:** 4 of 5 notice nothing jarring.

### 3. Adding an expense

**Say:** "You just paid €24 for coffee for everyone on the trip. Add it."

**Watch for:** the panel slides up, they type, they save. The panel should
leave, then the new row should appear in the list with a soft highlight
that fades, then the balance at the top should roll to its new value.

**Ask:**
- "What just happened to your balance?"
- "Where is the coffee now?"
- **Pass if** they say their balance went up (others owe them more) and point
  to the coffee row in the list.

**Pass mark:** 4 of 5.

### 4. Settling up part of a debt

**Say:** "Sam wants to pay you back €5 of what he owes. Record that."

**Watch for:** after saving, the panel leaves, the Balances tab shows, and a
dot in Sam's colour travels along the line from Sam to them. The line gets
shorter. Their balance rolls down.

**Ask:**
- "What did the moving dot show you?"
- "Who paid whom, and does Sam still owe you anything?"
- **Pass if** they say Sam paid them, and that Sam still owes some.

**Pass mark:** 4 of 5 can say who paid whom without being told.

### 5. Paying off a debt completely

**Say:** "Now Sam pays you back everything he still owes. Record that."

**Watch for:** the same travel as before, then a short "paid" drawing on
the person who's now square. The line between them should disappear.

**Ask:**
- "What does that little drawing mean?"
- "Does Sam owe you anything now?"
- **Pass if** they say Sam is square, or doesn't owe anything any more.

**Pass mark:** 4 of 5.

### 6. Deleting, then changing your mind

**Say:** "The coffee was a mistake. Delete it. ... Actually, it wasn't. Put
it back."

**Watch for:** the row should fold away, a message with Undo should appear,
and after Undo the row should come back in the same place.

**Ask:**
- "When you put it back, where did it go?"
- **Pass if** they say it went back where it was.

**Pass mark:** 4 of 5.

### 7. Panels on panels

**Say:** "Start adding a new expense, €30 for a taxi. Before you save it,
change who it's split between, so it's just you and Ana."

**Watch for:** the split panel opens on top of the expense panel, and the
expense panel steps back a little and dims. Closing the split panel brings
the expense back to the front.

**Ask:**
- "When the second panel opened, what happened to the first one?"
- **Pass if** they say it was still there underneath, or they'd come back to
  it.

**Pass mark:** 4 of 5.

### 8. The three tabs in a group

**Say:** "Have a look at who owes whom in this group, and then at what the
group spends most on."

**Watch for:** the content slides with the underline between Expenses,
Balances and Insights.

**Ask:**
- "Are these three separate places, or parts of the same thing?"
- **Pass if** they say parts of the same group, side by side.

**Pass mark:** 4 of 5.

### 9. Refreshing

**Say:** "Make sure you're seeing the latest version of Home."

**Watch for:** pulling down shows a small drawing that follows the finger,
plays while loading, then settles. Do they try pulling down at all?

**Ask:**
- "How did you know it was working?"
- **Pass if** they mention the drawing or the screen moving with their
  finger.

**Pass mark:** 3 of 5 (some people never pull to refresh, and that's fine).

---

## At the end, for each person

Ask these three, and write the answers down word for word:

1. "Was there any moment where the app felt slow, or where you were waiting
   for it?"
2. "Was anything moving that you'd rather didn't, or that got in your way?"
3. "Was there a moment where you weren't sure what had just happened?"

**Pass mark for the whole test:** no moment named in answers 1 or 2 by more
than one person, and no moment named in answer 3 by more than one person.
Anything named by two or more people is a finding: note which task, and
what they said.

## Optional: with motion turned off

If one of the five uses Reduce Motion (iPhone: Settings, Accessibility,
Motion) or Remove animations (Android: Settings, Accessibility), repeat
tasks 3, 4 and 6 with it on. Nothing should slide, travel or roll; things
should fade or simply appear. Ask the same questions. The pass marks are
the same, because the words and colours alone must tell the story.

## Recording the results

For each task, write down how many of the five passed, whether anyone
needed help, and any words that surprised you. Bring the notes back to the
next Divvy session; anything that fails its pass mark becomes a fix, with
the person's words as the reason.
