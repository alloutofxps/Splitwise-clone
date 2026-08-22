/**
 * Avatar identity.
 *
 * Nobody uploads a photo in this app, so a person is recognised by the shape of
 * their initials chip: a stable colour plus one or two letters. Stability is
 * the whole point - the same person must look identical on every screen and on
 * everyone's device, so the colour is derived from a hash of their name rather
 * than assigned in join order.
 */

export const AVATAR_COLORS = [
  "iris",
  "violet",
  "fuchsia",
  "rose",
  "orange",
  "amber",
  "lime",
  "teal",
  "cyan",
  "sky",
] as const;

export type AvatarColor = (typeof AVATAR_COLORS)[number];

/** FNV-1a. Cheap, well-spread, and identical in every JS runtime. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function colorForName(name: string): AvatarColor {
  return AVATAR_COLORS[hash(name.trim().toLowerCase()) % AVATAR_COLORS.length];
}

/**
 * Initials from a display name.
 *
 * Takes the first letter of the first and last words, which reads better than
 * two letters of one word for "Ana Maria" and still does something sensible for
 * a single name or an emoji-only one.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";

  // Grapheme-aware enough for the common cases: an emoji or accented letter
  // counts as one character rather than half a surrogate pair.
  const first = [...words[0]][0] ?? "";
  if (words.length === 1) return first.toUpperCase();

  const last = [...words[words.length - 1]][0] ?? "";
  return (first + last).toUpperCase();
}

/** Short label used where space is tight, e.g. "Ana M." */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return name.trim();
  return `${words[0]} ${[...words[words.length - 1]][0]}.`;
}
