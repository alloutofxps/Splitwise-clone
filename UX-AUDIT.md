# Divvy: a user's-eye review (October 2026)

I used the app the way a new person would. I went through sign-up, an empty
account, a busy account (three groups, two real friends, a person added by
name only, expenses in euros, dollars and yen, every split type, a payment, a
budget), every panel that slides up, offline, and a broken link. I did it on
a phone-sized screen and on a desktop, in light and dark mode: 136 screenshots
in all. Each issue below is something I saw, not a guess.

## The short version

Divvy works, and its money maths is sound. It looks **competent but
anonymous**. It's a well-made version of what every modern finance app looks
like right now. A frosted floating tab bar, a glowing gradient button, glass
cards, a counting number, confetti, sparkle icons, an italic serif word dropped
into a bold headline: these are the visual habits of 2024–25 app templates and
AI-generated landing pages. None of them are wrong, but none of them are
*Divvy*. Nothing on screen could only belong to an app about splitting money
between friends.

The gap to an award-level app isn't polish. Most of the polish is there. It's
three things:

1. **A point of view.** A visual and motion language built from the subject
   itself (money moving between people), not from what's fashionable.
2. **Fewer, better decisions on each screen.** Several screens show the same
   number twice, ask the same question in two places, or put five equally loud
   things side by side.
3. **The edges.** First launch, empty states, the moment after you save
   something, errors, desktop. That's where award winners spend their effort,
   and where Divvy is weakest.

---

## 1. Things that are broken

1. **Your own actions show as unread.** In Activity, "You added Concert
   tickets" gets the unread dot and highlight. The unread rule only checks
   when you last opened the group, not who did it.
2. **Expenses with a friend outside a group stay unread forever.** They don't
   belong to a group, so there's no "last opened" time, and the rule always
   says unread.
3. **The Activity badge and the feed disagree.** The tab badge says "1"; the
   feed shows about seven unread dots.
4. **One Escape closes every open panel.** Pressing Escape on the split panel
   also closes "Add expense" underneath, and what you typed is lost. Every
   open panel listens for Escape on its own.
5. **Two screens give two different amounts for the same debt.** Ravi's friend
   page says he owes you €72.87 in Lisbon. The Lisbon group says he owes
   €38.53, and Settle up suggests €38.53. Both are "right": one is what he owes
   *you*, the other is what he owes *the group* after simplifying. Nothing
   explains this, and paying the friend-page amount leaves the group plan
   looking wrong.
6. **New accounts default to US dollars**, wherever you are. A person in
   Lisbon gets USD unless they notice the dropdown, and from then on Home says
   "About $324 owed to you".
7. **Flags show as letters on Windows.** The currency list reads "us USD · US
   Dollar", because Windows can't draw flag emoji.
8. **A desktop computer shows a phone icon** in Your devices.
9. **The payment amount shows a bright blue text-selection box** when Settle up
   opens. It's selected on purpose so you can type over it, but it looks like
   a glitch.
10. **Amounts are written four different ways**: "€1.08K", "€608" (no cents),
    "€295.03", and "135.62 EUR" (code after the number) in Settle up.

## 2. Where the experience falls short

### First launch
11. The logo is a "D" in a rounded square, a placeholder, not a mark. The same
    goes for the app icon on the home screen.
12. The headline breaks badly on phones: "Split bills with / friends." leaves
    one word alone on the second line.
13. The three feature chips wrap two-and-one, which looks unfinished.
14. "Sign in with a recovery key" sits below the fold, so returning users may
    not find it.
15. The name step offers emoji avatars before you've typed your name, and the
    row is cut off at the edge with no sign it scrolls.
16. The currency choice is a plain browser dropdown, unlike the app's own
    currency picker everywhere else.
17. The **recovery key step comes before you've done anything**. It's the most
    alarming moment in the app (a red warning box, a long code, a checkbox),
    and it's placed at the start, when there's nothing yet to lose. A passkey
    ("Save with Face ID") should be the main way in, with the key as a backup
    offered later.
18. The key is one long string ("dvy_A0B7jqZ_MXd…") that's hard to write down
    or read out. There's no "Save to Passwords", "Save as file" or QR option.
19. The "Back" link is plain text with no arrow, unlike back buttons elsewhere.

### Home
20. **The headline mixes currencies with colour as the only signal.** "€299.62
    ¥1,700" in green and red. Without colour you can't tell which is owed and
    which you owe. That's an accessibility failure, and confusing for everyone.
21. Home doesn't tell you **what needs your attention**. It doesn't say "Ravi
    added a taxi", "You owe Sam ¥1,700, settle up?" or "Rent is due tomorrow".
    It shows the same lists as the Groups and Friends tabs.
22. Every group tile is the same lilac-pink, so three groups look identical
    apart from a small emoji.
23. The Friends list on Home includes people who aren't friends (names added
    to a group, like Nadia and Jules), shown with dotted avatars.
