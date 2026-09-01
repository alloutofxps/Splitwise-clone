"use client";

import * as React from "react";

/**
 * Resets a sheet's state at the moment it opens, before anything is painted.
 *
 * Every sheet in the app holds a draft - a name, an amount, a search term - and
 * has to clear it between openings, or last night's half-typed expense is
 * sitting there when you open it for tonight's.
 *
 * Doing that in an effect is the obvious approach and is wrong in a way that is
 * easy to miss: effects run *after* the render commits, so the sheet paints one
 * frame containing the previous session's values and then clears them. It is
 * one frame on a fast phone and more than one on a slow one, and it was
 * measurable here - reopening the new-group sheet showed the last group's name
 * before blanking.
 *
 * Setting state during render is React's documented answer for exactly this
 * (["adjusting state when a prop changes"](https://react.dev/learn/you-might-not-need-an-effect)).
 * React discards the in-progress render and immediately re-runs the component
 * with the new state, so nothing stale ever reaches the screen. It looks
 * alarming and is the supported path; an effect is the alarming one.
 *
 * @param open   whether the sheet is currently open
 * @param reset  clears the sheet's own state. Called during render, so it must
 *               only call this component's setters and must not do anything
 *               else - no fetching, no logging, no timers.
 */
export function useResetOnOpen(open: boolean, reset: () => void): void {
  const [wasOpen, setWasOpen] = React.useState(open);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) reset();
  }
}
