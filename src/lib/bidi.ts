/**
 * Right-to-left names in an English sentence.
 *
 * Names, group names and descriptions are whatever people typed, often in
 * Arabic or Hebrew. Dropped into "Ravi added Taxi · €42.00" unfenced, an
 * Arabic description pulled the amount after it into its own direction and
 * the euro sign landed at the end ("9,999,999.99€").
 *
 * `isolate` fences one piece of typed text with the invisible Unicode isolate
 * marks (U+2068 and U+2069), the plain-text version of <bdi>: inside, the text
 * runs its own way; outside, the sentence is untouched. Speech ignores them.
 *
 * For a name shown on its own, use an element with `dir="auto"` instead (it
 * is also cut at the right end), and never put an isolated string inside one:
 * `dir="auto"` skips isolated text when it looks for the direction.
 */
export function isolate(text: string): string {
  return `⁨${text}⁩`;
}
