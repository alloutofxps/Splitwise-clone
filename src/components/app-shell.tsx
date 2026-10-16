"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion, type TargetAndTransition, type Transition } from "framer-motion";
import { Activity, Home, Plus, Search, User, Users, type LucideIcon } from "lucide-react";
import { cn, haptic } from "./ui/primitives";
import { useDashboard } from "@/lib/client/queries";
import { OfflineBanner } from "./offline-banner";
import { PullToRefresh } from "./pull-to-refresh";
import { AppMark } from "./app-mark";
import { EASE_ENTER } from "./ui/motion";

/**
 * The frame every screen sits in.
 *
 * Bottom tabs on a phone, a persistent sidebar from `lg` up. Both render the
 * same five destinations, and the add-expense action lives in the middle of the
 * tab bar where a thumb naturally rests - the single most-used action in the
 * app should not be a corner button.
 */

// ---------------------------------------------------------------------------
// Where each screen sits (MOTION-SPEC 1)

/** The tabs: side by side, so moving between them has no direction. */
const TOP_LEVEL = new Set(["/", "/friends", "/activity", "/account", "/search"]);

/** How deep a screen is: 0 for a tab, 1 for a group or a friend, and so on. */
function depthOf(path: string): number {
  if (TOP_LEVEL.has(path)) return 0;
  return Math.max(1, path.split("/").filter(Boolean).length - 1);
}

type Direction = "first" | "forward" | "back" | "across";

/**
 * Which way you just moved, worked out from where you were: deeper slides in
 * from the right, back out slides in from the left, and between equals
 * (two tabs, or one group to another) there is no direction to show.
 */
function useDirection(pathname: string): Direction {
  const [nav, setNav] = React.useState<{ path: string; direction: Direction }>({ path: pathname, direction: "first" });
  if (nav.path !== pathname) {
    const from = depthOf(nav.path);
    const to = depthOf(pathname);
    setNav({ path: pathname, direction: to > from ? "forward" : to < from ? "back" : "across" });
  }
  return nav.direction;
}

/**
 * How a screen arrives. Only the arrival moves: the screen you left is
 * replaced at once, so the two never fight over the frame, and the tab bar
 * and top bar around them never move at all.
 *
 * It starts partly visible, never at nothing. With the old screen gone in one
 * frame, a fade from zero made that first frame empty paper: the blank flash
 * this was meant to remove.
 */
const STILL = "translateX(0px) scale(1)";

function arrival(direction: Direction, reduce: boolean): { initial: TargetAndTransition; transition: Transition } {
  // Every start states its transform, even when it is "none at all": blending
  // from no transform to one starts at scale 0, and the screen grows from a
  // dot. With motion off, that is the last thing anyone should see.
  if (reduce) return { initial: { opacity: 0.4, transform: STILL }, transition: { duration: 0.15 } };
  switch (direction) {
    case "forward":
      return { initial: { opacity: 0.3, transform: "translateX(32px) scale(1)" }, transition: { duration: 0.3, ease: EASE_ENTER } };
    case "back":
      return { initial: { opacity: 0.3, transform: "translateX(-32px) scale(1)" }, transition: { duration: 0.25, ease: EASE_ENTER } };
    case "across":
      return { initial: { opacity: 0.4, transform: "translateX(0px) scale(0.98)" }, transition: { duration: 0.2, ease: EASE_ENTER } };
    default:
      // The first screen after the app opens takes over from its placeholder.
      return { initial: { opacity: 0.4, transform: STILL }, transition: { duration: 0.15 } };
  }
}

