"use client";

import { lazyAfterLoad } from "../ui/after-load";
import type { ComposerProps } from "./composer";

/**
 * The expense composer (about 17 KB with the split editor, receipt picker,
 * number pad and pickers), fetched once the page has finished loading rather
 * than with it, for both places that hold one: the app gate (+, a shared
 * receipt) and the expense details (Edit). Tapped before it has arrived, it is
 * asked for at once and opens as soon as it lands; it builds its draft even
 * though it first appears already open (`whenMountedOpen` in composer.tsx).
 * It shares one file with a group's panels, which use much of the same code.
 */
export const ExpenseComposer = lazyAfterLoad<ComposerProps>(() =>
  import(/* webpackChunkName: "panels" */ "./composer").then((m) => m.ExpenseComposer),
);
