# Divvy redesign: Flow × Quiet

This is the plan for every part of the app. It follows UX-AUDIT.md and
replaces the "golden hour" glass-and-gradient look in DESIGN-AUDIT.md.

**The idea in one line.** Divvy is quiet, like a well-made paper ledger, until
money moves. Then it comes alive, as coloured lines between people.

- **Quiet** is the base: ink on paper, one typeface family, hairline rules,
  almost no decoration, and motion only when it explains something.
- **Flow** is the voice. Every person has their own colour, which follows
  them everywhere. Debts are drawn as lines between people. Simplifying
  untangles the lines on screen, and paying someone sends the amount along
  its line.

Colour in Divvy means "a person" or "money owed". Nothing else gets colour,
so when colour appears, it's saying something.

---

## Part 1. Foundations

### 1.1 Colour

**Neutrals: ink and paper.** A slightly warm stone scale, so the app reads as
paper rather than a cold screen.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `paper` | #FAFAF8 | #0B0B0A | Page background |
| `sheet` | #FFFFFF | #141413 | Cards, panels, lists |
| `sheet-2` | #F3F2EF | #1C1C1A | Insets, pressed rows, fields |
| `rule` | #E7E5E1 | #2A2926 | Hairlines (1px), dividers |
| `ink` | #141412 | #F3F2EE | Text, primary buttons, icons |
| `ink-2` | #57534E | #A8A29E | Secondary text |
| `ink-3` | #8A857E | #77726B | Hints, placeholders, timestamps |

**Primary actions are ink, not purple.** A black button on paper (white on
night) is the quietest strong signal there is. The indigo gradient and the
glow under buttons go.

**Money colours.** Calm, never traffic-light, and never used alone:

| Token | Light | Dark | Means |
|---|---|---|---|
| `owed` | jade #0F7A5C | #4CC9A0 | Money coming to you |
| `owe` | vermilion #C2410C | #F08A5D | Money you owe |
| `even` | `ink-3` | `ink-3` | Settled |

Every owed/owe amount also carries words ("owes you", "you owe") **and** an
arrow glyph (↙ in, ↗ out). Colour is the third signal, never the only one.

**People colours: the Flow palette.** Ten hues, tuned to the same perceived
lightness (OKLCH L≈0.62 light, ≈0.74 dark) so no person looks more important
than another, and each distinct from its neighbours and from jade and
vermilion:

`azure 245°`, `violet 290°`, `orchid 330°`, `coral 20°`, `amber 70°`,
`olive 110°`, `teal 185°`, `cobalt 265°`, `plum 310°`, `sand 55°`
(lower chroma).

- Each person keeps their chosen hue everywhere: avatar, their lines in
  Balances, their segment in the Home bar, their bars in Insights, their
  name tint in Activity.
- Inside a group, Divvy gives each member a hue that differs from everyone
  else's. A clash is resolved only for display in that group; their own choice
  doesn't change.
- Groups get a hue too, shown as a small disc beside the group's emoji, and
  the group's lines take that hue in group-level charts.

