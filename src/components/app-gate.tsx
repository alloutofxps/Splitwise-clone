"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ExpenseComposer } from "@/components/expense/composer-after-load";
import { useDashboard, usePrefetch } from "@/lib/client/queries";
import { SkeletonFor, TabBarFrame, WelcomeSkeleton } from "@/components/screen-skeletons";
import { ApiError } from "@/lib/client/api";
import { useMounted } from "@/components/ui/primitives";
import { ComposerContext } from "@/components/expense/composer-context";
import { useLaunchIntent } from "@/components/launch-intent";
import { useToast } from "@/components/ui/toast";
import { setBadge } from "@/lib/client/badge";
import { stashedRecoveryKey } from "@/lib/client/recovery";
import type { PendingAttachment } from "@/lib/client/attachments";
import type { ExpenseDto } from "@/lib/types";

/**
 * The gate between "no identity yet" and the app proper.
 *
 * A 401 is not an error state here - it is a brand-new device, which is the
 * expected first experience. So the dashboard query doubles as the identity
 * check and its failure renders onboarding rather than an error.
 *
 * The expense composer is mounted once at this level rather than per screen, so
 * "add expense" opens the same sheet from anywhere and keeps its state while
 * the user navigates behind it.
 *
 * `signedIn` comes from the server, which sees the identity cookie with the
 * very first request: it decides which outline the opening shows before any
 * data has arrived (see app/(app)/layout.tsx).
 */
export function AppGate({ children, signedIn }: { children: React.ReactNode; signedIn: boolean }) {
  const { data, isLoading, error } = useDashboard();
  const pathname = usePathname();

  // Activity is fetched alongside the dashboard rather than after it, so Home
  // opens with "Needs you" complete instead of growing a moment later.
  const prefetch = usePrefetch();
  React.useEffect(() => {
    void prefetch.activity();
  }, [prefetch]);
  const toast = useToast();
  // Gated on having an identity: the share relay is one-shot, so reading it on
  // a device that is about to be shown onboarding would consume the receipt to
  // open a composer that does not exist yet.
  const intent = useLaunchIntent(Boolean(data));
  const [composer, setComposer] = React.useState<{
    open: boolean;
    groupId?: string;
    attachments?: PendingAttachment[];
    description?: string;
    template?: ExpenseDto;
  }>({ open: false });

  /**
   * The home-screen badge.
   *
   * Set from whatever the dashboard last said, which is current as of the last
   * time the app was open and stale after that. That is the honest guarantee
   * for "things happened while you were away", and the reason nothing
   * time-critical is put on it. `setBadge` is a no-op where the API is absent.
   */
  React.useEffect(() => {
    if (data) setBadge(data.unreadActivityCount);
  }, [data]);

  /**
   * A launch that meant "add an expense" — the app shortcut, or a receipt
   * shared in from the camera roll.
   *
   * Gated on the dashboard, because the composer builds its draft from it and
   * opening before it lands would show an empty sheet. The intent is read once
   * and its query string erased, so this cannot fire twice for one launch.
   */
  const intentHandled = React.useRef(false);

  /**
   * Setup owns the screen until setup says it is finished — not until the
   * dashboard starts answering.
   *
   * The identity cookie is set the moment the profile step returns, so from
   * then on any successful dashboard fetch would flip this gate and unmount
   * onboarding. That matters because the recovery key lives in onboarding's
   * state and the server keeps only a hash of it: unmount the component and
   * the key is gone for good, from the one screen whose entire job is to show
   * it. And the fetch that does it need not be one we control — the query
   * refetches on window focus, which is exactly what happens when someone
   * opens a password manager to paste the key somewhere safe.
   *
   * So the flag latches on and is cleared only by onboarding itself.
   */
  const unauthorized = error instanceof ApiError && error.isUnauthorized;
  const [setupOpen, setSetupOpen] = React.useState(false);
  const mounted = useMounted();

  // Latched during render, so onboarding is up on the first frame.
  if (unauthorized && !setupOpen) setSetupOpen(true);

  React.useEffect(() => {
    if (!intent.compose || !data || intentHandled.current) return;
    // Latched, because this effect also depends on `data` and the dashboard
    // refetches on every window focus - without the latch, closing the composer
    // and switching apps would reopen it.
    intentHandled.current = true;
    setComposer({
      open: true,
      attachments: intent.attachments,
      description: intent.description,
    });
    if (intent.notice) toast({ tone: "error", title: intent.notice });
  }, [intent, data, toast]);

  /**
   * Opening the composer with no explicit group falls back to the group the
   * user is currently looking at. Adding an expense from inside a group and
   * being asked which group it belongs to is the kind of small stupidity that
   * makes an app feel unfinished.
   */
  const openComposer = React.useCallback(
    (groupId?: string, template?: ExpenseDto) => {
      const fromRoute = /^\/groups\/([^/]+)/.exec(pathname)?.[1];
      setComposer({ open: true, groupId: template?.groupId ?? groupId ?? fromRoute, template });
    },
    [pathname],
  );
  // The same object until the route changes: a new one each time this
  // redraws (the composer opening or closing) redrew every expense row in
  // the app, since each one reads it.
  const composerContext = React.useMemo(() => ({ open: openComposer }), [openComposer]);

  /*
   * A setup interrupted on the recovery step resumes there, even though the
   * account already exists and the dashboard would load perfectly well.
   *
   * The cookie is set at the profile step, so a reload during the recovery
   * screen can land *inside* the app — past the one screen whose entire job is
   * to make sure the key gets written down. Letting that through would mean
   * somebody ends up with a working account and a key they never saw, and
   * finding out later from a warning on the account page.
   *
   * `useMounted` rather than reading storage directly: `sessionStorage` does
   * not exist during the server render, and this is cleared the moment the key
   * is acknowledged, so it stops being true on its own.
   */
  const interruptedSetup = mounted && stashedRecoveryKey() !== null;
  const needsSetup = setupOpen || unauthorized || interruptedSetup;
  // Fetched at once on a device with no account, otherwise only when needed.
  const setup = useOnboardingScreen(!signedIn || needsSetup);

  // Still the opening's outline while sign-up arrives: the same element in the
  // same place, so its drawing carries on rather than starting again.
  if (isLoading || (needsSetup && !setup.Screen && !setup.failed)) {
    return signedIn ? <BootSkeleton pathname={pathname} /> : <WelcomeSkeleton />;
  }

  if (needsSetup) {
    if (setup.Screen) return <setup.Screen onFinished={() => setSetupOpen(false)} />;
    // Never the app instead: an interrupted setup must show its recovery key.
    return <Unreachable offline={!navigator.onLine} />;
  }

  if (error || !data) {
    return <Unreachable offline={error instanceof ApiError && error.isOffline} />;
  }

  return (
    <ComposerContext.Provider value={composerContext}>
      <AppShell onAddExpense={() => openComposer()}>{children}</AppShell>

      <ExpenseComposer
        open={composer.open}
        groupId={composer.groupId}
        initialAttachments={composer.attachments}
        initialDescription={composer.description}
        template={composer.template}
        onClose={() => setComposer({ open: false })}
      />
    </ComposerContext.Provider>
  );
}

