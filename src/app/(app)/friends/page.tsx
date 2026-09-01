"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Plus, SlidersHorizontal, UserRoundPlus } from "lucide-react";
import { Amount } from "@/components/ui/money";
import { Avatar } from "@/components/ui/avatar";
import { Button, EmptyState, SectionHeader, Skeleton, cn, haptic } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/sheet";
import { JoinSheet } from "@/components/group/join-sheet";
import { MyCodeSheet } from "@/components/friends/my-code-sheet";
import { useDashboard } from "@/lib/client/queries";
import type { FriendDto } from "@/lib/types";

/**
 * Friends.
 *
 * The figure beside a name is where the two of you stand in total — every group
 * you share plus the direct ledger, per currency — with the ledgers that
 * produced it listed underneath. Both halves matter: the total is the number
 * people actually want, and the breakdown is what stops it being the number
 * they argue about. Quoting the total alone would be the mirror of the bug this
 * screen used to have, which was quoting the direct ledger alone and calling
 * somebody settled who owed two thousand euros in a shared group.
 */

const FILTERS = [
  { value: "all", label: "Everyone" },
  { value: "outstanding", label: "Outstanding balances" },
  { value: "you-owe", label: "People you owe" },
  { value: "owes-you", label: "People who owe you" },
] as const;

type Filter = (typeof FILTERS)[number]["value"];

/** Positive if they owe you on balance, negative if you owe them. */
function direction(friend: FriendDto): number {
  let sign = 0;
  for (const value of Object.values(friend.net)) {
    const amount = BigInt(value);
    if (amount > 0n) sign += 1;
    else if (amount < 0n) sign -= 1;
  }
  return sign;
}

function matches(friend: FriendDto, filter: Filter): boolean {
  const outstanding = Object.keys(friend.net).length > 0;
  if (filter === "all") return true;
  if (filter === "outstanding") return outstanding;
  if (filter === "you-owe") return outstanding && direction(friend) < 0;
  return outstanding && direction(friend) > 0;
}

