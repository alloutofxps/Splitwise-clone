# Divvy — Feature Audit (October 2026)

Every feature was tested on a full local copy of the app, then compared with
Splitwise. This is what was checked, what was broken, what was fixed or added,
and what is still missing.

## How it was tested

| Test | What it does | Result |
|---|---|---|
| Random money test (`scripts/audit-invariants.ts`) | 5 people, 3 groups (euro, yen with no decimals, Kuwaiti dinar with three), a direct friend, all six split types, several payers, dollar expenses in a euro group, edits, deletes, restores and payments, in random order. After every 10 steps it re-adds every balance by hand and checks the app agrees. | About 16,000 checks over four runs, **0 failures** |
| Edge cases (`scripts/audit-edges.ts`) | Archived groups, budgets across currencies, spreadsheet export, foreign-currency payments, leaving and rejoining, search, future dates, removing someone who owes, expenses with several friends | 23 checks, all pass after fixes |
| Tap every button (`scripts/button-audit.mjs`) | Taps every control on every screen in a real browser | 262 controls work; 1 dead control found and fixed |
| Existing suites | Screens (81), offline and install (36), end to end (217), unit tests (279) | All pass |
| Backup restore | Restored the live Cloudflare backup inside Railway and compared every table | Identical, integrity check passed |

## What was broken, and is now fixed

1. **Archiving a group hid money that was still owed.** If someone owed you
   €60 in a group you archived, Home stopped counting it while the Friends page
   still showed it. Archived groups now still count toward your totals.
2. **Budgets ignored other currencies without saying so.** A euro budget read
   €0 for a whole trip paid in yen. Spending in other currencies is now
   converted at today's rate, and the budget says it did that.
3. **Editing an expense with a friend lost the friend.** The edit screen
   showed only you, so the friend's share disappeared from the split and payer
   lists. It now shows everyone on the expense.
4. **People you can't split with were offered as choices.** "Add expense"
   listed everyone you share a group with, including names that aren't on Divvy.
   Picking one failed on save. Now only real friends are offered outside a group.
5. **A hidden debt was possible.** Outside a group, an expense with two payers
   could make one friend owe another friend they had never added, and neither
   could see it. The server now refuses that and explains why.
6. **A dead button on the date.** The "Today" chip under the amount was a
   button that did nothing (the real date field sits on top of it). Screen
   readers and the Tab key landed on it. It is now just a picture.

## What was added

1. **Phone notifications.** You get a message when someone adds an expense
   with you, changes or deletes one, pays you, comments, or sends a reminder.
   It says what it means for you ("Your share is €24.00"). Tapping it opens the
   group. Turn it on in Account. On iPhone it needs Divvy on the home screen.
   Signing out of a phone stops its notifications.
2. **One expense with several friends, outside a group.** Pick a friend, then
   tap "Also with" to add more. This is how Splitwise handles a dinner with
   people who don't share a group.
3. **One rough total.** With balances in several currencies, Home now also
   says roughly what they add up to in your own currency.

## Divvy compared with Splitwise

| | Splitwise | Divvy |
|---|---|---|
| Groups, friends, balances | ✓ | ✓ |
| Equal, exact, percent and share splits | ✓ | ✓ |
| Split by item, with tax and tip | Pro only | ✓ free |
| Several people paid | ✓ | ✓ |
| Foreign currencies | ✓ | ✓ |
| Simplify debts | ✓ | ✓ |
| Settle up, with payment apps | ✓ | ✓ (UPI, PayPal, Venmo, bank details and more) |
| Repeating expenses | ✓ | ✓ |
| Receipts and comments | ✓ | ✓ |
| Charts | Pro only | ✓ free |
| Search | Pro only | ✓ free |
| Budgets | ✗ | ✓ |
| Works with no internet | Partly | ✓ |
| Spreadsheet export | ✓ | ✓ |
| Reminders | ✓ | ✓ |
| Phone notifications | ✓ | ✓ (new) |
| One expense with several friends, no group | ✓ | ✓ (new) |
| Email or password sign-in | ✓ | No, by design (passkeys and a recovery key) |
| Email notifications | ✓ | ✗ (the app never asks for an email) |
| Import your Splitwise history | n/a | ✗ |
| A default split per group (e.g. 60/40) | Pro only | ✗ |
| Read a receipt photo automatically | Pro only | ✗ |
| Convert all balances into one currency to settle | Pro only | Partly: Home shows a rough total |

## Still worth building, in order

1. **Import from Splitwise.** Splitwise lets you export a spreadsheet per
   group. Reading that in would let people switch without losing history,
   which is the biggest reason people stay where they are.
2. **A default split per group.** Couples and flatmates who split 60/40 every
   time have to set it on every expense.
3. **Settle in one currency.** Pay off a yen debt in euros at today's rate.
   The rate lookup already exists; the payment screen would need a currency
   choice.
4. **Read receipt photos.** Fill in the amount and items from a photo. This
   needs an outside service, which costs money per scan.
