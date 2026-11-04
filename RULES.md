# The rules Divvy must meet

Written on 27 October 2026, for the "make every part of it right" work.

Divvy's purpose: a group of friends records shared costs in seconds, always
knows to the cent who owes whom, and settles up. They do it on their own
phones, online or offline, and like it enough to keep using it and to bring
their friends.

Every rule below is a statement that can be checked. Each has an id (M1, D2
and so on), how it is checked, and its result. A rule counts as met only
when its check exists, passes, and is either run in CI on every change or
recorded as evidence in `perf-runs/` with the date.

The areas are in order of harm: the first list is what hurts most when it
breaks. Within an area, rules are in the same order.

Status: **open** (not yet checked), **fails** (checked, broken, fix
planned), **passes** (checked, with evidence), **watch** (only time or real
people can prove it; how the app tells us is written down).

## 1. Money

| Id | Rule | Check |
|---|---|---|
| M1 | Every group's balances add up to exactly zero, in minor units, after any sequence of adds, edits, deletes, restores, undos and payments. | Property test against a separate simple calculator; randomised end-to-end run against a real server |
| M2 | Each person's balance equals what they paid minus their share, worked out independently of Divvy's own code. | Simple calculator, hundreds of thousands of random cases |
| M3 | Every split type (equal, exact, percent, shares, adjustment, itemised) gives shares that add up exactly to the total, never a negative share, and puts any odd cent on a payer first. | Property tests that shrink failures; hand-worked examples |
| M4 | A foreign-currency expense converts to the group currency the same way on the phone and on the server, rounded half up, and each person's converted share adds up to the converted total. | Property tests across 0, 2 and 3-decimal currencies |
| M5 | A same-currency expense's shares are used exactly as stored, for every amount up to the largest the server accepts. | Property test at the limits |
| M6 | Paying the whole debt in another currency leaves nothing owing, not even one cent. | Property test; end-to-end test |
| M7 | The literal debts and the simplified plan both settle everyone exactly, and the plan uses at most one payment fewer than the number of people. | Property test |
| M8 | The number shown on Home, the group card, the group screen, the friend page and the balance after a just-typed (optimistic) change all agree with the server's. | End-to-end invariants run; browser check after save |
| M9 | A payment link (UPI, Venmo, Cash App, Monzo, PayPal, Revolut) never fills in an amount in a currency that service would read differently. | Unit test per service and currency |
| M10 | Amounts are read the same way whatever the person types or pastes ("1,234.56", "1.234,56", "12,50"), and an unreadable amount is refused, never saved as zero. | Unit and property tests |
| M11 | Undoing a delete or a payment brings back exactly the balances from before. | End-to-end test |
| M12 | The tests guarding the money code catch planted mistakes: the mutation score on the money files is at least 90%. | Stryker, run in CI on the money files |

## 2. Data

| Id | Rule | Check |
|---|---|---|
| D1 | An expense or payment added offline appears at once, survives closing the app, and is saved exactly once when the phone is back online. | Browser test: offline, add, close, reopen, online |
| D2 | Two phones (or two tabs, or the home-screen app and Safari) sending the same queued changes never save anything twice and never report a false failure. | Browser test with two contexts sharing one queue |
| D3 | Two people editing the same expense at once: the second save is refused with a clear message and nothing is overwritten silently. | End-to-end test |
| D4 | A change the server refuses is never dropped silently; the person is told what and why, and can retry or discard. | Browser test |
| D5 | An app update arriving mid-use loses nothing typed or queued. | Browser test with a service worker update during an open composer and a queued change |
| D6 | If the server stops mid-save, or the database is busy, or the exchange-rate service is down, the person sees a clear message and the change is either fully saved or not at all. | Fault-injection tests |
| D7 | A deleted expense can be restored for the stated time, and is then gone for good. | End-to-end test; reading the housekeeping job |
| D8 | The off-site backup restores to a working database whose counts and balances match the live one at that moment. | Restore drill, recorded |
| D9 | Exports (CSV and JSON backup) contain every expense and payment, with the same amounts the app shows. | End-to-end test |

## 3. Privacy and accounts

