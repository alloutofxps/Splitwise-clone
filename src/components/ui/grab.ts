"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { useDragControls } from "motion/react";

/**
 * Motion's drag, switched on the first time it is pressed.
 *
 * Drag measures the page as it starts up: where it is scrolled to and where
 * the element sits. Started with a panel or a group's rows, that made the
 * browser lay out the whole page in the middle of the tap that brought them
 * in, and again before the frame could be drawn: about 75ms of the tap on +
 * with the processor slowed 4x. Pressed, the page is already laid out, so the
 * same measuring costs next to nothing.
 *
 * Spread `drag` on the motion element with `dragListener={false}`, and call
 * `grab` from the pointerdown that should start the gesture.
 */
export function useGrab() {
  const controls = useDragControls();
  const [grabbable, setGrabbable] = React.useState(false);
  const grab = (event: React.PointerEvent) => {
    // As Motion's own listener: one finger, or the main mouse button.
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    // Drag has to exist before it can be started: mounted now, not next frame.
    if (!grabbable) flushSync(() => setGrabbable(true));
    controls.start(event);
  };
  return { grabbable, grab, controls: grabbable ? controls : undefined };
}
