/**
 * Avatar emoji.
 *
 * Nobody uploads a photo, so the emoji is the whole of how a person chooses to
 * look in this app. Twelve options made that a lottery rather than a choice:
 * in a group of six there was a real chance two people were already the same
 * cactus, and the odds that any given person found *themselves* in the list
 * were poor.
 *
 * Grouped rather than one long strip, because the picker is a grid you scan.
 * The order within each group is deliberate — the ones people actually reach
 * for come first, so the common case needs no scrolling.
 *
 * Kept to emoji that render as a single glyph on every platform: no ZWJ
 * sequences (👨‍👩‍👧 collapses to boxes on older Android), no skin-tone
 * modifiers (they double the list and invite a choice this app should not be
 * asking anyone to make), no flags (Windows draws them as letter pairs).
 */

export interface EmojiGroup {
  name: string;
  emoji: string[];
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    name: "Faces",
    emoji: [
      "🙂", "😄", "😎", "🤓", "🥳", "😇", "🤠", "🙃",
      "😴", "🤔", "😌", "🥰", "😜", "🫠", "🤩", "😤",
      "🥸", "😺", "👻", "👽", "🤖", "🎃", "💀", "🦸",
    ],
  },
  {
    name: "Animals",
    emoji: [
      "🦊", "🐙", "🐝", "🐳", "🦁", "🐼", "🐨", "🐸",
      "🦉", "🦅", "🐧", "🦆", "🐢", "🦖", "🦀", "🐬",
      "🦋", "🐌", "🐴", "🦄", "🐘", "🦥", "🦔", "🐰",
      "🐶", "🐱", "🐭", "🐹", "🦇", "🕊️", "🦩", "🦜",
    ],
  },
  {
    name: "Food",
    emoji: [
      "🍕", "🌮", "🍜", "🍣", "🍔", "🥐", "🍩", "🍦",
      "🥑", "🍉", "🍓", "🍋", "🥥", "🌶️", "🍄", "🥨",
      "🍿", "🧁", "🍪", "🍫", "☕", "🍵", "🧋", "🍺",
      "🍷", "🥂", "🍹", "🥗", "🍱", "🥟", "🧀", "🍯",
    ],
  },
  {
    name: "Things",
    emoji: [
      "⚡", "🌊", "🎧", "🚲", "🪐", "🌵", "🔥", "❄️",
      "🌈", "⭐", "🌙", "☀️", "🌻", "🌸", "🍀", "🌴",
      "🎸", "🎹", "🎨", "📚", "🎬", "🎲", "🧩", "♟️",
      "⚽", "🏀", "🏂", "🏄", "🧗", "🏕️", "🚀", "✈️",
      "🚗", "🛵", "⛵", "🗺️", "🏔️", "🔭", "💡", "🧭",
    ],
  },
];

/** Flat list, for validation and for anything that just needs "is this one of ours". */
export const ALL_EMOJI: string[] = EMOJI_GROUPS.flatMap((group) => group.emoji);

/**
 * The dozen shown before the picker is opened.
 *
 * Onboarding shows a strip, not a grid: the first screen of a new app is the
 * wrong place for a wall of 128 choices, and anybody who cares can open the
 * full set. These are spread across the groups on purpose.
 */
export const EMOJI_QUICK_PICKS = [
  "🙂", "😎", "🦊", "🐙", "🌵", "🍕",
  "⚡", "🌊", "🎧", "🚲", "🪐", "🐝",
];
