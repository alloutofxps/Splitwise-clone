"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Onboarding } from "@/components/onboarding";
import { ExpenseComposer } from "@/components/expense/composer";
import { useDashboard } from "@/lib/client/queries";
import { ApiError } from "@/lib/client/api";
import { Skeleton } from "@/components/ui/primitives";
import { ComposerContext } from "@/components/expense/composer-context";
import { useLaunchIntent } from "@/components/launch-intent";
import { useToast } from "@/components/ui/toast";
import { setBadge } from "@/lib/client/badge";
import type { PendingAttachment } from "@/lib/client/attachments";

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
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data, isLoading, error } = useDashboard();
  const pathname = usePathname();
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
    (groupId?: string) => {
      const fromRoute = /^\/groups\/([^/]+)/.exec(pathname)?.[1];
      setComposer({ open: true, groupId: groupId ?? fromRoute });
    },
    [pathname],
  );

  if (isLoading) return <BootSkeleton />;

  if (error instanceof ApiError && error.isUnauthorized) return <Onboarding />;

  if (error || !data) {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col items-center justify-center px-6 text-center">
        <p className="text-[17px] font-semibold text-text">Could not reach Divvy</p>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          {error instanceof ApiError && error.isOffline
            ? "You appear to be offline. Anything you add will sync once you reconnect."
            : "Something went wrong loading your data."}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 h-11 rounded-[var(--radius-md)] bg-brand px-5 text-[15px] font-semibold text-white"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <ComposerContext.Provider value={{ open: openComposer }}>
      <AppShell onAddExpense={() => openComposer()}>{children}</AppShell>

      <ExpenseComposer
        open={composer.open}
        groupId={composer.groupId}
        initialAttachments={composer.attachments}
        initialDescription={composer.description}
        onClose={() => setComposer({ open: false })}
      />
    </ComposerContext.Provider>
  );
}

/**
 * Matches the shape of the home screen rather than showing a spinner, so the
 * first paint settles into the real content instead of replacing it.
 */
function BootSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[560px] px-4 pt-8 lg:max-w-[720px] lg:px-8">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-11 w-52" />
      <Skeleton className="mt-8 h-4 w-16" />
      <div className="mt-3 space-y-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-[76px] w-full rounded-[var(--radius-lg)]" />
        ))}
      </div>
    </div>
  );
}