24. A friend with balances in two currencies (Sam) gets two stacked
    amount-and-label pairs: cluttered and hard to scan.
25. The light/dark switch lives in the Home header, on the most valuable part
    of the screen, for a setting people change once.
26. "Good morning, Priya" every time. Pleasant once, wallpaper by the third
    visit.
27. The ✨ sparkle icon next to "All settled up" is the most recognisable
    AI-generated-design motif there is.
28. The first-run card is a cluster of four emoji tiles plus a headline with
    an italic serif word in the middle ("Start *your first* group"), which is a
    template look.
29. The budget you set is buried in Account. If you have one, Home is where
    you'd want to see "€416 of €600 this month".

### A group
30. There are **two "Add" buttons** on the group screen: the one in the card
    and the floating + in the tab bar.
31. The header icons don't say what they do: a share symbol means "invite",
    and a sliders symbol means "settings".
32. "9 ENTRIES" is database language.
33. Dates group in two different ways: "Today / Yesterday / Tuesday" with no
    date, then "October" with a date badge on every row.
34. Three icon styles are mixed: 3D emoji for groups (the island), thin line
    icons for categories, and filled shapes for people. Nothing ties them
    together.
35. The decorative 3D island is cropped at the top of the card.
36. "4" next to four avatars repeats what the avatars show.
37. **Balances repeats itself.** "Where everyone stands" and "Fewest payments"
    list the same people with related numbers. Then the Simplify switch
    appears both here and in Settings. On this screen it quietly changes the
    setting for everyone in the group.