export default function FriendsPage() {
  const { data, isLoading } = useDashboard();
  const [adding, setAdding] = React.useState(false);
  const [myCode, setMyCode] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [showSettled, setShowSettled] = React.useState(false);

  if (isLoading || !data) {
    return (
      <div className="pt-[max(1.5rem,env(safe-area-inset-top))]">
        <h1 className="mb-5 text-display-sm font-black tracking-[-0.03em] text-text">Friends</h1>
        <div className="space-y-2.5">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-[68px] w-full rounded-[var(--radius-lg)]" />
          ))}
        </div>
      </div>
    );
  }

  const visible = data.friends.filter((friend) => matches(friend, filter));
  const owing = visible.filter((friend) => Object.keys(friend.net).length > 0);
  const settled = visible.filter((friend) => Object.keys(friend.net).length === 0);

  /**
   * What you owe and what you are owed, kept apart and kept per currency.
   *
   * One netted figure hides your exposure: owed 2,410 and owing 45 is not the
   * same situation as owed 2,365 and owing nothing, and only the second is what
   * a single number can describe.
   */
  const owed = new Map<string, bigint>();
  const owes = new Map<string, bigint>();
  for (const friend of data.friends) {
    for (const [currency, value] of Object.entries(friend.net)) {
      const amount = BigInt(value);
      const bucket = amount > 0n ? owed : owes;
      bucket.set(currency, (bucket.get(currency) ?? 0n) + (amount > 0n ? amount : -amount));
    }
  }

  return (
    <div className="pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h1 className="text-display-sm font-black tracking-[-0.03em] text-text">Friends</h1>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="secondary" onClick={() => setMyCode(true)}>
            My code
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setAdding(true)}
            icon={<Plus className="size-4" strokeWidth={2.8} />}
          >
            Add
          </Button>
        </div>
      </div>

      {data.friends.length === 0 ? (
        <EmptyState
          icon={<UserRoundPlus className="size-6" />}
          title="No friends added yet"
          description="Swap codes with someone to split expenses one-to-one, or share a group with them."
          action={
            <div className="flex gap-2.5">
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add by code
              </Button>
              <Button variant="secondary" onClick={() => setMyCode(true)}>
                Share mine
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="mb-5 flex items-start justify-between gap-3">
            <p className="min-w-0 text-subhead leading-relaxed text-muted">
              {owed.size === 0 && owes.size === 0 ? (
                <span className="font-semibold text-text">You are settled up with everyone.</span>
              ) : (
                <>
                  Overall,{" "}
                  {owes.size > 0 ? (
                    <>
                      you owe{" "}
                      {[...owes].map(([currency, value], index) => (
                        <React.Fragment key={currency}>
                          {index > 0 ? " and " : ""}
                          <Amount value={-value} currency={currency} size="sm" />
                        </React.Fragment>
                      ))}
                    </>
                  ) : null}
                  {owes.size > 0 && owed.size > 0 ? " and " : ""}
                  {owed.size > 0 ? (
                    <>
                      you are owed{" "}
                      {[...owed].map(([currency, value], index) => (
                        <React.Fragment key={currency}>
                          {index > 0 ? " and " : ""}
                          <Amount value={value} currency={currency} size="sm" />
                        </React.Fragment>
                      ))}
                    </>
                  ) : null}
                </>
              )}
            </p>

            <button
              onClick={() => {
                haptic();
                setFilterOpen(true);
              }}
              aria-label="Filter this list"
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-full transition active:scale-90",
                filter === "all"
                  ? "text-muted hover:bg-surface-2"
                  : "bg-brand-soft text-brand-soft-text",
              )}
            >
              <SlidersHorizontal className="size-[18px]" />
            </button>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={<UserRoundPlus className="size-6" />}
              title="Nobody matches that"
              description={`No ${FILTERS.find((option) => option.value === filter)?.label.toLowerCase()}.`}
              action={
                <Button variant="secondary" onClick={() => setFilter("all")}>
                  Show everyone
                </Button>
              }
            />
          ) : null}

          {owing.length > 0 ? (
            <section className="mb-6">
              <SectionHeader title="Outstanding" />
              <ul className="space-y-2.5">
                {owing.map((friend) => (
                  <li key={friend.person.id}>
                    <FriendCard friend={friend} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/*
            Settled friends are folded away by default once there are enough of
            them to bury the ones that need attention. The list is a to-do list
            first and an address book second.
          */}
          {settled.length > 0 ? (
            <section>
              {owing.length > 0 && settled.length > 3 && !showSettled ? (
                <Button
                  variant="secondary"
                  size="md"
                  fullWidth
                  onClick={() => {
                    haptic();
                    setShowSettled(true);
                  }}
                >
                  Show {settled.length} settled-up {settled.length === 1 ? "friend" : "friends"}
                </Button>
              ) : (
                <>
                  <SectionHeader title={owing.length > 0 ? "Settled up" : "All settled up"} />
                  <ul className="space-y-2.5">
                    {settled.map((friend) => (
                      <li key={friend.person.id}>
                        <FriendCard friend={friend} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          ) : null}
        </>
      )}

      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Show">
        <ul className="px-5 pb-6">
          {FILTERS.map((option) => (
            <li key={option.value}>
              <button
                onClick={() => {
                  haptic();
                  setFilter(option.value);
                  setFilterOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-1 py-3.5 text-left transition active:bg-surface-2"
              >
                <span className="flex-1 text-input font-semibold text-text">{option.label}</span>
                {filter === option.value ? (
                  <Check className="size-5 shrink-0 text-brand" strokeWidth={3} />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      <JoinSheet open={adding} onClose={() => setAdding(false)} />
      <MyCodeSheet open={myCode} onClose={() => setMyCode(false)} me={data.me} />
    </div>
  );
}

function FriendCard({ friend }: { friend: FriendDto }) {
  const entries = Object.entries(friend.net);

  return (
    <Link
      href={`/friends/${friend.person.id}`}
      className="block rounded-[var(--radius-lg)] border border-line bg-surface p-3.5 shadow-card transition active:scale-[0.985] active:bg-surface-2 hover:border-line-strong"
    >
      <span className="flex items-center gap-3.5">
        <Avatar person={friend.person} size="md" />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-subhead font-semibold text-text">
            {friend.person.displayName}
          </span>
        </span>

        <span className="shrink-0 text-right">
          {entries.length === 0 ? (
            <span className="text-body font-semibold text-subtle">settled up</span>
          ) : (
            entries.map(([currency, value]) => {
              const amount = BigInt(value);
              return (
                <span key={currency} className="block">
                  <Amount value={amount} currency={currency} size="md" />
                  <span className="block text-micro font-semibold text-subtle">
                    {amount > 0n ? "owes you" : "you owe"}
                  </span>
                </span>
              );
            })
          )}
        </span>
      </span>

      {/*
        Where the figure came from. Only worth the room when there is more than
        one ledger — with a single one the total *is* the breakdown, and
        repeating it would be noise.
      */}
      {friend.ledgers.length > 1 ? (
        <span className="mt-2.5 block border-l-2 border-line pl-3">
          {friend.ledgers.map((ledger) => {
            const amount = BigInt(ledger.net);
            const name = ledger.name ?? "non-group expenses";
            return (
              <span
                key={ledger.groupId ?? "direct"}
                className="block truncate text-caption leading-relaxed text-subtle"
              >
                {amount > 0n ? "Owes you " : "You owe "}
                <Amount value={amount} currency={ledger.currency} size="xs" />
                {ledger.name ? ` in “${name}”` : ` in ${name}`}
              </span>
            );
          })}
        </span>
      ) : null}
    </Link>
  );
}
