"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpFromLine, Download, Plus, RefreshCw, Share, X } from "lucide-react";
import { cn, haptic } from "./ui/primitives";
import { readStored, writeStored } from "@/lib/client/storage";
import { requestPersistence } from "@/lib/client/persistence";
import { PrivacyScreen } from "./privacy-screen";

/**
 * Installation and updates.
 *
 * Android and desktop Chrome fire `beforeinstallprompt`, which gives a real
 * one-tap install. iOS gives nothing at all — Safari has no install API, and
 * Add to Home Screen is buried two taps into the share sheet — so iOS gets
 * illustrated instructions instead. Getting this wrong is why so many PWAs are
 * never actually installed by their iPhone users.
 *
 * Both prompts are deferred: nobody installs an app they have not used yet, so
 * the ask waits until the person has been around long enough to have entered
 * something.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "divvy-install-dismissed";
const VISITS_KEY = "divvy-visits";
const VISITS_BEFORE_ASKING = 3;

export function PwaProvider() {
  return (
    <>
      <ServiceWorkerManager />
      <StoragePersistence />
      <InstallPrompt />
      <PrivacyScreen />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * Registers the worker and surfaces updates.
 *
 * An update is offered, never forced. Reloading out from under someone who is
 * halfway through entering an expense would lose it.
 */
function ServiceWorkerManager() {
  const [waiting, setWaiting] = React.useState<ServiceWorker | null>(null);

  React.useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    // A worker registered in development caches the dev server's assets and
    // makes every subsequent change invisible.
    if (process.env.NODE_ENV !== "production") return;

    let registration: ServiceWorkerRegistration | undefined;

    const register = async () => {
      try {
        // The build id in the query string is what makes an update detectable:
        // the browser compares the worker script byte for byte, and a script at
        // a URL that never changes is never re-fetched past its cache lifetime.
        // The worker reads it back out of its own location to name its caches.
        registration = await navigator.serviceWorker.register(
          `/sw.js?v=${process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"}`,
          { scope: "/" },
        );

        // A worker already waiting means the page was loaded from the old one.
        if (registration.waiting) setWaiting(registration.waiting);

        registration.addEventListener("updatefound", () => {
          const installing = registration?.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // "installed" with a controller present means an update is ready;
            // without one it is the very first install and there is nothing
            // to tell the user about.
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setWaiting(installing);
            }
          });
        });
      } catch (error) {
        console.warn("[divvy] service worker registration failed", error);
      }
    };

    void register();

    // Check for updates when the app is brought back to the foreground, which
    // is the moment a user is most likely to accept a reload.
    const onVisible = () => {
      if (document.visibilityState === "visible") void registration?.update();
    };
    document.addEventListener("visibilitychange", onVisible);

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!waiting) return null;

  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[55] flex justify-center px-4 sm:bottom-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="pointer-events-auto flex w-full max-w-[420px] items-center gap-3 rounded-[--radius-lg] border border-line bg-elevated px-4 py-3 shadow-float"
      >
        <RefreshCw className="size-[18px] shrink-0 text-brand" />
        <p className="min-w-0 flex-1 text-[13px] font-semibold text-text">
          A new version of Divvy is ready
        </p>
        <button
          onClick={() => {
            haptic();
            waiting.postMessage("skip-waiting");
          }}
          className="shrink-0 rounded-[--radius-sm] bg-brand px-3 py-1.5 text-[13px] font-bold text-white transition active:scale-95"
        >
          Reload
        </button>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Asks the browser not to evict us.
 *
 * The offline outbox holds writes that exist nowhere else until the network
 * returns, so an eviction under storage pressure loses an expense the user
 * typed and watched appear. This is the only lever the platform offers.
 *
 * Asked on every launch rather than once: Chrome grants it only after the app
 * clears an engagement bar that a first-run visitor has not, and being
 * installed is itself part of that bar - so the run that would have been
 * refused in week one succeeds in week two. There is no prompt in Chrome or
 * Safari, and the one Firefox shows is not repeated once answered.
 *
 * Nothing renders and nothing is reported. A refusal makes eviction possible,
 * not imminent, and an app that nagged about a permission the user cannot
 * usefully act on would be worse than one that asks quietly and moves on.
 */