interface Destination {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

export function AppShell({
  children,
  onAddExpense,
}: {
  children: React.ReactNode;
  onAddExpense: () => void;
}) {
  const pathname = usePathname();
  const { data } = useDashboard();
  const direction = useDirection(pathname);
  const reduce = Boolean(useReducedMotion());
  const enter = arrival(direction, reduce);

  const destinations: Destination[] = [
    { href: "/", label: "Home", icon: Home },
    { href: "/friends", label: "Friends", icon: Users },
    { href: "/activity", label: "Activity", icon: Activity, badge: data?.unreadActivityCount },
    { href: "/account", label: "You", icon: User },
  ];

  return (
    <div className="relative flex min-h-[100dvh] flex-col lg:flex-row">
      <Sidebar destinations={destinations} pathname={pathname} onAddExpense={onAddExpense} />

      <div className="flex min-w-0 flex-1 flex-col">
        <PullToRefresh
          enabled={pathname === "/" || pathname.startsWith("/groups/") || pathname === "/friends" || pathname === "/activity"}
        />
        <OfflineBanner />
        <main
          className={cn(
            "mx-auto w-full max-w-[560px] flex-1 px-4 lg:px-8",
            // Home and a group use two columns on a desktop; everything else
            // keeps rows at a readable width.
            pathname === "/" || pathname.startsWith("/groups/") ? "lg:max-w-[1120px]" : "lg:max-w-[720px]",
            // Clears the tab bar plus the home indicator on mobile.
            "pb-[calc(env(safe-area-inset-bottom)+5.5rem)] lg:pb-12",
          )}
        >
          <motion.div
            key={pathname}
            initial={enter.initial}
            // Whole transform strings rather than x and scale, so the browser
            // runs the movement on the compositor: it stays smooth while the
            // new screen is still being drawn on the main thread.
            animate={{ opacity: 1, transform: STILL, transitionEnd: { transform: "none" } }}
            transition={enter.transition}
          >
            {children}
          </motion.div>
        </main>
      </div>

      <TabBar destinations={destinations} pathname={pathname} onAddExpense={onAddExpense} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function TabBar({
  destinations,
  pathname,
  onAddExpense,
}: {
  destinations: Destination[];
  pathname: string;
  onAddExpense: () => void;
}) {
  // The add button is inserted into the middle of the row rather than floating
  // over it, so nothing is ever hidden behind a FAB.
  const left = destinations.slice(0, 2);
  const right = destinations.slice(2);

  return (
    // Docked to the bottom edge with a hairline above it, like the system's
    // own tab bars, and raised one level (MOTION-SPEC 2) so the page reads as
    // passing underneath it.
    <nav
      className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-raised shadow-bar pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="Main"
    >
      <div className="mx-auto flex h-16 max-w-[560px] items-stretch justify-around px-1.5">
        {left.map((destination) => (
          <TabLink key={destination.href} destination={destination} active={isActive(pathname, destination.href)} />
        ))}

        <div className="flex w-[4.5rem] shrink-0 items-center justify-center">
          <button
            onClick={() => {
              haptic(12);
              onAddExpense();
            }}
            aria-label="Add an expense"
            // Floating, the one level-3 thing on the page: it opens a panel.
            className="press-firm flex size-12 items-center justify-center rounded-full bg-brand text-inverse shadow-float hover:bg-brand-hover"
          >
            <Plus className="size-6" strokeWidth={2.4} />
          </button>
        </div>

        {right.map((destination) => (
          <TabLink key={destination.href} destination={destination} active={isActive(pathname, destination.href)} />
        ))}
      </div>
    </nav>
  );
}

function TabLink({ destination, active }: { destination: Destination; active: boolean }) {
  const Icon = destination.icon;

  return (
    <Link
      href={destination.href}
      onClick={() => haptic()}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors duration-150",
        active ? "text-text" : "text-subtle hover:text-muted",
      )}
    >
      <span className="relative">
        <Icon className="size-[22px]" strokeWidth={active ? 2 : 1.75} />
        {destination.badge ? <Dot count={destination.badge} /> : null}
      </span>
      <span className={cn("text-micro", active ? "font-semibold" : "font-medium")}>
        {destination.label}
      </span>
    </Link>
  );
}

function Dot({ count }: { count: number }) {
  return (
    <span className="absolute -right-1.5 -top-1 flex min-w-[16px] items-center justify-center rounded-full bg-text px-1 text-micro font-semibold leading-[16px] text-inverse ring-2 ring-surface">
      {count > 9 ? "9+" : count}
    </span>
  );
}

// ---------------------------------------------------------------------------

function Sidebar({
  destinations,
  pathname,
  onAddExpense,
}: {
  destinations: Destination[];
  pathname: string;
  onAddExpense: () => void;
}) {
  return (
    <aside className="no-print sticky top-0 hidden h-[100dvh] w-[260px] shrink-0 flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
      <Link href="/" className="mb-7 flex items-center gap-2.5 px-2">
        <Wordmark />
      </Link>

      <button
        onClick={onAddExpense}
        className="mb-6 flex h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-brand text-subhead font-semibold text-inverse transition-colors hover:bg-brand-hover"
      >
        <Plus className="size-[18px]" strokeWidth={2.6} />
        Add expense
      </button>

      <nav className="flex flex-col gap-1" aria-label="Main">
        {destinations.map((destination) => {
          const active = isActive(pathname, destination.href);
          const Icon = destination.icon;
          return (
            <Link
              key={destination.href}
              href={destination.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-10 items-center gap-3 rounded-[var(--radius-md)] px-3 text-body-lg font-medium transition-colors",
                active ? "bg-surface-2 text-text" : "text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              <Icon className="relative size-[18px]" strokeWidth={1.75} />
              <span className="relative">{destination.label}</span>
              {destination.badge ? (
                <span className="relative ml-auto rounded-full bg-text px-1.5 text-micro font-semibold leading-4 text-inverse">
                  {destination.badge > 9 ? "9+" : destination.badge}
                </span>
              ) : null}
            </Link>
          );
        })}

        <Link
          href="/search"
          className={cn(
            "flex h-10 items-center gap-3 rounded-[var(--radius-md)] px-3 text-body-lg font-medium transition-colors",
            pathname.startsWith("/search")
              ? "bg-surface-2 text-text"
              : "text-muted hover:bg-surface-2 hover:text-text",
          )}
        >
          <Search className="size-[18px]" strokeWidth={1.75} />
          Search
        </Link>
      </nav>

      <p className="mt-auto px-3 text-tiny leading-relaxed text-subtle">
        Free to use.
        <br />
        No ads. No email or password.
      </p>
    </aside>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <AppMark />
      <span className="text-title-lg font-semibold tracking-[-0.03em] text-text">Divvy</span>
    </span>
  );
}
