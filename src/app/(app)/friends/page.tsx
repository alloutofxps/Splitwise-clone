"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, UserRoundPlus, Users } from "lucide-react";
import { Amount } from "@/components/ui/money";
import { Avatar } from "@/components/ui/avatar";
import { Button, EmptyState, SectionHeader, Skeleton } from "@/components/ui/primitives";
import { JoinSheet } from "@/components/group/join-sheet";
import { MyCodeSheet } from "@/components/friends/my-code-sheet";
import { useDashboard } from "@/lib/client/queries";

/**
 * Friends.
 *
 * Balances here are the *direct* ledger only — expenses split one-to-one,
 * outside any group. Group debts stay in their group. Rolling the two together
 * would produce a single number nobody can explain: telling someone they owe
 * you 90 when 60 of it is really the flat's electricity is how an app that
 * exists to prevent arguments starts one.
 */
export default function FriendsPage() {
  const { data, isLoading } = useDashboard();
  const [adding, setAdding] = React.useState(false);
  const [myCode, setMyCode] = React.useState(false);

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

  const owing = data.friends.filter((friend) => Object.keys(friend.net).length > 0);
  const settled = data.friends.filter((friend) => Object.keys(friend.net).length === 0);

  return (
    <div className="pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="mb-5 flex items-start justify-between gap-4">
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
          description="Swap codes with someone to split expenses one-to-one, outside of any group."
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

          {settled.length > 0 ? (
            <section>
              <SectionHeader title={owing.length > 0 ? "Settled up" : "All settled up"} />
              <ul className="space-y-2.5">
                {settled.map((friend) => (
                  <li key={friend.person.id}>
                    <FriendCard friend={friend} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <JoinSheet open={adding} onClose={() => setAdding(false)} />
      <MyCodeSheet open={myCode} onClose={() => setMyCode(false)} me={data.me} />
    </div>
  );
}

function FriendCard({
  friend,
}: {
  friend: {
    person: { id: string; displayName: string; avatarColor: string; avatarEmoji: string | null; isGhost: boolean };
    net: Record<string, string>;
    sharedGroupIds: string[];
  };
}) {
  const entries = Object.entries(friend.net);

  return (
    <Link
      href={`/friends/${friend.person.id}`}
      className="flex items-center gap-3.5 rounded-[var(--radius-lg)] border border-line bg-surface p-3.5 shadow-card transition active:scale-[0.985] active:bg-surface-2 hover:border-line-strong"
    >
      <Avatar person={friend.person} size="md" />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-subhead font-semibold text-text">
          {friend.person.displayName}
        </span>
        {friend.sharedGroupIds.length > 0 ? (
          <span className="mt-0.5 flex items-center gap-1 text-caption text-subtle">
            <Users className="size-3" />
            {friend.sharedGroupIds.length} shared{" "}
            {friend.sharedGroupIds.length === 1 ? "group" : "groups"}
          </span>
        ) : null}
      </span>

      <span className="shrink-0 text-right">
        {entries.length === 0 ? (
          <span className="text-body font-semibold text-subtle">settled</span>
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
    </Link>
  );
}
