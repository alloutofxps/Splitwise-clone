# Divvy — Design Audit

**Date:** 14 October 2026 · **Scope:** every main screen, light and dark, at phone size (393 × 852)
**References:** Particle (news), Co–Star (astrology), Poolsuite FM (music)

> **The short version.** Divvy is *correct* — accessible colours, a real type scale, careful money formatting — but it looks like a well-made admin panel. Nothing on screen tells you this app is about *friends, trips and dinners*. Every screen is the same white card on the same grey page, in one font, with one accent colour, and nothing moves unless you tap it. The best consumer apps have a point of view. This audit gives Divvy one.

---

## 1. What the reference apps do that Divvy doesn't

| | **Particle** | **Co–Star** | **Poolsuite FM** | **Divvy today** |
|---|---|---|---|---|
| **Point of view** | Calm, intelligent, premium | Stark, poetic, a little dramatic | Nostalgic summer, pure fun | None — neutral SaaS |
| **Typography** | Big confident headlines, tight tracking | Editorial serif + mono, type *is* the brand | Pixel-faithful retro type | One font (Inter) everywhere, all the same voice |
| **Colour** | Rich, contextual gradients per story | Black & white, so every accent lands | Saturated sunset palette | One purple, used for buttons |
| **Depth** | Layered translucent cards, real blur | Flat on purpose, depth from contrast | Windows, bevels, drop shadows | Flat cards with 1px borders |
| **Motion** | Fluid, physics-based, cards that respond | Slow, deliberate fades — mood over speed | Boot screens, theme-switch animations, easter eggs | List fade-in only |
| **Moments** | Summaries reveal like a story | Daily reading feels like an event | Start-up sequence, martini close buttons | Settling a debt — the best moment in a money app — gets a grey toast |
| **Copy** | Clear, warm | Cryptic, memorable | Playful | Functional ("you are owed overall") |

**Takeaways to borrow**
- From **Co–Star**: let *type* carry personality. One expressive display face for the numbers people look at, one elegant serif for the emotional words.
- From **Particle**: depth through layers — glass, glows, cards that sit *above* a living background, and physics-based motion so things feel like objects.
- From **Poolsuite**: *moments*. A tiny celebration when something good happens, a theme switch that feels like an event, details people notice on the third use.

---

## 2. Findings

### Visual (UI)
1. **No typographic hierarchy of personality.** Inter for a €187 balance and for "Settings". The most important number in the app looks like a form field value.
2. **The home screen is a stack of identical white rectangles.** Groups and friends look the same; nothing tells a trip apart from a flat share except a 44px emoji.
3. **No depth.** Cards are flat with a 1px border; the page behind is flat grey. Nothing feels layered, so nothing feels tactile.
4. **The balance hero has no container.** The single most important thing on screen floats in empty space with no mood — owed, owing and square all look the same apart from text colour.
5. **Colour is used only for buttons and +/−.** Each group already has a colour in the data, and it is barely used.
6. **Placeholder avatars have a dashed ring** that reads as a rendering glitch at small sizes, not as "hasn't joined yet".
7. **The tab bar is a generic web footer**: full-width, hairline border, flat purple circle for Add.
8. **The welcome screen is a SaaS landing page** — feature checklist with icons in pastel squares.

### Interaction (UX)
9. **Numbers jump instead of moving.** When a balance changes it snaps; a counting animation would make the change *legible*.
10. **Sheets slide over a page that doesn't react.** Native apps push the page back (scale + round) so you feel the layer stack.
11. **The best moment has no reward.** Settling up to zero — the whole point of the app — ends with the same toast as an error message, minus the red.
12. **The theme toggle just swaps colours** instead of transitioning.
13. **Pressing things gives little feedback** — a 2% scale on some rows, nothing on others.
14. **Empty states are polite but lifeless** ("No groups yet").

### Feel
15. **The copy has no voice.** "You are owed overall" is accurate and forgettable. "The table owes you €187.82" is the same fact with a personality.
16. **Nothing to discover.** No detail rewards a second look.

---

## 3. The direction: *Golden hour*

The feeling of the end of a trip — warm light, a long table, everyone square. Confident and warm, not childish; premium, not corporate.

- **Type:** *Bricolage Grotesque* for numbers and headlines (expressive, characterful, tabular figures). *Instrument Serif Italic* for emotional words — names, "all square", greetings. Inter stays for everything you read in bulk.
- **Colour:** a sunset gradient (iris → fuchsia → apricot) as the brand mark, used sparingly. A **mood colour** behind the balance: mint glow when you are owed, coral when you owe, iris when you are square. Each group's colour becomes a gradient identity on its card.
- **Depth:** a living background (slow-drifting aurora blobs + fine film grain), glass for anything floating (tab bar, header), cards with a top highlight and soft coloured shadows.
- **Motion:** spring physics everywhere — numbers count, lists assemble, cards press like objects, sheets push the page back, the theme changes with a circular wipe. All of it switches off under *Reduce Motion*.
- **Moments:** confetti when you settle up to zero and when you finish sign-up; a floating "receipts" welcome; playful empty states.

---

## 4. What was changed

See the "Design pass" commit on the `fix/production-audit` branch, and before/after screenshots in the PR.

| # | Change | Fixes |
|---|---|---|
| 1 | Display + serif fonts, self-hosted via `next/font` | 1, 15 |
| 2 | Sunset brand gradient, mood colours, glows, film grain, glass tokens | 3, 5 |
| 3 | Living aurora background tied to your balance mood | 3, 4 |
| 4 | Home hero card: counting balance, mood gradient, serif greeting, owed/owe split | 4, 9, 15 |
| 5 | Group cards with gradient identity tiles and spring press | 2, 5, 13 |
| 6 | Floating glass tab bar with sliding indicator and a glowing gradient Add button | 7 |
| 7 | Sheets push the page back (scale + rounded corners) | 10 |
| 8 | Counting numbers (`AnimatedAmount`) on every headline balance | 9 |
| 9 | Confetti when you settle up and when sign-up finishes | 11 |
| 10 | Circular-wipe theme transition | 12 |
| 11 | Welcome screen with floating receipts and editorial type | 8 |
| 12 | Group header banner in the group's own gradient | 2, 5 |
| 13 | Calmer placeholder avatars (soft dotted ring, desaturated) | 6 |
| 14 | Warmer copy and livelier empty states | 14, 15 |
| 15 | Lists on Home and Friends assemble row by row instead of blinking in | 13 |
| 16 | Avatar colour picker fits on one row, each swatch lit like a bead | 1 |

**Found while checking the result on screen:**

- The frosted-glass blur never reached Chrome, Edge or Android. The CSS
  compiler folded the two copies of the blur rule into one and kept only the
  Safari spelling, so the tab bar was plain see-through and rows read through
  it as a second set of labels. Fixed by writing the rule once and letting the
  compiler add the Safari copy; the glass is also a little more opaque and the
  list now fades out before it reaches the bar.
- Welcome-screen receipts were cut off ("Pizza ni…"). Wider cards, spread
  across whatever width the phone has.
- New card shadows had replaced two input focus rings (Search, Join with a
  code) and the selected-colour ring on Account. Each keeps its ring again.

**Guard rails kept:** every colour still meets contrast in both themes, balances are still stated in words as well as colour, and everything animated honours the operating system's *Reduce Motion* setting (set once for the whole app, so new animations inherit it).
