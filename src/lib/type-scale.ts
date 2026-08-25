/**
 * The names in the type scale, as data.
 *
 * Duplicated from the `@theme` block in `globals.css` because two different
 * consumers need them and neither can read the other: CSS defines the sizes,
 * and `tailwind-merge` has to be told which class names are font sizes rather
 * than the text colours they look identical to.
 *
 * The test alongside this file asserts the two lists agree, so adding a step to
 * the stylesheet and forgetting it here fails the build rather than silently
 * dropping that size wherever it meets a colour.
 */
export const TEXT_SCALE = [
  "micro",
  "tiny",
  "caption",
  "body",
  "body-lg",
  "subhead",
  "input",
  "title",
  "title-lg",
  "heading",
  "display-sm",
  "display",
  "display-lg",
  "hero",
] as const;

export type TextStep = (typeof TEXT_SCALE)[number];
