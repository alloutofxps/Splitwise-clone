import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEXT_SCALE } from "@/lib/type-scale";

/**
 * The scale is declared twice and must not drift.
 *
 * `globals.css` owns the sizes; `TEXT_SCALE` owns the names, because
 * `tailwind-merge` has to be told which classes are font sizes rather than the
 * text colours they are indistinguishable from. A step added to one and not the
 * other fails silently and specifically: the size is dropped only where it
 * meets a colour on the same element, which is most balances and no headings,
 * so it looks like a component bug rather than a missing declaration.
 */
describe("the type scale", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

  const declared = [...css.matchAll(/^\s*--text-([a-z-]+):\s*(\d+)px;/gm)].map((m) => ({
    name: m[1],
    px: Number(m[2]),
  }));

  it("declares every step in the stylesheet", () => {
    expect(declared.map((step) => step.name).sort()).toEqual([...TEXT_SCALE].sort());
  });

  it("has no step outside a sane range", () => {
    for (const step of declared) {
      expect(step.px, step.name).toBeGreaterThanOrEqual(10);
      expect(step.px, step.name).toBeLessThanOrEqual(64);
    }
  });

  it("never drops below the 16px floor for inputs", () => {
    // Safari zooms the viewport when an input's text is smaller than this, and
    // the base layer pins inputs to it - so the named step has to agree.
    expect(declared.find((step) => step.name === "input")?.px).toBeGreaterThanOrEqual(16);
  });

  it("is strictly ascending in the order it is written", () => {
    // The order in TEXT_SCALE is the order a reader will assume the sizes go.
    const byScaleOrder = TEXT_SCALE.map(
      (name) => declared.find((step) => step.name === name)?.px ?? Number.NaN,
    );
    for (let i = 1; i < byScaleOrder.length; i += 1) {
      expect(byScaleOrder[i], TEXT_SCALE[i]).toBeGreaterThan(byScaleOrder[i - 1]);
    }
  });

  it("leaves no raw pixel font sizes behind in components", () => {
    // The point of a scale is that there is one place to change the rhythm, and
    // one `text-[15px]` slipped back in is enough to lose that.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx$/.test(entry.name)) {
          const found = readFileSync(full, "utf8").match(/text-\[\d+px\]/g);
          if (found) offenders.push(`${full}: ${found.join(", ")}`);
        }
      }
    };
    walk(join(process.cwd(), "src"));

    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
