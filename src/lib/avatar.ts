/**
 * Avatar identity.
 *
 * Nobody uploads a photo in this app, so a person is recognised by the shape of
 * their initials chip: a stable colour plus one or two letters. Stability is
 * the whole point - the same person must look identical on every screen and on
 * everyone's device, so the colour is derived from a hash of their name rather
 * than assigned in join order.
 */

/**
 * The ten person hues (DESIGN-PLAN 1.1). Tuned to the same perceived lightness
 * so nobody looks more important than anybody else, and each distinct from its
 * neighbours and from the two money colours.
 */
export const AVATAR_COLORS = [
  "azure",
  "violet",
  "orchid",
  "coral",
  "amber",
  "olive",
  "teal",
  "cobalt",
  "plum",
  "sand",
] as const;

export type AvatarColor = (typeof AVATAR_COLORS)[number];

/**
 * The names stored before the redesign, each moved to its nearest new hue.
 * Accepted on input so a copy of the app that is still open on somebody's
 * phone from before the update can keep saving, and translated on the way in.
 */
const LEGACY_COLORS: Record<string, AvatarColor> = {
  iris: "violet",
  violet: "plum",
  fuchsia: "orchid",
  rose: "coral",
  orange: "sand",
  amber: "amber",
  lime: "olive",
  teal: "teal",
  cyan: "azure",
  sky: "cobalt",
};

/** Every name the API accepts: the ten hues plus the old names. */
export const ACCEPTED_COLORS = [
  ...AVATAR_COLORS,
  ...Object.keys(LEGACY_COLORS).filter((name) => !(AVATAR_COLORS as readonly string[]).includes(name)),
] as [string, ...string[]];

/**
 * A stored or submitted colour name as one of the ten hues.
 *
 * "violet" is both an old name and a new one; the new meaning wins, because
 * by the time anything reads this the stored values have been migrated.
 */
export function normalizeColor(name: string | null | undefined): AvatarColor {
  if (name && (AVATAR_COLORS as readonly string[]).includes(name)) return name as AvatarColor;
  return (name && LEGACY_COLORS[name]) || "cobalt";
}

/** The CSS colour for a hue, for inline styles. */
export function hueVar(name: string | null | undefined): string {
  return `var(--person-${normalizeColor(name)})`;
}

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

/**
 * Hues for the members of one group, so nobody in it shares a colour.
 *
 * Earlier members keep their own choice; a later member whose hue is already
 * taken is shown in the nearest free one (by position on the wheel), for this
 * group only. Their own choice is never changed. With more than ten members
 * hues have to repeat, and they do so in the same order.
 */
export function resolveHues(
  members: { id: string; avatarColor: string | null | undefined }[],
): Map<string, AvatarColor> {
  const result = new Map<string, AvatarColor>();
  const taken = new Set<AvatarColor>();
  for (const member of members) {
    const own = normalizeColor(member.avatarColor);
    let hue = own;
    if (taken.has(own) && taken.size < AVATAR_COLORS.length) {
      const start = AVATAR_COLORS.indexOf(own);
      for (let step = 1; step < AVATAR_COLORS.length; step += 1) {
        const candidate = AVATAR_COLORS[(start + step) % AVATAR_COLORS.length];
        if (!taken.has(candidate)) {
          hue = candidate;
          break;
        }
      }
    }
    taken.add(hue);
    result.set(member.id, hue);
  }
  return result;
}