**Where colour is banned:** backgrounds, buttons (except destructive red),
headings, and icons (they're ink).

### 1.2 Type

**One family: Geist** (and Geist Mono for codes). It replaces three families
(Inter, Bricolage Grotesque, Instrument Serif), and the italic serif goes.

| Style | Size/line | Weight | Tracking | Use |
|---|---|---|---|---|
| Figure XL | 44/48 | 600 | -0.035em | The headline balance |
| Figure L | 30/34 | 600 | -0.03em | Group balance, settle amount |
| Title | 24/30 | 600 | -0.02em | Screen titles |
| Heading | 17/22 | 600 | -0.01em | Section and card headings, row titles |
| Body | 16/22 | 400 | 0 | Everything else |
| Body strong | 16/22 | 500 | 0 | Row values, names |
| Caption | 13/18 | 400 | 0 | Meta lines ("Ravi paid €42 · Tue") |
| Label | 12/16 | 500 | +0.04em, uppercase | Rare: section labels only |
| Mono | 15/22 | 500 | 0 | Invite codes, recovery key, rates |

- Figures always use tabular numerals, so columns of money line up.
- Body text is never under 13px; inputs are 16px (no zoom on iPhone).
- Headings are sentence case.

### 1.3 Spacing, shape and depth

- **8-point grid.** Side gutter 20px on phones, 32px on desktop.
- **Radius:** 14px for cards and lists, 12px for fields, full for chips and
  avatars, 28px for the top of sheets. No other radii.
- **Depth:** flat. Hairline `rule` borders, no drop shadows, except a single
  soft shadow under sheets and menus, which really float. Glass, grain, glow
  and blobs are removed.
- **Lists are grouped insets** (one white card holding rows separated by
  hairlines), not a separate floating card per row. That alone removes most
  of the "boxes on boxes" noise.

### 1.4 Iconography

- **One set:** Lucide at 1.75px stroke, 20px in rows, 22px in the tab bar,
  always ink-coloured (`ink-2` when secondary).
- **No 3D emoji as decoration.** The large 3D island on the group card goes.
  A group's emoji is the user's own content and stays, drawn flat at text
  size beside the group's colour disc.
- **Categories become ink icons on `sheet-2` squares.** Category colours
  appear only in Insights charts.
- **Header icons get labels** where meaning isn't universal: "Invite" instead
  of a share symbol, "Settings" instead of sliders, or text buttons on desktop.

### 1.5 Motion

**Rule: motion explains a change, or it doesn't happen.**

- **Timing:** 150ms for small state changes, 240ms for movement, 320ms for
  sheets. Easing `cubic-bezier(0.2, 0, 0, 1)` (quick out, soft landing).
  Springs only where a finger is driving (dragging a sheet, swiping a row).
- **What moves:**
  - **Values change, not appear.** A balance rolls from its old value to the
    new one when an expense changes it. It never counts up from zero on load.
  - **Simplify untangles.** In Balances, switching Simplify on morphs the full
    tangle of person-to-person lines into the few simplified ones.
  - **Paying travels.** After a payment, a dot carries the amount along the
    line from payer to payee, then the line thins or disappears. This replaces
    confetti.
  - **New rows arrive.** A just-added expense slides into its place in the
    list with a brief highlight, so you see where it went.
  - **Sheets slide.** No scaling of the page behind, no rubbery overshoot.
  - **Tabs cross-fade.** No sliding pill.
- **What doesn't move:** backgrounds, icons for decoration, buttons glowing,
  welcome cards bobbing, numbers on load.
- Reduce Motion: travel and untangle become cross-fades; nothing else changes.

### 1.6 Feedback: haptics and sound

- **Haptics** (Android; iPhone web apps can't): a light tick on keypad taps,
  a double pulse on a saved payment, a firm buzz on an error.
- **No sounds.**

### 1.7 Voice

Already plain since the copy rewrite. The new rules: never more than two lines
of grey help text under a control (move anything longer behind a "?" that
opens a short explanation), and no exclamation marks.

---

## Part 2. Components

| Component | Today | Becomes |
|---|---|---|
| **Primary button** | Indigo gradient, glow, full-round | Solid ink, 52px tall, 14px radius, white text. Pressed: `ink-2`. Loading: a thin progress line along the bottom edge, not a spinner. |
| **Secondary button** | Glass card | `sheet` with a hairline `rule` border, ink text |
| **Text button** | Indigo text | Ink text with underline on hover; `ink-2` for low priority |
| **Destructive** | Red text | Red text; red solid only inside the final confirmation |
| **Tab bar** | Floating glass capsule, glowing + in the middle | Docked to the bottom, `sheet` background with a hairline top rule, five slots: Home, Friends, **Add**, Activity, You. Add is a 48px ink circle in line with the others: no halo, no glow. Active tab: ink icon and label; inactive: `ink-3`. |
| **Sheet** | Rounded white panel, page scales back, Escape closes all | Rounded top 28px, page behind dims only. **Only the top sheet responds to Escape and back.** Drag handle, title left, close right. |
| **List / row** | One floating card per row | Grouped inset. Row: 56px minimum; leading icon or avatar 36px; title (Heading) plus meta (Caption); trailing value. Swipe actions where useful (Part 4). |
| **Amount** | Coloured number | Coloured figure plus word ("you owe") plus arrow glyph. One formatter: symbol first, full minor units, never "K", never code-after-number. |
| **Avatar** | Initials on a gradient bead, dotted for name-only people | Person colour as a flat disc with ink-white initials or the chosen emoji. Name-only people: an outlined ring in their colour with initials in that colour, plus "not on Divvy yet" wherever it matters. |
| **Flow bar** (new) | – | A thin horizontal bar made of person-coloured segments, sized by how much each person owes you or you owe them. Used on Home, a friend's page and a group header. Tap a segment to open that person. |
| **Flow map** (new) | – | SVG: people as avatars in a ring (or two columns on phones), lines between them coloured by the payer, with arrowheads and amount labels. Animates between the literal and simplified lines. Accessible as a plain list underneath. |
| **Number pad** | Large keys, half the screen | 46px keys in a 3×4 grid with hairline separators, like a calculator, and a compact mode once an amount is entered |
| **Chips** | Rounded pills with fills | Hairline outline; selected = ink fill, paper text |
| **Segmented control** | Glass with a sliding white pill | Text tabs with an ink underline that moves, the same as the group tabs |
| **Toasts** | Card with icon | Ink bar at the bottom above the tab bar; one line of text plus one action ("Undo") |
| **Empty states** | Glowing icon, headline, body | A small flow drawing (two or three dots and a line, in the relevant person colours), one line of text and one action |
| **Fields** | Rounded, indigo focus glow | `sheet-2` fill, no border, ink 1.5px focus ring |
| **Switch** | Indigo | Ink when on |
| **Charts** | All bars purple | Person colours for "who" charts; ink with opacity steps for categories; values labelled directly, no legend |

---

## Part 3. Screens

### 3.1 First launch
- **Welcome:**
  - Four dots (people, in four person colours) appear, and lines draw between
    them as expenses would: six tangled lines. Then they untangle into two.
    That's the product in three seconds.
  - Headline in Geist: "Split costs with friends." Second line in `ink-2`:
    "Divvy keeps track of who owes who, and the easiest way to pay back."
  - One ink button, "Get started", and a text button, "I already use Divvy",
    which opens sign-in options (passkey or recovery key).
- **Name:**
  - One field. The avatar beside it updates live in the person colour picked
    for you, with "Change" to choose another colour or an emoji.
  - Currency is worked out from the phone's region (Lisbon gives EUR), shown
    as "Your currency: EUR · Change".
- **Protect your account (replaces the recovery-key wall):**
  - "Use Face ID / fingerprint to get back in on a new phone" creates a
    passkey. "Not now" is allowed.
  - The recovery key moves to **Account → Backup**.
  - Until a passkey or saved key exists, Home shows a quiet card: "Back up
    your account · 1 minute".
  - The key is shown as 6 groups of 4 characters in Geist Mono, with "Copy",
    "Save as file" and "Show QR".

### 3.2 Home: "what needs you"
From the top:
1. **Header:** small "Divvy" wordmark, search, and your avatar (opens You).
   The theme switch moves to You.
2. **Balance:** one line per currency in Figure XL: "You're owed €299.62"
   (jade, ↙) and "You owe ¥1,700" (vermilion, ↗). Under them, the **flow bar**
   showing who makes up the balance. With several currencies, "About €290
   overall" in `ink-2`.
3. **Needs you** (only what's actionable, up to four rows):
   - unread changes by others: "Ravi added Taxi to the airport · you owe €21"
   - payments you can make: "Pay Sam ¥1,700"
   - reminders you've received
   - a budget above 80%
   - the backup card
4. **Groups:** grouped inset. Each row has the group colour disc and emoji,
   the name, a last-activity caption ("Ravi added Taxi · 2h"), and your
   balance.
5. **This month:** if a budget exists, a single line with a thin bar: "€416
   of €600".
6. The Friends list leaves Home (it's a tab).
7. **First run:** the balance block reads "Nothing owed yet", and Needs you
   becomes "Start a group / Join with a code / Move from Splitwise" as three
   rows with icons, not a card of emoji.

### 3.3 Group
- **Header:**
  - Back, the group's emoji and name, and "Invite" and "Settings" as
    labelled icons.
  - Under them: member avatars in their colours, the group's flow bar, and
    "You're owed €262.97 ↙".
  - One action button: "Settle up". Adding uses the tab bar's Add, which
    knows which group you're in.
- **Tabs:** Expenses · Balances · Insights, with an underline.
- **Expenses:**
  - Date headers in one format everywhere: "Today", "Yesterday", then
    "Mon 13 Oct". No italic serif.
  - Row: category icon, title, caption "Ravi paid €42" (with Ravi's colour
    dot), trailing "you owe €21" or "you lent €72" or "not involved".
  - Payments are rows with a small two-dot-and-line glyph in both people's
    colours.
  - Swipe left to delete; long-press for Edit, Duplicate and Delete.
  - "9 entries" goes; the filter and search icons stay, with labels on
    desktop.
- **Balances:**
  - The flow map is at the top, with a single Simplify switch below it that
    animates the morph. Simplify's setting moves here only; Settings links
    to it.
  - Under the map, "Suggested payments" rows, each with "Settle" or
    "Remind" on the right (Remind greyed with "not on Divvy yet" for
    name-only people).
  - A collapsed "Everyone's balance" list for those who want numbers.
- **Insights:**
  - Three figures in one line ("Total €1,082.50 · Your share €295.03 · You
    paid €608.00"), always full cents.
  - "Who paid": horizontal bars in person colours.
  - "Where it went": category bars in ink.
  - "Over time": monthly columns.
  - The table toggle becomes "Show as a table".

### 3.4 Adding an expense (full-height sheet)
From the top:
1. **"With":** a chip showing the group or friend. Tap it to pick from a
   proper list sheet, not a browser dropdown.
2. **Description:** "What was it for?" sits first, with the category icon
   suggested as you type.
3. **Amount:** Figure L, currency chip to its left, compact keypad below.
   Typing in the description hides the keypad; tapping the amount brings it
   back.
4. **"Paid by you · split equally between 4":** one sentence; tapping either
   half opens its panel. If a usual split applies, the sentence says
   "· usual split".
5. **A row of small icon chips:** date, receipt, note.
6. **Save:** an ink button, "Add expense". After saving, the sheet closes, the
   row slides into the list, and a toast says "Added Dinner · Undo".

Panels inside it:
- **Split panel:** the six modes as an underlined text-tab row that scrolls,
  with a fade on the right edge so it's clear there's more. In "Equally",
  each person row has a visible tick.
- **Categories:** a 4-column grid of icon and short name, with search at the
  top.

### 3.5 Expense details
- **Header:** category icon, title, Figure L amount, and "Added by Priya ·
  Tue 13 Oct".
- **Body:** one list, "Who paid / who owes", showing each person's share once
  and their effect ("lent €72") once.
- The receipt items merge into the split section when splitting by item.
- Receipt photos and comments follow.
- Edit and Delete sit in the header, not at the bottom.

### 3.6 Settle up
- The top shows **payer → payee** as two avatars joined by their line, with
  the amount on the line.
- Amount (Figure L) with "Paying in EUR".
- "How they'd like to be paid": the payee's own saved methods first (UPI
  link, bank details with copy), then Cash and Other.
- An ink "Save payment" button. After saving, the dot travels along the line,
  the balance rolls down, and the toast says "Saved · Undo".
- A new **"Settle all in this group"** for whoever owes several people.

### 3.7 Friends
- The summary is one line per currency: "You're owed €307.97 ↙ · You owe
  €8.35, ¥1,700 ↗".
- Sections:
  - **Friends** (people you've added), each with their flow bar segment.
  - **In your groups** (people you share a group with but haven't added),
    with a quiet "Add as friend" where possible.
  - Name-only people are labelled "not on Divvy yet".
- **Friend page:**
  - Header: their avatar and colour, the overall balance with words, "Settle
    up" and "Add expense".
  - **All shared history** (group and direct), filterable by group, so
    nothing hides behind "Made up of 2 balances".

### 3.8 Activity
- Each row has the actor's avatar (person colour), a sentence with the
  important words in medium weight, a caption with the group emoji, name and
  time, and a trailing effect ("you owe €21").
- Days are grouped ("Today", "Yesterday", "Mon 13 Oct").
- Unread rows have a small ink dot. Your own actions are never unread.

### 3.9 You (Account)
- **Top:** your avatar. Tap it to open one sheet with the emoji/initials
  choice and the colour palette.
- Grouped sections:
  1. Profile
  2. Getting paid (payment methods)
  3. Preferences (currency, theme, notifications, privacy screen)
  4. Security & backup (passkeys, devices, recovery key, with the backup
     card here if needed)
  5. Your data (download)
  6. About (privacy page, version, shown as "Version 1.0 (6850b03)" only after
     tapping)
  7. **Danger zone**, separate and at the very end: Sign out, Delete account
- The "may be cleared by your phone" storage card shows only when that's
  actually the case, with a one-tap fix ("Add to Home Screen").

### 3.10 Invites and joining
- **Invite:**
  - A QR code (ink on paper) at the top for someone next to you.
  - The code in Geist Mono beneath it.
  - One "Share invite" button, with "Copy code" as a small text button.
  - "Make a new code" moves to a "…" menu.
- **Join:**
  - "Scan a code" (camera; it uses the phone's barcode reader where
    available) or type it.
  - The preview of the group (emoji, members, your matching name) appears
    as soon as it's recognised.

### 3.11 Desktop (≥1024px)
- The sidebar keeps navigation and the ink "Add expense" button. The logo
  appears only there.
- **Home:** two columns, "Needs you" and Groups on the left, the balance and
  flow bar on the right.
- **Group:** expenses list (max 720px) on the left, Balances (flow map plus
  suggested payments) on the right, both visible at once. Insights opens in
  the right column.
- Panels open as centred dialogs (max 560px), not bottom sheets.
- Rows cap at 720px wide, so names and amounts stay close.

### 3.12 Edges
- **Not found, offline, error:** the same empty-state component (a small flow
  drawing, one line, one action) inside the normal app frame.
- **Offline:** a slim `sheet-2` bar under the header ("Offline · changes will
  send when you're back"), not a floating pill.
- **Loading:** skeleton rows at real row heights; no spinners on lists.
- **Pull to refresh** on Home, Group, Friends and Activity (installed app
  only, where the browser doesn't already do it).

### 3.13 App icon, favicon and splash
- **The mark:** two dots joined by a soft S-curve, ink on paper (the light
  icon) and paper on ink (the dark icon).
- Maskable versions with safe padding.
- The splash screen is the same mark centred on `paper`.

### 3.14 Dark mode ("Night")
- Designed rather than inverted:
  - near-black `paper`
  - sheets one step lighter
  - hairlines that stay visible
  - person colours raised in lightness for contrast
  - jade and vermilion brightened to keep AA contrast
- The theme switch moves to You → Preferences.

---

## Part 4. Interactions

| Where | Gesture | Does |
|---|---|---|
| Expense row | Swipe left | Delete (with Undo) |
| Expense row | Long-press / right-click | Edit · Duplicate · Delete |
| Suggested payment | Swipe left | Remind (if on Divvy) |
| Group row (Home) | Long-press | Settle up · Invite · Archive |
| Any panel | Swipe down / Escape / back | Close **only that panel** |
| Lists | Pull down | Refresh |
| Amount | Tap | Show keypad |

---

## Part 5. Accessibility

- Owed/owe always has words and arrows, never colour alone.
- Contrast is AA for all text in both themes, and person colours are checked
  against white initials.
- The flow map and flow bar have text equivalents (a list) for screen readers.
- Focus ring: 2px ink, visible on every control.
- Touch targets are 44px or more.
- Reduce Motion turns travel and untangle into fades.

---

## Part 6. What's removed

- glass and backdrop blur
- film grain
- aurora blobs
- gradient buttons and button glow
- the floating capsule tab bar and glowing + button
- confetti
- counting up from zero on load
- floating welcome receipts
- sparkle icons
- the italic serif
- the 3D decorative emoji on group cards
- the circular theme wipe
- the page scaling behind sheets
- the duplicate Add button in groups
- the duplicate Simplify switch
- the theme switch on Home
- Friends on Home
- the build hash in the footer

---

## Part 7. Order of work

Each phase is tested (unit, screen and offline suites, the money audits and
the screen tour) and merged on its own.

1. **Fixes:**
   - the unread rules
   - the badge count
   - Escape closing every panel
   - currency from region
   - flags on Windows
   - the desktop device icon
   - the selected amount
   - one money formatter
   - explaining the friend vs group amount
2. **Cleanup:** remove everything in Part 6 that doesn't need the new design,
   and the duplicate controls.
3. **Foundations and components:**
   - colour, type, spacing, icons and motion tokens
   - Geist
   - every component in Part 2
   - the flow bar and flow map
   - the app icon
   - Night mode

   Every screen picks these up as they land.
4. **Screens:** Home rebuilt as "what needs you", then Group, Add expense,
   Settle up, Friends, Activity, You, Invite and Join, and Desktop, each to
   Part 3.
5. **Edges:**
   - the protect-your-account step and moving the recovery key
   - QR invites and scanning
   - undo after every save
   - swipe and long-press
   - pull to refresh
   - the empty, error and offline states
   - before/after screenshots

(The order differs slightly from UX-AUDIT.md. Building the new components
before rebuilding Home means Home is built once, in its final form.)
