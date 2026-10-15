"use client";

import * as React from "react";

/**
 * Local state that starts from a value passed in and follows it when that
 * value changes, while still being settable here - an optimistic toggle, or a
 * field that shows the saved name until someone edits it.
 *
 * The follow happens during render (React's "adjusting state when a prop
 * changes"), so the screen never paints one frame with the old value and a
 * second with the new one, which is what syncing in an effect does.
 */
export function useMirror<T>(value: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = React.useState(value);
  const [seen, setSeen] = React.useState(value);
  if (!Object.is(seen, value)) {
    setSeen(value);
    setState(value);
  }
  return [state, setState];
}

/**
 * Runs `reset` the moment `open` turns false, during render. The counterpart
 * of `useResetOnOpen`, for state that should not outlive a closed sheet: a
 * secret, a half-written comment, an editor left mounted behind it.
 *
 * `reset` must only call this component's own setters.
 */
export function useResetOnClose(open: boolean, reset: () => void): void {
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) reset();
  }
}

const noSubscribe = () => () => {};

/**
 * A value that only exists in the browser - something in localStorage, the
 * user agent - read so that the server render and the first browser render
 * agree (both use `serverValue`), and the real value follows straight after
 * hydration without an effect.
 *
 * Pass `subscribe` when the value can change while the page is open.
 */
export function useClientValue<T>(
  read: () => T,
  serverValue: T,
  subscribe: (onChange: () => void) => () => void = noSubscribe,
): T {
  return React.useSyncExternalStore(subscribe, read, () => serverValue);
}
