"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Plus, Search, UsersRound } from "lucide-react";
import { useDashboard } from "@/lib/client/queries";
import { Amount } from "@/components/ui/money";
import { AvatarStack } from "@/components/ui/avatar";
import { Button, EmptyState, SectionHeader, cn } from "@/components/ui/primitives";
import { listItem } from "@/components/ui/motion";
import { NewGroupSheet } from "@/components/group/new-group-sheet";
import { JoinSheet } from "@/components/group/join-sheet";
import { ImportSheet } from "@/components/group/import-sheet";
import { Wordmark } from "@/components/app-shell";
import type { DashboardPayload } from "@/lib/client/queries";
import type { GroupSummaryDto } from "@/lib/types";

export default function HomePage() {
  const { data } = useDashboard();
  const [newGroup, setNewGroup] = React.useState(false);
  const [joining, setJoining] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  if (!data) return null;

  const active = data.groups.filter((group) => !group.archivedAt);
  const archived = data.groups.filter((group) => group.archivedAt);

  return (
    <div className="pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="mb-4 flex items-center justify-between gap-4">
        <Wordmark />
        <Link
          href="/search"
          aria-label="Search expenses"
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 active:scale-90 lg:hidden"
        >
          <Search className="size-[20px]" />
        </Link>
      </header>

      <Hero data={data} />

      {active.length === 0 && data.friends.length === 0 ? (
        <FirstRun
          onCreate={() => setNewGroup(true)}
          onJoin={() => setJoining(true)}
          onImport={() => setImporting(true)}
        />
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
                  description="Make a group for a trip, your flat or a night out. Add what people paid and Divvy works out who owes who."
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
              {archived.length > 0 ? (
                <div className="mt-9 xl:mt-0">
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

      <NewGroupSheet
        open={newGroup}
        onClose={() => setNewGroup(false)}
        onImport={() => {
          setNewGroup(false);
          setImporting(true);
        }}
      />
      <JoinSheet open={joining} onClose={() => setJoining(false)} />
      <ImportSheet open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The headline: where you stand, and underneath it the two halves that make it
 * up, so "€187 overall" is never the only thing you can see.
 */
function Hero({ data }: { data: DashboardPayload }) {
  const totals = Object.entries(data.totals);
  const firstName = data.me.displayName.split(" ")[0];
  const split = breakdown(data);
  const only = totals.length === 1 ? BigInt(totals[0][1]) : 0n;

  return (
    <section className="rounded-[28px] border border-[var(--card-border)] bg-surface p-5 pb-4">
      <p className="text-subhead font-semibold text-muted">
        {greeting()}, <span className="text-text">{firstName}</span>
      </p>

      {totals.length === 0 ? (
        <div className="mt-3">
          <p className="font-display text-display font-bold leading-tight tracking-[-0.03em] text-text">
            All settled up
          </p>
          <p className="mt-2 text-body-lg text-muted">Nobody owes anybody anything.</p>
        </div>
      ) : totals.length === 1 ? (
        <div className="mt-2">
          <Amount value={only} currency={totals[0][0]} size="hero" className="text-hero tracking-[-0.04em]" />
          <p className="mt-2 text-body-lg font-medium text-muted">
            {only > 0n ? "In total, people owe you this much." : "In total, you owe this much."}
          </p>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {totals.map(([currency, value]) => (
            <Amount key={currency} value={value} currency={currency} size="xl" />
          ))}
          <span className="w-full text-body font-semibold text-muted">
            {data.approxTotal ? (
              <>
                In {totals.length} currencies. About{" "}
                <Amount value={BigInt(data.approxTotal.amount) < 0n ? -BigInt(data.approxTotal.amount) : BigInt(data.approxTotal.amount)} currency={data.approxTotal.currency} size="sm" tone="plain" />{" "}
                {BigInt(data.approxTotal.amount) >= 0n ? "owed to you" : "that you owe"} in total.
              </>
            ) : (
              <>in {totals.length} currencies</>
            )}
          </span>
        </div>
      )}

      {split ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Chip direction="in" value={split.owedToYou} currency={split.currency} label="owed to you" />
          <Chip direction="out" value={split.youOwe} currency={split.currency} label="you owe" />
        </div>
      ) : null}
    </section>
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
    <div className="flex items-center gap-2.5 rounded-[18px] bg-surface-2 px-3 py-2.5">
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
    // Archived groups included, to match the headline total.
    if (group.currency !== currency) continue;
    add(BigInt(group.yourNet));
  }
  for (const friend of data.friends) {
    const direct = friend.directNet[currency];
    if (direct) add(BigInt(direct));
  }
  return { currency, owedToYou, youOwe };
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Hi";
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
        className="surface-card flex items-center gap-3.5 p-3.5 transition-colors duration-150 hover:border-line-strong"
      >
        <span
          className="flex size-12 shrink-0 items-center justify-center rounded-[14px] text-title-lg"
          style={{ background: `color-mix(in oklch, ${colour} 18%, var(--surface))` }}
        >
          {group.emoji}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-display text-subhead font-bold tracking-[-0.01em] text-text">
              {group.name}
            </span>
            {group.unreadCount > 0 ? (
              <span className="size-2 shrink-0 rounded-full bg-brand" aria-label="New activity" />
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

// ---------------------------------------------------------------------------

function FirstRun({
  onCreate,
  onJoin,
  onImport,
}: {
  onCreate: () => void;
  onJoin: () => void;
  onImport: () => void;
}) {
  return (
    <div className="surface-card mt-8 rounded-[28px] p-6">
      <h2 className="font-display text-heading font-extrabold tracking-[-0.03em] text-text">
        Start your first group
      </h2>
      <p className="mt-1.5 text-body-lg leading-relaxed text-muted">
        Make a group for a trip or the people you live with. Or join a friend&rsquo;s
        group with their invite code.
      </p>

      <div className="mt-5 space-y-2.5">
        <Button variant="primary" size="md" fullWidth onClick={onCreate}>
          <Plus className="size-[18px]" strokeWidth={2.6} />
          Create a group
        </Button>
        <Button variant="secondary" size="md" fullWidth onClick={onJoin}>
          Join with an invite code
        </Button>
        <Button variant="ghost" size="md" fullWidth onClick={onImport}>
          Move a group from Splitwise
        </Button>
      </div>
    </div>
  );
}
