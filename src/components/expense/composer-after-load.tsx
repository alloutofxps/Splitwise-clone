"use client";

import * as React from "react";
import { lazyAfterLoad } from "../ui/after-load";
import type { ComposerProps } from "./composer";

/**
 * The expense composer (about 17 KB with the split editor, receipt picker,
 * number pad and pickers), fetched once the page has finished loading rather
 * than with it, for both places that hold one: the app gate (+, a shared
 * receipt) and the expense details (Edit). Tapped before it has arrived, it is
 * asked for at once and opens as soon as it lands; it builds its draft even
 * though it first appears already open (`whenMountedOpen` in composer.tsx).
 */
export const ExpenseComposer = lazyAfterLoad<ComposerProps>(() =>
  import("./composer").then((m) => m.ExpenseComposer),
);

/** Set once the hidden form has been drawn, so it is drawn only once. */
const rehearsal = { drawn: false };

function Drawn() {
  rehearsal.drawn = true;
  return null;
}

const nothing = () => {};

/** The next moment the browser has nothing to do, or a second from now. */
function whenQuiet(then: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(then, { timeout: 3000 });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = window.setTimeout(then, 1000);
  return () => window.clearTimeout(timer);
}

/**
 * The open form, built once out of sight when the page is quiet, then dropped
 * (findings item 54). The first + after the page loaded was the first time
 * the browser ran the form's code: against the second tap it spent 27 to
 * 129ms turning it into machine code and ran it about twice as slowly. Inside
 * a hidden Activity none of it shows and none of its effects run, so nothing
 * takes focus, locks the page's scrolling or fetches; React draws it in spare
 * moments, a little at a time, and stops for anything the person does.
 */
export function ComposerRehearsal() {
  const [stage, setStage] = React.useState<"waiting" | "drawing" | "done">(() =>
    rehearsal.drawn ? "done" : "waiting",
  );

  React.useEffect(() => {
    if (stage === "done") return;
    let live = true;
    let cancel = nothing;
    if (stage === "waiting") {
      ExpenseComposer.load().then(
        () => {
          if (live) cancel = whenQuiet(() => setStage("drawing"));
        },
        nothing,
      );
    } else {
      // Drawn in React's spare time, so looked for at the quiet moments after,
      // and given up on after twenty.
      let looks = 0;
      const look = () => {
        if (rehearsal.drawn || ++looks >= 20) setStage("done");
        else cancel = whenQuiet(look);
      };
      cancel = whenQuiet(look);
    }
    return () => {
      live = false;
      cancel();
    };
  }, [stage]);

  if (stage !== "drawing") return null;
  return (
    <React.Activity mode="hidden">
      <ExpenseComposer open onClose={nothing} />
      <Drawn />
    </React.Activity>
  );
}