| Id | Rule | Check |
|---|---|---|
| P1 | Every action is allowed or refused correctly for each kind of person: owner, member, someone who left, a stranger, signed out. | Automated table of every route against every kind of person |
| P2 | Nobody can read any amount, name or note from a group or friendship they are not in, by any route, id guessing or search. | Same table, plus id-guessing tests |
| P3 | Someone who loses their phone can get back in: by a synced passkey, by another device, or by the recovery key. The app makes sure each person has at least one of these before they have anything to lose. | Browser walk-through of each path; reading the prompts |
| P4 | A lost phone can be signed out from another device, and an unused device stops working after 180 days. | End-to-end test |
| P5 | Invite links can be switched off and replaced, and a replaced link stops working at once. | End-to-end test |
| P6 | The OWASP ASVS level 2 checklist is met, point by point, with evidence for each line. | `ASVS.md` |
| P7 | Secrets never appear in logs, error messages, the page source or the repository. | Log and source scan |
| P8 | The privacy page says truthfully what is stored, where, for how long, and how to delete it; deleting your account deletes it. | Reading against the database design; end-to-end delete test |

## 4. Real phones

| Id | Rule | Check |
|---|---|---|
| R1 | Every screen works in Safari's engine (WebKit) and Chrome's, at 320, 375, 393 and 430 points wide, with no sideways scrolling and nothing cut off. | Automated runs in both engines at four sizes |
| R2 | From the iPhone home screen: the app opens full screen, the launch screen shows, the notch and the home bar never cover anything, and links stay inside the app. | WebKit run in standalone mode with safe-area insets; reading Apple's rules |
| R3 | With the largest text setting, every screen still works: nothing overlaps, nothing important is cut off. | Run at 200% text |
| R4 | The on-screen keyboard never covers the field being typed in or the Save button. | WebKit and Chrome runs with a shrunken visual viewport |
| R5 | On a slow connection the app opens and shows something useful quickly; with no connection it opens and shows the last known balances. | Throttled and offline runs |
| R6 | Every tap target is at least 44 by 44 points. | Automated measurement on every screen |

## 5. Looks

| Id | Rule | Check |
|---|---|---|
| L1 | Every screen, in every state, matches `DESIGN-PLAN.md` and its tokens, in Day and Night. The states: first visit, empty, loading, error, offline, busy, long names, many people, many currencies. | Screenshots of every screen and state, reviewed against the plan |
| L2 | Nielsen's ten heuristics hold on the main tasks. | Written review |
| L3 | The most important thing on each screen is the first thing seen (squint test). | Blurred screenshots |
| L4 | Any change to how a screen looks is caught by a picture comparison before it ships. | Screenshot comparison in CI |
| L5 | Every error screen, including the last-resort one, uses Divvy's own colours and words. | Screenshots |

## 6. Colour

| Id | Rule | Check |
|---|---|---|
| C1 | Each colour means one thing everywhere: green only for owed to you, orange only for you owe, red only for danger. | Token and component scan |
| C2 | All text passes WCAG 2.2 AA contrast (4.5 to 1, or 3 to 1 for large text) on every surface it sits on, in Day and Night. | Measured from the tokens and from the pixels |
| C3 | APCA, as a second opinion, gives body text at least Lc 75, secondary text, the money colours and avatar initials at least Lc 60, and the faintest text (timestamps, small notes read in passing) at least Lc 45. | `scripts/colour-check.mjs`, from the tokens, in CI |
| C4 | Owing and being owed can be told apart without colour (words or signs) and with every kind of colour blindness. | Simulation in the browser; reading every money label |
| C5 | Field edges, switches and focus rings reach 3 to 1 against what is around them. | Measured |
| C6 | The surface and ink steps are even in lightness (OKLCH). | Measured |
| C7 | Any two person colours can be told apart, with normal vision and with colour blindness, or the avatar carries a second cue. | Colour distance measured under simulation |

## 7. Worth coming back to

| Id | Rule | Check |
|---|---|---|
| W1 | A new person gets from first opening the app to a saved first expense in under a minute and few taps, without being stuck. | Timed walk-through as a stranger; tap count |
| W2 | A friend opening an invite link on a phone that has never seen Divvy understands what it is and who invited them, and joins in one step. | Fresh-browser walk-through in both engines |
| W3 | Adding an everyday expense takes no more taps than Splitwise or Tricount. | Tap count, side by side with their public screenshots and help pages |
| W4 | Reminders and notifications are useful, rare, easy to turn off, and never use streaks, fake urgency or guilt. | Reading every notification and nudge text and its timing |
| W5 | The anonymous counts show groups still adding costs in their second week and invites being joined. | Live counts, repeated over time (watch) |

