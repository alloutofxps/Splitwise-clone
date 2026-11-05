"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { Activity, Home, Plus, Search, User, Users, type LucideIcon } from "lucide-react";
import { cn, haptic } from "./ui/primitives";
import { useDashboard } from "@/lib/client/queries";
import { OfflineBanner } from "./offline-banner";
import { PullToRefresh } from "./pull-to-refresh";
import { AppMark } from "./app-mark";
import { DURATION, EASE_ENTER, EASE_STANDARD } from "./ui/motion";
import { PANEL_EXIT_MS, useStageCovered } from "./ui/stage";

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
 *
 * A CSS animation (globals.css, "A screen arriving"), so the browser starts it
 * with the new screen's first picture and runs it on its own animation
 * engine. Started from the page's code, it waited for the new screen's setup
 * to finish: a group's screen stood still for up to 150ms on a mid-range
 * phone before it began to move (PERF-BASELINE 34).
 */
type Arrival = { name: string; ms: number } | null;

function arrival(direction: Direction, reduce: boolean): Arrival {
  if (reduce) return { name: "screen-fade", ms: DURATION.fade * 1000 };
  switch (direction) {
    case "forward":
      return { name: "screen-forward", ms: DURATION.arrive * 1000 };
    case "back":
      return { name: "screen-back", ms: DURATION.change * 1000 };
    case "across":
      return { name: "screen-across", ms: DURATION.quick * 1000 };
    default:
      // The first screen after the app opens takes over from its placeholder.
      return { name: "screen-fade", ms: DURATION.fade * 1000 };
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
  figuresShown = false,
}: {
  children: React.ReactNode;
  onAddExpense: () => void;
  /**
   * The opening outline already showed this screen's balances, from the
   * numbers the page arrived with: the first screen takes over without the
   * fade, which would dim figures that aren't changing (MOTION-SPEC 5).
   */
  figuresShown?: boolean;
}) {
  const pathname = usePathname();
  const { data } = useDashboard();
  const direction = useDirection(pathname);
  const reduce = Boolean(useReducedMotion());

  // While a panel is open the page steps back a little (MOTION-SPEC 1): it is
  // still there, underneath, and you'll come back to it. It shrinks about the
  // middle of what's on screen; the page can't scroll while a panel is up, so
  // that stays true until it closes. The middle is kept up to date as the page
  // scrolls rather than read as the panel opens: reading the scroll position
  // then made the browser lay out the page mid-tap, before the panel had been
  // drawn once.
  const covered = useStageCovered();
  const page = React.useRef<HTMLElement>(null);
  const middle = React.useRef(0);
  React.useEffect(() => {
    const measure = () => (middle.current = window.scrollY + window.innerHeight / 2);
    // Once the first screen has been drawn, then with every scroll and resize.
    const first = window.setTimeout(measure, 0);
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);
  React.useLayoutEffect(() => {
    if (covered && page.current) page.current.style.transformOrigin = `50% ${middle.current}px`;
  }, [covered]);
  const stepBack = covered && !reduce;
  // The first screen, taking over from an outline that already showed its
  // figures, arrives at once.
  const enter = direction === "first" && figuresShown ? null : arrival(direction, reduce);

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
        <motion.main
          ref={page}
          initial={false}
          // A transform string, so the browser runs it on the compositor. The
          // page keeps scale(1) at rest rather than no transform at all:
          // blending from none to scale(0.97) starts at scale 0 and shrinks
          // the page to a dot. Nothing inside the page is pinned to the
          // screen, so a resting transform changes nothing else.
          animate={
            stepBack
              ? { transform: "scale(0.97)", transition: { duration: DURATION.panel, ease: EASE_ENTER } }
              : // Coming back forward: it stays on screen, so the in-place curve.
                // The leaving curve stops abruptly, which read as a snap.
                { transform: "scale(1)", transition: { duration: PANEL_EXIT_MS / 1000, ease: EASE_STANDARD } }
          }
          className={cn(
            "mx-auto w-full max-w-[560px] flex-1 px-4 lg:px-8",
            // Home and a group use two columns on a desktop; everything else
            // keeps rows at a readable width.
            pathname === "/" || pathname.startsWith("/groups/") ? "lg:max-w-[1120px]" : "lg:max-w-[720px]",
            // Clears the tab bar plus the home indicator on mobile.
            "pb-[calc(env(safe-area-inset-bottom)+5.5rem)] lg:pb-12",
          )}
        >
          <div
            key={pathname}
            data-screen
            className={enter?.name}
            style={enter ? { animationDuration: `${enter.ms}ms` } : undefined}
          >
            {children}
          </div>
        </motion.main>
      </div>

      <TabBar destinations={destinations} pathname={pathname} onAddExpense={onAddExpense} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Which tab you are under. A group is opened from Home, so Home stays lit
 * inside one, the way a friend's page keeps Friends lit: with nothing lit,
 * the tab bar no longer says where you are.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/groups/");
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
      {/* Under 300px across (200% zoom on a phone) the five words ran into
          each other and "You" was cut off: the icons stay, the words go to
          screen readers only (each link is named anyway). */}
      <div className="@container mx-auto flex h-16 max-w-[560px] items-stretch justify-around px-1.5">
        {left.map((destination) => (
          <TabLink key={destination.href} destination={destination} active={isActive(pathname, destination.href)} exact={pathname === destination.href} />
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
          <TabLink key={destination.href} destination={destination} active={isActive(pathname, destination.href)} exact={pathname === destination.href} />
        ))}
      </div>
    </nav>
  );
}

