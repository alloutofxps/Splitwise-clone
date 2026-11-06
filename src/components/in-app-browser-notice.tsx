"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { openedFromHomeScreen } from "@/lib/client/home-screen";
import { inAppBrowserName } from "@/lib/in-app-browser";

const noChanges = () => () => {};

/** Which browser-inside-an-app this is, or null. Strings stay stable while open. */
function detect(): string | null {
  return openedFromHomeScreen() ? null : inAppBrowserName(navigator.userAgent);
}

/**
 * A link tapped in a chat can open inside that app, whose browser is reported to
 * keep its own sign-ins and to lack passkeys. An account made there can be
 * forgotten, so say so before anyone makes one. It's advice and blocks nothing.
 */
export function InAppBrowserNotice({ className }: { className?: string }) {
  const name = React.useSyncExternalStore(noChanges, detect, () => null);
  if (!name) return null;
  return (
    <p className={`flex gap-2.5 rounded-[var(--radius-md)] bg-warning-soft p-3.5 text-body leading-relaxed text-text ${className ?? ""}`}>
      <Info className="mt-0.5 size-[18px] shrink-0 text-warning" strokeWidth={1.75} />
      <span>
        You&rsquo;re in {name}&rsquo;s browser, and Divvy may not remember you here. Look in its menu for
        &ldquo;Open in browser&rdquo;.
      </span>
    </p>
  );
}