## 8. Accessibility

| Id | Rule | Check |
|---|---|---|
| A1 | axe reports nothing on any screen or state, in Day and Night, in both engines. | axe on every screenshot |
| A2 | Every task can be done by keyboard alone, with a visible focus ring. | `keyboard-check.mjs` |
| A3 | A screen reader is told what each control is, what changed after an action, and every amount with its meaning ("you owe Sam 12 euros"). | Accessibility tree for the main tasks |
| A4 | At 200% zoom every screen works without sideways scrolling. | Run at 200% |
| A5 | With Reduce Motion, every slide, scale, travel and count becomes a 150ms fade or the end result (MOTION-SPEC 6). | Recorded with Reduce Motion |

## 9. Speed and smoothness

| Id | Rule | Check |
|---|---|---|
| S1 | Home downloads at most 312 KB of scripts, compressed, and a group at most 333 KB (MOTION-SPEC 7). | `size-report.mjs`, in CI |
| S2 | Under 2% of frames are over 25ms with the processor slowed 4 times (MOTION-SPEC 8). | `motion-record.mjs timing` |
| S3 | On a mid-range phone profile (4 times slower processor, slow 4G), Home shows balances within 2.5 seconds and responds to a tap within 200ms. | `phone-speed.mjs`, through an HTTP/2 relay |

## 10. Server

| Id | Rule | Check |
|---|---|---|
| V1 | Every request checks who you are, what you may do, and what you sent, before doing anything. | Permission table (P1); input fuzzing of every route |
| V2 | Bad input gets a clear message (4xx), never a crash (5xx), for every route. | Fuzzing every route with wrong types, huge values, missing fields |
| V3 | Rate limits stop abuse without blocking a real group. | End-to-end test |
| V4 | Background jobs (recurring expenses, push, rates, housekeeping, snapshots) run once each, survive a restart, and report failures. | Reading and tests |

## 11. Database

| Id | Rule | Check |
|---|---|---|
| B1 | The database itself refuses impossible rows: negative amounts, shares that don't add up, a member twice, rows pointing at nothing. | Constraints in the schema, with tests that try to break them |
| B2 | The live database has zero impossible rows. | Read-only check in production, counts only, on a schedule |
| B3 | Every migration is safe on live data: tested on a copy of the real shape before it ships. | Migration test |
| B4 | Indexes fit the real queries: no full-table scans on the hot paths, no unused or duplicate indexes. | Query plans for every hot query |

## 12. Running it

| Id | Rule | Check |
|---|---|---|
| O1 | Every push to main deploys, and a bad deploy can be rolled back in minutes. | Rollback rehearsal, recorded |
| O2 | When the site is down, or errors pile up, someone is told within 10 minutes. | Monitor and alert test |
| O3 | Errors on people's phones and on the server are recorded, without personal data, and are visible. | Error reporting, tested by causing an error |
| O4 | Backups run daily and off-site, and a restore is drilled (D8). | Restore drill |
| O5 | Logs are kept long enough to look into a problem, and contain no personal data. | Reading the logs |
| O6 | The build doesn't depend on anything that will soon stop working (npm's install-script rules, end-of-life versions). | CI and dependency checks |

## 13. Words and legal

| Id | Rule | Check |
|---|---|---|
| T1 | Every message is clear, plain and kind, and tells the person what to do next. | Reading every string |
| T2 | The privacy page and terms are accurate and complete. | Reading against the code |
| T3 | Link previews (invite links shared in WhatsApp, iMessage) show a correct title, description and picture. | Fetching the preview tags |
| T4 | The welcome page says what Divvy is and why to trust it in a few seconds. | Review with the Taste Skill |

## 14. Code and tests

| Id | Rule | Check |
|---|---|---|
| Q1 | Every check in this file that can be automated runs in CI on every change. | CI file |
| Q2 | The tests catch planted bugs: mutation score at least 90% on the money and permission code. | Stryker |
| Q3 | WebKit and Chrome pass the same browser suites. | CI |