function StoragePersistence() {
  React.useEffect(() => {
    void requestPersistence();
  }, []);

  return null;
}

// ---------------------------------------------------------------------------

function InstallPrompt() {
  const [deferred, setDeferred] = React.useState<InstallPromptEvent | null>(null);
  const [showIos, setShowIos] = React.useState(false);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    // Already installed: `standalone` on iOS, the display-mode query elsewhere.
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (installed) return;

    if (readStored(DISMISSED_KEY)) return;

    const visits = Number(readStored(VISITS_KEY) ?? "0") + 1;
    writeStored(VISITS_KEY, String(visits));
    if (visits < VISITS_BEFORE_ASKING) return;

    const onBeforeInstall = (event: Event) => {
      // Suppress Chrome's own mini-infobar so ours is the only ask.
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // iOS never fires that event, so detect Safari on iOS directly. iPadOS 13+
    // reports as a Mac, hence the touch-points check.
    const ua = window.navigator.userAgent;
    const iosLike =
      /iPad|iPhone|iPod/.test(ua) ||
      (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
    const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);

    if (iosLike && isSafari) {
      setShowIos(true);
      setVisible(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  const dismiss = () => {
    haptic();
    writeStored(DISMISSED_KEY, "1");
    setVisible(false);
  };

  const install = async () => {
    if (!deferred) return;
    haptic();
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") writeStored(DISMISSED_KEY, "1");
    setVisible(false);
    setDeferred(null);
  };

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: "spring", stiffness: 400, damping: 34 }}
          className="no-print fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[55] px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:w-[380px] sm:px-0"
        >
          <div className="relative overflow-hidden rounded-[--radius-xl] border border-line bg-elevated p-4 shadow-float">
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full text-subtle transition active:scale-90 hover:bg-surface-2"
            >
              <X className="size-4" />
            </button>

            <div className="flex items-start gap-3 pr-6">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-[--radius-md] bg-brand text-[19px] font-black text-white">
                D
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-bold tracking-[-0.01em] text-text">
                  Install Divvy
                </p>
                <p className="mt-0.5 text-[13px] leading-snug text-muted">
                  {showIos
                    ? "Add it to your home screen to use it offline and get it out of the browser."
                    : "Works offline, opens instantly, no app store."}
                </p>
              </div>
            </div>

            {showIos ? (
              <ol className="mt-4 space-y-2">
                <IosStep index={1} icon={<Share className="size-4" />}>
                  Tap <strong className="font-semibold">Share</strong> in Safari&rsquo;s
                  toolbar
                </IosStep>
                <IosStep index={2} icon={<Plus className="size-4" />}>
                  Choose{" "}
                  <strong className="font-semibold">Add to Home Screen</strong>
                </IosStep>
                <IosStep index={3} icon={<ArrowUpFromLine className="size-4" />}>
                  Tap <strong className="font-semibold">Add</strong> — that&rsquo;s it
                </IosStep>
              </ol>
            ) : (
              <button
                onClick={() => void install()}
                className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-[--radius-md] bg-brand text-[15px] font-semibold text-white transition active:scale-[0.98]"
              >
                <Download className="size-[18px]" />
                Install
              </button>
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function IosStep({
  index,
  icon,
  children,
}: {
  index: number;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2.5">
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full",
          "bg-surface-2 text-muted",
        )}
      >
        {icon}
      </span>
      <span className="text-[13px] leading-snug text-text">{children}</span>
      <span className="ml-auto shrink-0 text-[11px] font-bold text-subtle">{index}</span>
    </li>
  );
}
