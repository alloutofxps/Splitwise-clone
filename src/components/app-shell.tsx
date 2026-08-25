"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Activity, Home, Plus, Search, User, Users, type LucideIcon } from "lucide-react";
import { cn, haptic } from "./ui/primitives";
import { useDashboard } from "@/lib/client/queries";
import { OfflineBanner } from "./offline-banner";

/**
 * The frame every screen sits in.
 *
 * Bottom tabs on a phone, a persistent sidebar from `lg` up. Both render the
 * same five destinations, and the add-expense action lives in the middle of the
 * tab bar where a thumb naturally rests - the single most-used action in the
 * app should not be a corner button.
 */

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

  const destinations: Destination[] = [
    { href: "/", label: "Home", icon: Home },
    { href: "/friends", label: "Friends", icon: Users },
    { href: "/activity", label: "Activity", icon: Activity, badge: data?.unreadActivityCount },
    { href: "/account", label: "Account", icon: User },
  ];

  return (
    <div className="flex min-h-[100dvh] flex-col lg:flex-row">
      <Sidebar destinations={destinations} pathname={pathname} onAddExpense={onAddExpense} />

      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <main
          className={cn(
            "mx-auto w-full max-w-[560px] flex-1 px-4 lg:max-w-[720px] lg:px-8",
            // Clears the tab bar plus the home indicator on mobile.
            "pb-[calc(env(safe-area-inset-bottom)+5.25rem)] lg:pb-12",
          )}
        >
          {children}
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
    <nav
      className="no-print glass fixed inset-x-0 bottom-0 z-40 border-t border-line pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="Main"
    >
      <div className="mx-auto flex h-[3.75rem] max-w-[560px] items-stretch justify-around px-2">
        {left.map((destination) => (
          <TabLink key={destination.href} destination={destination} active={isActive(pathname, destination.href)} />
        ))}

        <div className="flex w-16 shrink-0 items-center justify-center">
          <button
            onClick={() => {
              haptic(12);
              onAddExpense();
            }}
            aria-label="Add an expense"
            className="flex size-[3.25rem] -translate-y-3 items-center justify-center rounded-full bg-brand text-white shadow-float transition active:scale-90"
          >
            <Plus className="size-6" strokeWidth={2.6} />
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
      className="relative flex flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 transition"
    >
      <span className="relative">
        <Icon
          className={cn(
            "size-[22px] transition-colors duration-200",
            active ? "text-brand" : "text-subtle",
          )}
          strokeWidth={active ? 2.4 : 2}
        />
        {destination.badge ? <Dot count={destination.badge} /> : null}
      </span>
      <span
        className={cn(
          "text-[10px] font-semibold transition-colors duration-200",
          active ? "text-brand" : "text-subtle",
        )}
      >
        {destination.label}
      </span>
    </Link>
  );
}

function Dot({ count }: { count: number }) {
  return (
    <span className="absolute -right-1.5 -top-1 flex min-w-[16px] items-center justify-center rounded-full bg-negative px-1 text-[9px] font-bold leading-[16px] text-white ring-2 ring-surface">
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
        className="mb-6 flex h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-brand text-[15px] font-semibold text-white shadow-card transition hover:bg-brand-hover active:scale-[0.98]"
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
                "relative flex h-10 items-center gap-3 rounded-[var(--radius-md)] px-3 text-[14px] font-semibold transition",
                active ? "text-brand" : "text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              {active ? (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-[var(--radius-md)] bg-brand-soft"
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                />
              ) : null}
              <Icon className="relative size-[18px]" strokeWidth={active ? 2.4 : 2} />
              <span className="relative">{destination.label}</span>
              {destination.badge ? (
                <span className="relative ml-auto rounded-full bg-negative px-1.5 text-[10px] font-bold leading-4 text-white">
                  {destination.badge > 9 ? "9+" : destination.badge}
                </span>
              ) : null}
            </Link>
          );
        })}

        <Link
          href="/search"
          className={cn(
            "flex h-10 items-center gap-3 rounded-[var(--radius-md)] px-3 text-[14px] font-semibold transition",
            pathname.startsWith("/search")
              ? "bg-brand-soft text-brand"
              : "text-muted hover:bg-surface-2 hover:text-text",
          )}
        >
          <Search className="size-[18px]" />
          Search
        </Link>
      </nav>

      <p className="mt-auto px-3 text-[11px] leading-relaxed text-subtle">
        Every feature, free.
        <br />
        No accounts, no ads, no paywall.
      </p>
    </aside>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span className="flex size-8 items-center justify-center rounded-[10px] bg-brand text-[15px] font-black text-white">
        D
      </span>
      <span className="text-[19px] font-black tracking-[-0.03em] text-text">Divvy</span>
    </span>
  );
}