38. The reminder bell appears on some rows and not others (not for people
    who aren't on Divvy), with no explanation.
39. Insights: every category bar is the same purple, even though categories
    have their own colours everywhere else.
40. Insights: the three summary tiles ("GROUP TOTAL €1.08K", "YOUR SHARE",
    "YOU PAID") are a generic dashboard pattern with mismatched number formats.
41. The "show as table" icon next to the chart switch is unlabelled and
    unclear.
42. Group settings can rename the group but not change its emoji, colour or
    currency.

### Adding an expense
43. The number pad takes half the screen, which pushes the description field,
    date, receipt and note below the fold. You can't type "Dinner" first and
    the amount second, which is how most people think ("dinner, 64.50").
44. In "Split equally" there's no visible tick on each person, so it isn't
    obvious you can tap someone to leave them out.
45. The split types run off the right edge ("Sh…") with no hint that more
    exist.
46. The category picker is two columns of large cards: about 30 categories
    across several screens of scrolling, with no search.
47. Panels stack on top of each other (number pad, then Receipts on top),
    which looks cluttered.
48. "Who are you splitting with" is a plain browser dropdown again.
49. Nothing happens after saving apart from the panel closing: no "Added ·
    Undo", and no moment where the new expense lands in the list.

### Settling up
50. The payment-method chips (Cash, Bank transfer, UPI, PayPal, Venmo, Other)
    are the same for everyone. They ignore which methods the other person has
    actually saved.
51. There's no "settle everything" for a group.
52. The "Sam → You" direction card with a floating "Change" link is hard to
    read at a glance.

### Expense details
53. The split shows each person's share *and* "lent €72.00" or "borrowed
    €48.00" underneath. Two numbers per person, often the same one twice.
54. "Split by item" and "Receipt" show the same information in two blocks.
55. It never says who added the expense and when, the first thing people
    look for when an expense looks wrong.

### Friends
56. The summary is a hard-to-read sentence: "Overall, you owe €8.35 and ¥1,700
    and you are owed €307.97".
57. A friend's page only lists expenses outside groups ("Just between you").
    Shared group expenses are hidden behind a collapsed "Made up of 2 balances".
    Splitwise shows the whole shared history.
58. People added by name only appear as friends.

### Activity
59. Every row has the same purple receipt icon. There's no avatar of who did
    it, and no category icon, so the feed is a wall of identical rows.
60. Everything says "1m ago" with no grouping beyond "Today".
61. Rows don't say what an entry meant for you (for example "you owe €21").

### Account
62. The emoji row and the colour row are separate controls under the avatar.
    The avatar itself should be the control.
63. Two different settings share the same wallet icon.
64. "May be cleared by your phone" is a technical worry most people can't act
    on.
65. "Version 6850b0321e02" shows a raw build code to users.
66. "Delete my account" sits in the same list as "Download a backup", with no
    separation.

### Invites and joining
67. **There's no QR code to invite someone standing next to you.** Your devices
    has one; inviting to a group, the most common in-person moment, doesn't.
68. Join can't scan a code either.
69. Invite shows three similar buttons (Share invite, Copy code, Copy link).

### Desktop
70. **Desktop is the phone layout, stretched.** There are wide empty margins,
    one narrow column, and the group's tabs stay tabs when there's room to show
    the expenses and balances side by side.
71. The logo appears twice: in the sidebar and again in the page header.
72. On a wide screen the expense name and its amount are about 1,000 pixels
    apart.
73. The sidebar's "Add expense" button is flat purple, unlike every other main
    button.
74. "Page not found" uses an older button style and no app frame.

### Throughout
75. **There's no swipe and no long-press.** You can't swipe a row to delete
    it, settle up, or send a reminder.
76. There's no pull-to-refresh.
77. Haptics are only used on Android (iPhones don't allow it from the web),
    and nothing replaces them on iPhone.
78. The many 2-line grey explanations under controls add up to a lot of reading.

## 3. Colour and look: dull or generic?

**Not dull, but generic.** The palette (indigo, plus green for owed and red
for owe, on light grey or near-black) is the default palette of fintech
templates. Specifically:

- **The indigo carries no meaning.** It's the colour of buttons, not of
  Divvy.
- **Green and red are the only colours with meaning**, and they're
  traffic-light colours.
- **Group colours exist in the data but barely show on screen**, so
  everything converges on lilac.
- **Two very similar greys** separate the cards from the background, so the
  layout reads as boxes on boxes.
- **Dark mode is a colour inversion**, not a designed night version.

## 4. Are we repeating AI-generated clichés?

Honestly, yes, in places. These are the habits to retire:

| Cliché | Where it is |
|---|---|
| Sparkle ✨ icon for "done" or "magic" | "All settled up", feature chips |
| Italic serif word in a bold sans headline | Welcome, first run, greeting |
| Floating frosted-glass capsule tab bar with glowing centre button | Every screen |
| Soft coloured blobs drifting behind the content | Background |
| Numbers counting up from zero on every visit | Home and group totals |
| Confetti on success | Settling up, sign-up |
| Floating tilted cards on the welcome screen | Welcome |
| Gradient buttons with a coloured glow underneath | Every main button |
| Film-grain texture | Whole app |

Each was reasonable on its own; together they read as a template. Award
winners (Things, Flighty, Copilot Money, Crouton, Halide) use **fewer effects,
each carrying meaning**. In Flighty, motion tells you where your plane is; in
Halide, the dials feel like a camera's.

## 5. What would make it award-level

These are the principles. Section 6 has concrete directions.

1. **One idea from the subject.** Divvy is about money moving between people.
   That's a visual idea: lines, flows, balance. It should show up on the
   welcome screen, in Balances, when you settle up, and in the app icon.
2. **Motion that explains.** When you toggle Simplify, the tangle of debts
   should visibly untangle into fewer arrows. When you pay someone, the amount
   should travel from you to them. When a balance changes, the bar should
   move. No motion only for decoration.
3. **Home answers "what do I need to do?"**: who owes you, who you owe, what's
   new, and one obvious action.
4. **Each screen has one loudest thing.** Strip duplicates (two Adds, two
   Simplify switches, two numbers per person).
5. **Your own palette and type.** One signature colour that means Divvy, group
   colours that really show, one typeface family used with confidence.
6. **The edges are designed.** Real empty states with personality, an undo
   after every save, a QR invite, a desktop layout that uses the width, error
   screens in the same style as the rest.
7. **Physical interactions:** swipe to settle or delete, long-press for
   options, pull to refresh, a tactile number pad.

## 6. Three directions to choose from

Each would replace the current "glass and gradients" look. I'd recommend **B**.

**A. Receipt paper.** The app is made of the thing it's about. Expenses are
thermal-paper strips with a monospace font and perforated edges. Settling up
stamps "PAID" across the strip. The palette is warm paper white and ink black,
with one stamp-red accent. Distinctive and witty, but it risks becoming a
costume, and dark mode is hard to make convincing.

**B. Flow (recommended).** Money as movement between people. Each person has a
colour that follows them everywhere: avatar, their line on charts, their
arrows. Balances are drawn as living lines between people: Simplify untangles
them on screen, settling up sends the amount along its line, and the app icon
is two dots joined by a curve. A calm editorial base (one typeface family,
generous white space, almost no glass) makes the colour and motion count.
It's built from the subject, it scales to desktop (a real map of a group's
debts), and nothing else in the category looks like it.

**C. Quiet utility.** Co-Star-style restraint: monochrome, typographic, almost
no colour except owed and owe, and motion only as transitions. Very calm and
very fast, but it gives up the warmth and fun of a social money app.

## 7. Suggested order of work

1. **Fix what's broken** (items 1–10). These are small, contained fixes.
2. **Remove the duplicates and clichés** (two Adds, two Simplify switches, the
   sparkle, the confetti, the blobs, numbers counting on every visit) and make
   number formats consistent.
3. **Rebuild Home** around what needs your attention, including budgets and
   new activity.
4. **Apply the chosen direction:** palette, type, icon set, app icon, motion
   language, and dark mode designed separately.
5. **The edges:** QR invites, undo after saving, swipe actions, a real desktop
   layout, the empty states, and moving the recovery key out of first launch.
