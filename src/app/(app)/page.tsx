"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Plus, Search, Sparkles, UsersRound } from "lucide-react";
import { useDashboard } from "@/lib/client/queries";
import { Amount } from "@/components/ui/money";
import { AvatarStack } from "@/components/ui/avatar";
import { Button, EmptyState, SectionHeader, cn } from "@/components/ui/primitives";
import { NewGroupSheet } from "@/components/group/new-group-sheet";
import { JoinSheet } from "@/components/group/join-sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import type { GroupSummaryDto } from "@/lib/types";

export default function HomePage() {
  const { data } = useDashboard();
  const [newGroup, setNewGroup] = React.useState(false);
  const [joining, setJoining] = React.useState(false);

  if (!data) return null;

  const active = data.groups.filter((group) => !group.archivedAt);
  const archived = data.groups.filter((group) => group.archivedAt);
  const totals = Object.entries(data.totals);

  return (
    <div className="pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="mb-7 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-muted">
            {greeting()}, {data.me.displayName.split(" ")[0]}
          </p>
          <div className="mt-2">
            <TotalHeadline totals={totals} />
          </div>
        </div>

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

      {active.length === 0 && data.friends.length === 0 ? (
        <FirstRun onCreate={() => setNewGroup(true)} onJoin={() => setJoining(true)} />
      ) : (
        <>
          <SectionHeader
            title="Groups"
            action={
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setJoining(true)}
                  className="rounded-[var(--radius-sm)] px-2 py-1 text-[13px] font-semibold text-brand transition active:scale-95 hover:bg-brand-soft"
                >
                  Join
                </button>
                <button
                  onClick={() => setNewGroup(true)}
                  className="flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[13px] font-semibold text-brand transition active:scale-95 hover:bg-brand-soft"
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
              description="Create one for a trip, a flat, or a night out."
              action={
                <Button variant="primary" onClick={() => setNewGroup(true)}>
                  Create a group
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2.5">
              {active.map((group, index) => (
                <motion.li
                  key={group.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  // A short stagger makes the list assemble rather than blink
                  // into place. Capped so a long list is not slow to settle.
                  transition={{ delay: Math.min(index * 0.035, 0.25), duration: 0.3 }}
                >
                  <GroupCard group={group} />
                </motion.li>
              ))}
            </ul>
          )}

          {data.friends.length > 0 ? (
            <div className="mt-8">
              <SectionHeader
                title="Friends"
                action={
                  <Link
                    href="/friends"
                    className="flex items-center gap-0.5 px-2 py-1 text-[13px] font-semibold text-brand"
                  >
                    All
                    <ArrowRight className="size-3.5" />
                  </Link>
                }
              />
              <ul className="space-y-2.5">
                {data.friends.slice(0, 4).map((friend) => (
                  <li key={friend.person.id}>
                    <FriendRow friend={friend} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {archived.length > 0 ? (
            <div className="mt-8">
              <SectionHeader title="Archived" />
              <ul className="space-y-2.5 opacity-70">
                {archived.map((group) => (
                  <li key={group.id}>
                    <GroupCard group={group} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      <NewGroupSheet open={newGroup} onClose={() => setNewGroup(false)} />
      <JoinSheet open={joining} onClose={() => setJoining(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The number at the top of the app.
 *
 * Multi-currency is the awkward case and it is handled honestly: several
 * currencies are listed separately rather than summed at today's rate into a
 * figure that would silently change tomorrow.
 */
function TotalHeadline({ totals }: { totals: [string, string][] }) {
  if (totals.length === 0) {
    return (
      <p className="display-number text-[30px] font-bold tracking-[-0.03em] text-text">
        All settled up
      </p>
    );
  }

  if (totals.length === 1) {
    const [currency, value] = totals[0];
    const amount = BigInt(value);
    return (
      <div>
        <Amount
          value={amount}
          currency={currency}
          size="hero"
          tone={amount > 0n ? "positive" : "negative"}
        />
        <p className="mt-1.5 text-[14px] font-semibold text-muted">
          {amount > 0n ? "you are owed overall" : "you owe overall"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {totals.map(([currency, value]) => (
        <Amount key={currency} value={BigInt(value)} currency={currency} size="xl" />
      ))}
      <span className="w-full text-[13px] font-semibold text-muted">
        across {totals.length} currencies
      </span>
    </div>
  );
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

  return (
    <Link
      href={`/groups/${group.id}`}
      className={cn(
        "flex items-center gap-3.5 rounded-[var(--radius-lg)] border border-line bg-surface p-3.5",
        "shadow-card transition duration-150 active:scale-[0.985] active:bg-surface-2 hover:border-line-strong",
      )}
    >
      <span
        className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[21px]"
        style={{ background: `color-mix(in oklch, var(--avatar-${group.color}) 16%, transparent)` }}
      >
        {group.emoji}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold text-text">{group.name}</span>
          {group.unreadCount > 0 ? (
            <span className="size-2 shrink-0 rounded-full bg-brand" aria-label="New activity" />
          ) : null}
        </span>
        <span className="mt-1 block">
          <AvatarStack people={group.members} size="xs" max={5} />
        </span>
      </span>

      <span className="shrink-0 text-right">
        {net === 0n ? (
          <span className="text-[13px] font-semibold text-subtle">settled</span>
        ) : (
          <>
            <Amount value={net} currency={group.currency} size="md" />
            <span className="mt-0.5 block text-[11px] font-semibold text-subtle">
              {net > 0n ? "you are owed" : "you owe"}
            </span>
          </>
        )}
      </span>
    </Link>
  );
}

function FriendRow({
  friend,
}: {
  friend: { person: { id: string; displayName: string; avatarColor: string; avatarEmoji: string | null; isGhost: boolean }; net: Record<string, string> };
}) {
  const entries = Object.entries(friend.net);

  return (
    <Link
      href={`/friends/${friend.person.id}`}
      className="flex items-center gap-3.5 rounded-[var(--radius-lg)] border border-line bg-surface p-3.5 shadow-card transition active:scale-[0.985] active:bg-surface-2"
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white"
        style={{ background: `var(--avatar-${friend.person.avatarColor})` }}
      >
        {friend.person.avatarEmoji ?? friend.person.displayName.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text">
        {friend.person.displayName}
      </span>
      <span className="shrink-0 text-right">
        {entries.length === 0 ? (
          <span className="text-[13px] font-semibold text-subtle">settled</span>
        ) : (
          entries.map(([currency, value]) => {
            const amount = BigInt(value);
            return (
              <span key={currency} className="block">
                <Amount value={amount} currency={currency} size="sm" className="block" />
                <span className="block text-[10px] font-semibold text-subtle">
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
    <div className="rounded-[var(--radius-xl)] border border-line bg-surface p-6 shadow-card">
      <span className="flex size-11 items-center justify-center rounded-[var(--radius-md)] bg-brand-soft text-brand-soft-text">
        <Sparkles className="size-5" />
      </span>

      <h2 className="mt-4 text-[19px] font-bold tracking-[-0.02em] text-text">
        Let&rsquo;s get you set up
      </h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
        Start a group for a trip or a flat share, or join one a friend has
        already made using their invite code.
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
