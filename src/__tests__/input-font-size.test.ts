import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

/**
 * No text field may render below 16px.
 *
 * Not a style preference. Safari on iOS zooms the whole viewport when a text
 * field is focused whose computed font-size is under 16px, and it does not
 * zoom back out — so the app is left scrolled sideways, with the layout it was
 * carefully given no longer fitting the screen. Tapping the member field while
 * creating a group did exactly that.
 *
 * The type scale already carries the rule (`--text-input: 16px`, commented
 * "never smaller: Safari zooms the viewport below it"), but a token cannot
 * enforce itself: nineteen of the app's thirty-one form controls had drifted
 * onto `text-subhead` or `text-body-lg` because those were the right *visual*
 * size for a compact row. This is the check that makes the token binding.
 *
 * Source-level rather than in a browser, so it covers every field including
 * the ones behind sheets no end-to-end test happens to open.
 */

const PX: Record<string, number> = {
  micro: 10, tiny: 11, caption: 12, body: 13, "body-lg": 14, subhead: 15,
  input: 16, title: 17, "title-lg": 19, heading: 22,
  "display-sm": 26, display: 32, "display-lg": 40, hero: 52,
};

/**
 * Blanks out comments while preserving offsets, so reported line numbers still
 * point at the real source.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|\n)(\s*)\/\/[^\n]*/g, (_m, lead: string, indent: string) => `${lead}${indent}`);
}

interface Control {
  file: string;
  line: number;
  tag: string;
  smallest: number | null;
  classes: string[];
}

/** Every `<input>`, `<textarea>` and `<select>` the app renders. */
function formControls(): Control[] {
  const files = execSync("find src -name '*.tsx'", { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);

  const found: Control[] = [];
  for (const file of files) {
    // Comments first. The numpad's own docstring explains that "the display
    // stays a real `<input>`", and a scanner that reads prose as markup
    // reports a field that does not exist — which is how a guard loses its
    // credibility faster than the thing it guards.
    const src = stripComments(readFileSync(file, "utf8"));
    for (const match of src.matchAll(/<(input|textarea|select)\b/g)) {
      // Walk to the end of the opening tag rather than to the first ">", which
      // would stop inside an arrow function in a handler.
      let i = match.index + match[0].length;
      let depth = 0;
      let quote: string | null = null;
      while (i < src.length) {
        const c = src[i];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'" || c === "`") quote = c;
        else if (c === "{") depth += 1;
        else if (c === "}") depth -= 1;
        else if (c === ">" && depth === 0) break;
        i += 1;
      }
      const tag = src.slice(match.index, i + 1);

      // A checkbox, radio or hidden file input is never typed into, so Safari
      // has no reason to zoom for it.
      if (/type="(checkbox|radio|file)"/.test(tag)) continue;

      const classes = [...tag.matchAll(/\btext-([a-z-]+)\b/g)]
        .map((m) => m[1])
        .filter((name) => name in PX);
      const sizes = classes.map((name) => PX[name]);

      found.push({
        file,
        line: src.slice(0, match.index).split("\n").length,
        tag: match[1],
        smallest: sizes.length > 0 ? Math.min(...sizes) : null,
        classes,
      });
    }
  }
  return found;
}

describe("text fields and the iOS zoom threshold", () => {
  const controls = formControls();

  it("finds the app's form controls at all", () => {
    // A guard on the guard: a parser that silently matched nothing would make
    // every assertion below vacuously true.
    expect(controls.length).toBeGreaterThan(20);
  });

  it("never renders a text field below 16px", () => {
    const tooSmall = controls.filter((c) => c.smallest !== null && c.smallest < 16);
    expect(
      tooSmall.map((c) => `${c.file}:${c.line} <${c.tag}> ${c.classes.join(" ")} = ${c.smallest}px`),
    ).toEqual([]);
  });

  it("states a size rather than inheriting one", () => {
    // An unsized field takes whatever its container happens to be, which is a
    // silent way back under the threshold. The exchange-rate input was exactly
    // this: no size class, inheriting a 15px row.
    const unsized = controls.filter((c) => c.smallest === null);
    expect(unsized.map((c) => `${c.file}:${c.line} <${c.tag}>`)).toEqual([]);
  });
});