function TabLink({ destination, active, exact }: { destination: Destination; active: boolean; exact: boolean }) {
  const Icon = destination.icon;

  return (
    <Link
      href={destination.href}
      aria-label={nameWithCount(destination)}
      onClick={() => haptic()}
      // "page" only on the tab's own screen; under it (a group, a friend) it
      // is the current section rather than the current page.
      aria-current={active ? (exact ? "page" : "true") : undefined}
      className={cn(
        "relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors duration-150",
        active ? "text-text" : "text-subtle hover:text-muted",
      )}
    >
      <span className="relative">
        <Icon className="size-[22px]" strokeWidth={active ? 2 : 1.75} />
        {destination.badge ? <Dot count={destination.badge} /> : null}
      </span>
      <span className={cn("text-micro @max-[300px]:sr-only", active ? "font-semibold" : "font-medium")}>
        {destination.label}
      </span>
    </Link>
  );
}

/**
 * The badge's number, said after the tab's name: "Activity, 8 new" rather
 * than "8 Activity". The drawn badge is hidden from speech.
 */
function nameWithCount(destination: Destination): string {
  return destination.badge ? `${destination.label}, ${destination.badge} new` : destination.label;
}

// Pinned by its left edge, where a single digit sits, so a wider "9+" grows
// away from the icon instead of over it.
function Dot({ count }: { count: number }) {
  return (
    <span aria-hidden className="absolute left-3 -top-1 flex min-w-[16px] items-center justify-center rounded-full bg-text px-1 text-micro font-semibold leading-[16px] text-inverse ring-2 ring-surface">
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
              aria-label={nameWithCount(destination)}
              aria-current={active ? (pathname === destination.href ? "page" : "true") : undefined}
              className={cn(
                "relative flex h-10 items-center gap-3 rounded-[var(--radius-md)] px-3 text-body-lg font-medium transition-colors",
                active ? "bg-surface-2 text-text" : "text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              <Icon className="relative size-[18px]" strokeWidth={1.75} />
              <span className="relative">{destination.label}</span>
              {destination.badge ? (
                <span aria-hidden className="relative ml-auto rounded-full bg-text px-1.5 text-micro font-semibold leading-4 text-inverse">
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
      {/* Only the mark where there's no room for the name (Home's header
          at 200% zoom pushed your picture off the edge). */}
      <span className="text-title-lg font-semibold tracking-[-0.03em] text-text @max-[260px]:sr-only">Divvy</span>
    </span>
  );
}
