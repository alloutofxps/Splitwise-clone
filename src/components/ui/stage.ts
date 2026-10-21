"use client";

import * as React from "react";

/**
 * The stage: whether a panel is covering the screen, and when it will have
 * finished leaving.
 *
 * Saving happens inside a panel, but what a save changes - a new row, a
 * balance - is on the screen underneath, and the data changes the instant
 * Save is pressed. Shown straight away, the whole change plays out behind the
 * closing panel and nobody sees their money move (MOTION-SPEC, "money").
 *
 * So anything that explains a change waits for the stage to clear and then
 * plays in order: the panel leaves, the row lands, the money counts. A change
 * that arrives with no panel open (somebody else's expense) plays at once.
 */

/** How long a panel takes to leave (MOTION-SPEC: departures, 250ms). */
export const PANEL_EXIT_MS = 250;
/** How long a new row takes to land once the panel has gone. */
export const LAND_MS = 300;
/** Money starts counting halfway through the landing, so the two read as one. */
const COUNT_AFTER_LAND_MS = 150;

export interface StageState {
  /** A panel is open over the screen. */
  covered: boolean;
  /** `performance.now()` at which the last panel will have finished leaving. */
  clearAt: number;
  /**
   * How long after `clearAt` money starts counting: long enough for whatever
   * explains the change (a row landing, a payment travelling) to play first.
   */
  beat: number;
}

let covering = 0;
let state: StageState = { covered: false, clearAt: 0, beat: COUNT_AFTER_LAND_MS };
const listeners = new Set<() => void>();
const SERVER: StageState = state;

function set(next: Partial<StageState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

/** Marks a panel as open. Returns the call that marks it closed again. */
export function coverStage(): () => void {
  covering += 1;
  // A fresh panel starts with the ordinary beat; a save inside it can change it.
  set(covering === 1 ? { covered: true, beat: COUNT_AFTER_LAND_MS } : { covered: true });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    covering -= 1;
    if (covering === 0) set({ covered: false, clearAt: performance.now() + PANEL_EXIT_MS });
  };
}

/**
 * Says how long the explanation of the next change takes, so money waits for
 * it: a row landing by default, a payment travelling along its line.
 */
export function setBeat(ms: number) {
  set({ beat: ms });
}

/**
 * How long after the money starts counting the moment is over: the count
 * itself (600ms) and a little room after it.
 */
const MOMENT_TAIL_MS = 700;

/**
 * Runs `work` once the moment on screen has finished playing: after any open
 * panel has gone, the change has landed and the money has counted.
 *
 * For work the moment doesn't need, such as fetching fresh copies of data
 * that is already showing its new values. Done straight after a save, that
 * work re-drew the screen several times mid-animation, and on a slow phone it
 * was most of what made the money moments stutter.
 */
export function afterMoment(work: () => void) {
  const whenUncovered = () => {
    if (state.covered) {
      const stop = subscribe(() => {
        if (state.covered) return;
        stop();
        whenUncovered();
      });
      return;
    }
    const wait = state.clearAt + state.beat + MOMENT_TAIL_MS - performance.now();
    if (wait <= 0) work();
    else window.setTimeout(work, wait);
  };
  whenUncovered();
}

/**
 * Runs `work` once the panel has started leaving: two frames after the last
 * one is told to close, by when its slide is running in the browser, which
 * keeps it moving however long `work` holds the app up. With no panel open,
 * on the next frame but one.
 *
 * For the work a save sets off that must happen before the moment plays but
 * not before the panel goes: putting the saved row in place, building the tab
 * the moment plays on. Done in the same instant as Save, all of it ran before
 * the panel could even start to leave, and the panel sat still for a tenth
 * of a second on a slow phone.
 */
export function whenPanelLeaving(work: () => void) {
  let done = false;
  let stop: (() => void) | undefined;
  const run = () => {
    if (done) return;
    done = true;
    stop?.();
    window.clearTimeout(fallback);
    work();
  };
  // Even if no frame comes (a hidden tab) or a panel stays open, it happens.
  const fallback = window.setTimeout(run, 1000);
  const soon = () => requestAnimationFrame(() => requestAnimationFrame(run));
  if (!state.covered) return soon();
  stop = subscribe(() => {
    if (state.covered) return;
    stop?.();
    stop = undefined;
    soon();
  });
}

/** The stage as it is right now, for code outside React's render. */
export function stageNow(): StageState {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStage(): StageState {
  return React.useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER,
  );
}

/**
 * The stage, but only while `listening`; null otherwise, and no redraw when
 * it changes. Every row of a ledger waits on the stage only while it is
 * arriving, yet each one used to redraw whenever any panel opened or closed,
 * in the same instant a closing panel was starting to slide.
 */
export function useStageWhile(listening: boolean): StageState | null {
  return React.useSyncExternalStore(
    subscribe,
    () => (listening ? state : null),
    () => (listening ? SERVER : null),
  );
}

/** Whether a panel is open, redrawing only when that changes. */
export function useStageCovered(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => state.covered,
    () => false,
  );
}

/** Milliseconds from now until the panel has gone, or 0 if it already has. */
export function untilClear(stage: StageState): number {
  return Math.max(0, stage.clearAt - performance.now());
}

/** Milliseconds from now until money should start counting. */
export function untilCount(stage: StageState): number {
  return Math.max(0, stage.clearAt + stage.beat - performance.now());
}
