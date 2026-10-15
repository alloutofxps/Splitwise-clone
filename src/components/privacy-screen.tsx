"use client";

import * as React from "react";
import { EyeOff } from "lucide-react";
import { readStored, writeStored } from "@/lib/client/storage";
import { useClientValue } from "./ui/state-hooks";

/**
 * The app-switcher privacy screen.
 *
 * When the app is backgrounded, the OS takes a snapshot of whatever is on
 * screen and uses it as the task-switcher card — which for this app is a list
 * of what everyone owes everyone. That card is visible to anyone glancing over
 * a shoulder on a train, and it survives in the switcher long after the app is
 * closed. Covering the app as it leaves is the whole of the feature.
 *
 * Be clear about what this is not. It is not encryption, it is not a lock, and
 * it does not stop anyone holding the unlocked phone from simply reopening the
 * app — the identity cookie and the cached data are right there. It is a
 * curtain, and it is described to the user as one. A PIN gate here would look
 * like a security boundary while providing none, which is worse than an honest
 * curtain.
 *
 * ## Why the class goes on `<html>` and not through React state
 *
 * The snapshot is taken during the transition out. A `setState` in the
 * `blur` handler schedules a render that may well not paint before the phone
 * has already captured the screen, so the curtain would appear *after* the
 * picture was taken — a feature that does nothing, in the exact case it exists
 * for. Toggling a class on the document element inside the handler is
 * synchronous, and the overlay it reveals is already mounted and composited, so
 * the only work left is a style recalculation.
 */

const KEY = "divvy-privacy-screen";
const CLASS = "divvy-private";

/** On by default: it is invisible during use, and the cost of being wrong the
 *  other way is a balance sheet sitting in someone's task switcher. */
function storedPreference(): boolean {
  return readStored(KEY) !== "0";
}

/**
 * The setting as the browser holds it right now. Kept in memory as well as
 * localStorage so a browser that refuses storage (private mode) still honours
 * a change for the rest of the visit.
 */
let remembered: boolean | null = null;
const readSetting = () => remembered ?? storedPreference();

function subscribe(onChange: () => void): () => void {
  // Other instances on this page (the overlay and the settings row are
  // mounted separately) and other tabs.
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function usePrivacyScreenSetting(): [boolean, (value: boolean) => void] {
  // On during the server render too, matching the default.
  const enabled = useClientValue(readSetting, true, subscribe);

  const update = React.useCallback((value: boolean) => {
    remembered = value;
    writeStored(KEY, value ? "1" : "0");
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [enabled, update];
}

const EVENT = "divvy:privacy-screen";

export function PrivacyScreen() {
  const [enabled] = usePrivacyScreenSetting();

  React.useEffect(() => {
    const root = document.documentElement;

    if (!enabled) {
      root.classList.remove(CLASS);
      return;
    }

    const show = () => root.classList.add(CLASS);
    const hide = () => root.classList.remove(CLASS);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") show();
      else hide();
    };

    document.addEventListener("visibilitychange", onVisibility);
    // iOS fires `pagehide` on the way into the switcher in cases where
    // visibilitychange arrives too late to matter.
    window.addEventListener("pagehide", show);
    // And `pageshow` on the way back from the back-forward cache, where no
    // visibilitychange may follow.
    window.addEventListener("pageshow", hide);

    /**
     * `blur` is the earliest signal, and the only one that fires before iOS
     * captures the card — but in a browser tab it also fires for the address
     * bar, a devtools click, or an alert, which would flash a curtain over a
     * perfectly visible page. So it is bound only when the app is running as an
     * installed app, where a blur genuinely means "going away".
     */
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;

    if (standalone) {
      window.addEventListener("blur", show);
      window.addEventListener("focus", hide);
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", show);
      window.removeEventListener("pageshow", hide);
      window.removeEventListener("blur", show);
      window.removeEventListener("focus", hide);
      root.classList.remove(CLASS);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      className="privacy-veil no-print"
      aria-hidden="true"
      // Somebody touching the screen is looking at it, whatever the focus
      // events said. The tap only lifts the curtain; nothing under it fires.
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        document.documentElement.classList.remove(CLASS);
      }}
    >
      <span className="flex size-16 items-center justify-center rounded-[var(--radius-lg)] bg-brand text-display-sm font-black text-white">
        D
      </span>
      <p className="mt-4 flex items-center gap-1.5 text-body font-semibold text-muted">
        <EyeOff className="size-3.5" />
        Hidden
      </p>
    </div>
  );
}
