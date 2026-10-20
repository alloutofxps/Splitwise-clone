"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Check, Plus, SlidersHorizontal } from "lucide-react";
import { Amount } from "@/components/ui/money";
import { Avatar, usePersonHue } from "@/components/ui/avatar";
import { Button, EmptyState, Skeleton, cn, haptic } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/client/api";
import { formatMoney } from "@/lib/money";
import { JoinSheet } from "@/components/group/join-sheet";
import { MyCodeSheet } from "@/components/friends/my-code-sheet";
import { useAddFriend, useDashboard, usePrefetch } from "@/lib/client/queries";
import { useOpenScreen } from "@/components/ui/open-screen";
import { TRAVEL_BACK_MS, useArrival } from "@/components/ui/travel";

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
  { value: "outstanding", label: "Anyone with money owed" },
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
        <h1 className="mb-5 text-heading font-semibold tracking-[-0.02em] text-text">Friends</h1>
        <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-card appear-late">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const visible = data.friends.filter((friend) => matches(friend, filter));
  const added = visible.filter((friend) => friend.isFriend);
  const inGroups = visible.filter((friend) => !friend.isFriend);

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
  const list = (map: Map<string, bigint>) => [...map].map(([currency, value]) => formatMoney(value, currency)).join(", ");

  // The bar beside each name is that person's share of the biggest balance on
  // the screen, so the eye finds the large debts first.
  const largest = data.friends.reduce((max, friend) => {
    for (const value of Object.values(friend.net)) {
      const amount = BigInt(value) < 0n ? -BigInt(value) : BigInt(value);
      if (amount > max) max = amount;
    }
    return max;
  }, 0n);

  return (
    <div className="pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h1 className="text-heading font-semibold tracking-[-0.02em] text-text">Friends</h1>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="secondary" onClick={() => setMyCode(true)}>
            My code
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setAdding(true)}
            icon={<Plus className="size-4" strokeWidth={2.4} />}
          >
            Add
          </Button>
        </div>
      </div>

      {data.friends.length === 0 ? (
        <EmptyState
          title="No friends added yet"
          description="Swap codes with a friend to split things between just the two of you. People in your groups show up here too."
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
          <div className="mb-6 flex items-start justify-between gap-3">
            <p className="min-w-0 text-body leading-relaxed text-muted">
              {owed.size === 0 && owes.size === 0 ? (
                <span className="text-text">You&rsquo;re settled up with everyone.</span>
              ) : (
                <>
                  {owed.size > 0 ? (
                    <span className="tabular font-medium text-positive-text">
                      You&rsquo;re owed {list(owed)} <ArrowDownLeft aria-hidden className="inline size-3.5" strokeWidth={2.25} />
                    </span>
                  ) : null}
                  {owed.size > 0 && owes.size > 0 ? <span aria-hidden> · </span> : null}
                  {owes.size > 0 ? (
                    <span className="tabular font-medium text-negative-text">You owe {list(owes)} <ArrowUpRight aria-hidden className="inline size-3.5" strokeWidth={2.25} /></span>
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
                "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors",
                filter === "all" ? "text-muted hover:bg-surface-2" : "bg-text text-inverse",
              )}
            >
              <SlidersHorizontal className="size-[18px]" strokeWidth={1.75} />
            </button>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              title="Nobody matches that"
              description={`No ${FILTERS.find((option) => option.value === filter)?.label.toLowerCase()}.`}
              action={
                <Button variant="secondary" onClick={() => setFilter("all")}>
                  Show everyone
                </Button>
              }
            />
          ) : null}

          {added.length > 0 ? (
            <PeopleSection title="Friends" friends={added} largest={largest} showSettled={showSettled} onShowSettled={() => setShowSettled(true)} />
          ) : null}
          {inGroups.length > 0 ? (
            <PeopleSection
              title="In your groups"
              caption="People you share a group with but haven't added."
              friends={inGroups}
              largest={largest}
              showSettled={showSettled}
              onShowSettled={() => setShowSettled(true)}
              offerAdd
            />
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
                <span className="flex-1 text-body-lg font-medium text-text">{option.label}</span>
                {filter === option.value ? <Check className="size-5 shrink-0 text-text" strokeWidth={2.5} /> : null}
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

/**
 * One list of people: those with money outstanding first, then the settled,
 * folded away once there are enough of them to bury the ones that need you.
 */
function PeopleSection({
  title,
  caption,
  friends,
  largest,
  showSettled,
  onShowSettled,
  offerAdd,
}: {
  title: string;
  caption?: string;
  friends: FriendDto[];
  largest: bigint;
  showSettled: boolean;
  onShowSettled: () => void;
  offerAdd?: boolean;
}) {
  const owing = friends.filter((friend) => Object.keys(friend.net).length > 0);
  const settled = friends.filter((friend) => Object.keys(friend.net).length === 0);
  const fold = owing.length > 0 && settled.length > 3 && !showSettled;
  const rows = fold ? owing : [...owing, ...settled];

  return (
    <section className="mb-8">
      <h2 className="px-1 text-title font-semibold tracking-[-0.01em] text-text">{title}</h2>
      {caption ? <p className="mt-0.5 px-1 text-caption text-muted">{caption}</p> : null}
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-card">
        {rows.map((friend) => (
          <li key={friend.person.id}>
            <FriendRow friend={friend} largest={largest} offerAdd={offerAdd} />
          </li>
        ))}
      </ul>
      {fold ? (
        <button
          onClick={() => {
            haptic();
            onShowSettled();
          }}
          className="mt-2 px-1 text-body text-muted hover:text-text"
        >
          Show {settled.length} settled up
        </button>
      ) : null}
    </section>
  );
}

function FriendRow({ friend, largest, offerAdd }: { friend: FriendDto; largest: bigint; offerAdd?: boolean }) {
  const prefetch = usePrefetch();
  const open = useOpenScreen();
  // Back from their page: its header's pieces fly home into this row.
  const row = React.useRef<HTMLAnchorElement>(null);
  useArrival(row, `back:/friends/${friend.person.id}`, true, TRAVEL_BACK_MS);
  const entries = Object.entries(friend.net);
  const hue = usePersonHue(friend.person);
  const biggest = entries.reduce((max, [, value]) => {
    const amount = BigInt(value);
    return (amount < 0n ? -amount : amount) > (max < 0n ? -max : max) ? amount : max;
  }, 0n);
  const share = largest > 0n ? Number(biggest < 0n ? -biggest : biggest) / Number(largest) : 0;
  const where =
    friend.ledgers.length > 1
      ? `In ${friend.ledgers.length} places`
      : friend.ledgers[0]
        ? friend.ledgers[0].name
          ? `In ${friend.ledgers[0].name}`
          : "Just between you"
        : null;

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Link
        ref={row}
        href={`/friends/${friend.person.id}`}
        prefetch
        onPointerDown={() => void prefetch.friend(friend.person.id)}
        onClick={(event) => open(event, `/friends/${friend.person.id}`, prefetch.friend(friend.person.id))}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <span data-travel="icon" className="shrink-0">
          <Avatar person={friend.person} size="md" />
        </span>
        <span className="min-w-0 flex-1">
          <span data-travel="name" className="block truncate text-body-lg font-medium text-text">
            {friend.person.displayName}
          </span>
          <span className="block truncate text-caption text-subtle">
            {friend.person.isGhost ? "not on Divvy yet" : (where ?? "settled up")}
          </span>
          {/* Their segment of the flow: how big this balance is next to the rest. */}
          {share > 0 ? (
            <span className="mt-1.5 block h-1 w-full max-w-[160px] overflow-hidden rounded-full bg-surface-2">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(6, share * 100)}%`,
                  background:
                    biggest > 0n
                      ? hue
                      : `repeating-linear-gradient(135deg, ${hue} 0 3px, color-mix(in oklch, ${hue} 35%, var(--surface)) 3px 6px)`,
                }}
              />
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-right">
          {entries.length === 0 ? (
            <span className="text-caption text-subtle">settled up</span>
          ) : (
            entries.map(([currency, value]) => {
              const amount = BigInt(value);
              return (
                <span key={currency} className="block">
                  {/* Travels only when it is the one balance, so it lands on the same figure. */}
                  <span data-travel={entries.length === 1 ? "amount" : undefined} className="inline-block">
                    <Amount value={amount} currency={currency} size="md" />
                  </span>
                  <span className="block text-caption text-subtle">{amount > 0n ? "owes you" : "you owe"}</span>
                </span>
              );
            })
          )}
        </span>
      </Link>
      {offerAdd && !friend.person.isGhost ? <AddFriendButton personId={friend.person.id} name={friend.person.displayName} /> : null}
    </div>
  );
}

function AddFriendButton({ personId, name }: { personId: string; name: string }) {
  const add = useAddFriend();
  const toast = useToast();
  return (
    <button
      type="button"
      disabled={add.isPending}
      onClick={() => {
        haptic();
        add.mutate(
          { id: personId },
          {
            onSuccess: () => toast({ tone: "success", title: `Added ${name.split(" ")[0]} as a friend` }),
            onError: (error) =>
              toast({
                tone: "error",
                title: "Couldn\u2019t add them",
                description: error instanceof ApiError ? error.message : undefined,
              }),
          },
        );
      }}
      aria-label={`Add ${name} as a friend`}
      className="shrink-0 rounded-full border border-line px-2.5 py-1 text-caption font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
    >
      Add
    </button>
  );
}
