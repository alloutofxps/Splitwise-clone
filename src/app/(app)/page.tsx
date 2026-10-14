"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Plus, Search, Sparkles, UsersRound } from "lucide-react";
import { useDashboard } from "@/lib/client/queries";
import { Amount } from "@/components/ui/money";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Button, EmptyState, SectionHeader, cn } from "@/components/ui/primitives";
import { AnimatedAmount, listItem } from "@/components/ui/motion";
import { NewGroupSheet } from "@/components/group/new-group-sheet";
import { JoinSheet } from "@/components/group/join-sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/app-shell";
import { moodFromTotals } from "@/components/ambient";
import type { DashboardPayload } from "@/lib/client/queries";
import type { GroupSummaryDto } from "@/lib/types";

export default function HomePage() {
  const { data } = useDashboard();
  const [newGroup, setNewGroup] = React.useState(false);
  const [joining, setJoining] = React.useState(false);

  if (!data) return null;

  const active = data.groups.filter((group) => !group.archivedAt);
  const archived = data.groups.filter((group) => group.archivedAt);

  return (
    <div className="pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="mb-4 flex items-center justify-between gap-4">
        <Wordmark />
        <div className="flex shrink-0 items-center gap-1">
          <Link
            href="/search"
            aria-label="Search expenses"
            className="flex size-10 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 active:scale-90 lg:hidden"
          >
            <Search className="size-[20px]" />
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <Hero data={data} />

      {active.length === 0 && data.friends.length === 0 ? (
        <FirstRun onCreate={() => setNewGroup(true)} onJoin={() => setJoining(true)} />
      ) : (
        <>
          {/*
            Two columns from xl, one below it. On a phone this is a single
            scroll in priority order; on a desktop the two lists sit side by
            side instead of leaving a screen of empty space.
          */}
          <div className="mt-8 xl:grid xl:grid-cols-[1.35fr_1fr] xl:items-start xl:gap-8">
            <div className="min-w-0">
              <SectionHeader
                title="Groups"
                action={
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setJoining(true)}
                      className="rounded-full px-3 py-1.5 text-body font-semibold text-brand transition active:scale-95 hover:bg-brand-soft"
                    >
                      Join
                    </button>
                    <button
                      onClick={() => setNewGroup(true)}
                      className="flex items-center gap-1 rounded-full bg-brand-soft px-3 py-1.5 text-body font-semibold text-brand-soft-text transition active:scale-95"
                    >
                      <Plus className="size-3.5" strokeWidth={2.8} />
                      New
                    </button>
                  </div>
                }
              />

              {active.length === 0 ? (
                <EmptyState
                  icon={<UsersRound className="size-6" />}
                  title="No groups yet"
                  description="A trip, a flat, a Friday night. Start one and the maths takes care of itself."
                  action={
                    <Button variant="primary" onClick={() => setNewGroup(true)}>
                      Create a group
                    </Button>
                  }
                />
              ) : (
                <ul className="space-y-3">
                  {active.map((group, index) => (
                    <motion.li key={group.id} custom={index} variants={listItem} initial="hidden" animate="shown">
                      <GroupCard group={group} />
                    </motion.li>
                  ))}
                </ul>
              )}
            </div>

            <div className="min-w-0">
              {data.friends.length > 0 ? (
                <div className="mt-9 xl:mt-0">
                  <SectionHeader
                    title="Friends"
                    action={
                      <Link
                        href="/friends"
                        className="flex items-center gap-0.5 rounded-full px-3 py-1.5 text-body font-semibold text-brand transition hover:bg-brand-soft"
                      >
                        All
                        <ArrowRight className="size-3.5" />
                      </Link>
                    }
                  />
                  <ul className="surface-card divide-y divide-line overflow-hidden">
                    {data.friends.slice(0, 4).map((friend, index) => (
                      <motion.li
                        key={friend.person.id}
                        custom={index + active.length}
                        variants={listItem}
                        initial="hidden"
                        animate="shown"
                      >
                        <FriendRow friend={friend} />
                      </motion.li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {archived.length > 0 ? (
                <div className="mt-9">
                  <SectionHeader title="Archived" />
                  <ul className="space-y-3 opacity-70">
                    {archived.map((group) => (
                      <li key={group.id}>
                        <GroupCard group={group} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}

      <NewGroupSheet open={newGroup} onClose={() => setNewGroup(false)} />
      <JoinSheet open={joining} onClose={() => setJoining(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The headline: where you stand, as a lit card in the colour of it.
 *
 * Mint when the table owes you, coral when you owe, iris when you are square.
 * The figure counts up to its value, and underneath it the two halves that
 * make it up - so "€187 overall" is never the only thing you can see.
 */
function Hero({ data }: { data: DashboardPayload }) {
  const totals = Object.entries(data.totals);
  const mood = moodFromTotals(data.totals);
  const firstName = data.me.displayName.split(" ")[0];
  const split = breakdown(data);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 200, damping: 22 }}
      className="relative overflow-hidden rounded-[28px] border border-[var(--card-border)] bg-surface p-5 pb-4"
      style={{
        boxShadow:
          "var(--highlight), 0 24px 48px -20px color-mix(in oklch, var(--mood) 55%, transparent), var(--shadow-md)",
      }}
    >
      {/* The light inside the card: two washes of the mood colour. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-[background] duration-1000"
        style={{
          background:
            "radial-gradient(90% 80% at 0% 0%, color-mix(in oklch, var(--mood) 30%, transparent) 0%, transparent 60%), radial-gradient(70% 70% at 100% 100%, color-mix(in oklch, var(--mood-2) 22%, transparent) 0%, transparent 65%)",
        }}
      />

      <div className="relative">
        <p className="text-subhead font-semibold text-muted">
          {greeting()},{" "}
          <span className="font-serif text-title-lg italic font-normal text-text">{firstName}</span>
        </p>

        {totals.length === 0 ? (
          <div className="mt-3">
            <p className="font-serif text-display-lg italic leading-none text-text">
              All square <Sparkles className="inline size-7 -translate-y-1 text-brand" />
            </p>
            <p className="mt-2 text-body-lg text-muted">Not a cent outstanding, anywhere.</p>
          </div>
        ) : totals.length === 1 ? (
          <div className="mt-2">
            <AnimatedAmount
              value={totals[0][1]}
              currency={totals[0][0]}
              fromZero
              className={cn(
                "font-display text-hero font-extrabold leading-none tracking-[-0.04em]",
                BigInt(totals[0][1]) > 0n ? "text-positive-text" : "text-negative-text",
              )}
            />
            <p className="mt-2 text-body-lg font-medium text-muted">{moodLine(mood)}</p>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {totals.map(([currency, value]) => (
              <AnimatedAmount
                key={currency}
                value={value}
                currency={currency}
                fromZero
                className={cn(
                  "font-display text-display font-extrabold tracking-[-0.03em]",
                  BigInt(value) > 0n ? "text-positive-text" : "text-negative-text",
                )}
              />
            ))}
            <span className="w-full text-body font-semibold text-muted">across {totals.length} currencies</span>
          </div>
        )}

        {split ? (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Chip direction="in" value={split.owedToYou} currency={split.currency} label="owed to you" />
            <Chip direction="out" value={split.youOwe} currency={split.currency} label="you owe" />
          </div>
        ) : null}
      </div>
    </motion.section>
  );
}

function Chip({
  direction,
  value,
  currency,
  label,
}: {
  direction: "in" | "out";
  value: bigint;
  currency: string;
  label: string;
}) {
  const Icon = direction === "in" ? ArrowDownRight : ArrowUpRight;
  return (
    <div className="glass-strong flex items-center gap-2.5 rounded-[18px] px-3 py-2.5">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          direction === "in" ? "bg-positive-soft text-positive-text" : "bg-negative-soft text-negative-text",
        )}
      >
        <Icon className="size-4" strokeWidth={2.6} />
      </span>
      <span className="min-w-0">
        <Amount value={value} currency={currency} size="md" tone="plain" className="block" />
        <span className="block text-caption font-semibold text-subtle">{label}</span>
      </span>
    </div>
  );
}

/**
 * The two halves of a single-currency total: what people owe you, and what you
 * owe them, across every group and direct ledger. Null when there is more than
 * one currency, where halves would mean summing across currencies.
 */
function breakdown(data: DashboardPayload): { currency: string; owedToYou: bigint; youOwe: bigint } | null {
  const currencies = Object.keys(data.totals);
  if (currencies.length !== 1) return null;
  const currency = currencies[0];
  let owedToYou = 0n;
  let youOwe = 0n;
  const add = (value: bigint) => {
    if (value > 0n) owedToYou += value;
    else youOwe -= value;
  };
  for (const group of data.groups) {
    if (group.archivedAt || group.currency !== currency) continue;
    add(BigInt(group.yourNet));
  }
  for (const friend of data.friends) {
    const direct = friend.directNet[currency];
    if (direct) add(BigInt(direct));
  }
  return { currency, owedToYou, youOwe };
}

function moodLine(mood: "owed" | "owe" | "square"): string {
  if (mood === "owed") return "The table owes you. Nice.";
  if (mood === "owe") return "You owe a little. Nothing a transfer can't fix.";
  return "Swings and roundabouts — it all evens out.";
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// ---------------------------------------------------------------------------

function GroupCard({ group }: { group: GroupSummaryDto }) {
  const net = BigInt(group.yourNet);
  const colour = `var(--avatar-${group.color}, var(--avatar-iris))`;

  return (
    <motion.div whileTap={{ scale: 0.975 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}>
      <Link
        href={`/groups/${group.id}`}
        className="surface-card group flex items-center gap-3.5 p-3.5 transition-colors duration-150 hover:border-line-strong"
      >
        {/* The group's own colour as a lit tile - a trip and a flat share now
            look like different things before you read a word. */}
        <span
          className="relative flex size-12 shrink-0 items-center justify-center rounded-[16px] text-title-lg"
          style={{
            background: `linear-gradient(140deg, color-mix(in oklch, ${colour} 30%, var(--surface)) 0%, color-mix(in oklch, ${colour} 55%, var(--surface)) 100%)`,
            boxShadow: `inset 0 1px 0 oklch(1 0 0 / 0.45), 0 6px 14px -6px color-mix(in oklch, ${colour} 70%, transparent)`,
          }}
        >
          <span className="transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
            {group.emoji}
          </span>
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-display text-subhead font-bold tracking-[-0.01em] text-text">
              {group.name}
            </span>
            {group.unreadCount > 0 ? (
              <span className="relative flex size-2 shrink-0" aria-label="New activity">
                <span className="absolute inset-0 animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative size-2 rounded-full bg-brand" />
              </span>
            ) : null}
          </span>
          <span className="mt-1.5 block">
            <AvatarStack people={group.members} size="xs" max={5} />
          </span>
        </span>

        <span className="shrink-0 text-right">
          {net === 0n ? (
            <span className="rounded-full bg-neutral-soft px-2.5 py-1 text-caption font-semibold text-subtle">
              settled
            </span>
          ) : (
            <>
              <Amount value={net} currency={group.currency} size="lg" />
              <span className="mt-0.5 block text-tiny font-semibold text-subtle">
                {net > 0n ? "you are owed" : "you owe"}
              </span>
            </>
          )}
        </span>
      </Link>
    </motion.div>
  );
}

function FriendRow({ friend }: { friend: DashboardPayload["friends"][number] }) {
  const entries = Object.entries(friend.net);

  return (
    <Link
      href={`/friends/${friend.person.id}`}
      className="flex items-center gap-3.5 px-3.5 py-3 transition active:bg-surface-2 hover:bg-surface-2/60"
    >
      <Avatar person={friend.person} size="md" />
      <span className="min-w-0 flex-1 truncate text-subhead font-semibold text-text">
        {friend.person.displayName}
      </span>
      <span className="shrink-0 text-right">
        {entries.length === 0 ? (
          <span className="text-body font-semibold text-subtle">settled</span>
        ) : (
          entries.map(([currency, value]) => {
            const amount = BigInt(value);
            return (
              <span key={currency} className="block">
                <Amount value={amount} currency={currency} size="md" className="block" />
                <span className="block text-micro font-semibold text-subtle">
                  {amount > 0n ? "owes you" : "you owe"}
                </span>
              </span>
            );
          })
        )}
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------

function FirstRun({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <div className="surface-card mt-8 rounded-[28px] p-6">
      <div className="flex -space-x-2 text-display-sm">
        {["🏝️", "🍕", "🏡", "🍻"].map((emoji, index) => (
          <motion.span
            key={emoji}
            initial={{ opacity: 0, y: 10, rotate: -12 }}
            animate={{ opacity: 1, y: 0, rotate: (index - 1.5) * 8 }}
            transition={{ delay: 0.1 + index * 0.08, type: "spring", stiffness: 300, damping: 16 }}
            className="surface-card flex size-12 items-center justify-center rounded-[16px]"
          >
            {emoji}
          </motion.span>
        ))}
      </div>

      <h2 className="mt-5 font-display text-heading font-extrabold tracking-[-0.03em] text-text">
        Let&rsquo;s <span className="font-serif font-normal italic">get you</span> set up
      </h2>
      <p className="mt-1.5 text-body-lg leading-relaxed text-muted">
        Start a group for a trip or a flat share, or join one a friend has already made
        using their invite code.
      </p>

      <div className="mt-5 space-y-2.5">
        <Button variant="primary" size="md" fullWidth onClick={onCreate}>
          <Plus className="size-[18px]" strokeWidth={2.6} />
          Create a group
        </Button>
        <Button variant="secondary" size="md" fullWidth onClick={onJoin}>
          Join with an invite code
        </Button>
      </div>
    </div>
  );
}