/** The app can't start: the dashboard, or the sign-up screens, couldn't be fetched. */
function Unreachable({ offline }: { offline: boolean }) {
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col items-center justify-center px-6 text-center">
      <p className="text-title font-semibold text-text">Couldn&rsquo;t reach Divvy</p>
      <p className="mt-2 text-body-lg leading-relaxed text-muted">
        {offline
          ? "You seem to be offline. Anything you add will be saved when you're back online."
          : "Something went wrong while loading. Please try again."}
      </p>
      <button
        onClick={() => window.location.reload()}
        className="mt-6 h-11 rounded-[var(--radius-md)] bg-brand px-5 text-subhead font-semibold text-inverse"
      >
        Try again
      </button>
    </div>
  );
}

type OnboardingScreen = typeof import("@/components/onboarding").Onboarding;

/**
 * The sign-up screens (about 12 KB with the passkey library, the currency
 * guess and the emoji picker), fetched only when `wanted`. Everyone already
 * signed in stopped downloading them with every screen.
 */
function useOnboardingScreen(wanted: boolean): { Screen: OnboardingScreen | null; failed: boolean } {
  const [state, setState] = React.useState<{ Screen: OnboardingScreen | null; failed: boolean }>({
    Screen: null,
    failed: false,
  });
  const loaded = state.Screen !== null;
  React.useEffect(() => {
    if (!wanted || loaded) return;
    let live = true;
    import("@/components/onboarding").then(
      (m) => live && setState({ Screen: m.Onboarding, failed: false }),
      () => live && setState({ Screen: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [wanted, loaded]);
  return state;
}

/**
 * While the app opens: the outline of the screen it is opening on, inside the
 * same frame and with the tab bar already in place, so the first paint settles
 * into the real content instead of being replaced by a different shape.
 */
function BootSkeleton({ pathname }: { pathname: string }) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col">
      <main className="mx-auto w-full max-w-[560px] flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] lg:max-w-[720px] lg:px-8">
        <SkeletonFor pathname={pathname} opening />
      </main>
      <TabBarFrame />
    </div>
  );
}
