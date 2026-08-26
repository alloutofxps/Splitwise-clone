"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, Plus, Receipt, UserMinus } from "lucide-react";
import { Amount } from "@/components/ui/money";
import { Avatar } from "@/components/ui/avatar";
import { Button, EmptyState, Skeleton, cn, haptic } from "@/components/ui/primitives";
import { ExpenseRow, SettlementRow } from "@/components/group/ledger";
import { ExpenseDetailSheet } from "@/components/expense/detail-sheet";
import { SettleAcrossSheet } from "@/components/friends/settle-across-sheet";
import { useComposer } from "@/components/expense/composer-context";
import { ConfirmSheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useDashboard, useFriend, useRemoveFriend } from "@/lib/client/queries";
import { groupByDay } from "@/lib/day-groups";

/**
 * One friend.
 *
 * The headline is where the two of you stand in total — every group you share
 * plus the direct ledger — because that is the question the page is opened to
 * answer, and it is the figure a single bank transfer settles.
 *
 * It is never quoted on its own, though. Under it sits the breakdown that
 * produced it, group by group, and the ledger below stays direct-only. "You owe
 * me 90" is a useful sentence exactly when both people can see which 90 it is;
 * the earlier version answered that by refusing to add up, which left the
 * friends list reporting "settled up" to someone owed two thousand euros in the
 * only group they shared.
 */
export default function FriendPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const composer = useComposer();

  const { data, isLoading } = useFriend(params.id);
  const { data: dashboard } = useDashboard();

  const [openExpenseId, setOpenExpenseId] = React.useState<string | null>(null);
  const [settleUp, setSettleUp] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [showBreakdown, setShowBreakdown] = React.useState(false);
  const toast = useToast();
  const removeFriend = useRemoveFriend();

  const people = React.useMemo(
    () => new Map((dashboard?.people ?? []).map((person) => [person.id, person])),
    [dashboard?.people],
  );

  if (isLoading || !data || !dashboard) {
    return (
      <div className="pt-8">
        <Skeleton className="h-20 w-full rounded-[var(--radius-xl)]" />
        <div className="mt-4 space-y-2.5">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-[62px] w-full rounded-[var(--radius-lg)]" />
          ))}
        </div>
      </div>
    );
  }

  const meId = dashboard.me.id;
  const grouped = groupByDay(data.items, (item) => item.date);

  // Where the two of you stand in total, and what it is made of.
  const combined = Object.entries(data.combined ?? {});
  const ledgers = data.ledgers ?? [];
  const anythingOutstanding = combined.length > 0 || ledgers.length > 0;

  // Settling is per currency: a euro balance and a rupee balance are two
  // different transfers, and one sheet cannot honestly represent both.
  const settleCurrency = combined[0]?.[0] ?? null;
  const settleLedgers = ledgers.filter((ledger) => ledger.currency === settleCurrency);

  return (
    <div className="pt-[max(0.5rem,env(safe-area-inset-top))]">
      <header className="-mx-1 flex items-center gap-1 py-2">
        <button
          onClick={() => {
            haptic();
            router.back();
          }}
          aria-label="Back"
          className="flex size-10 items-center justify-center rounded-full text-muted transition active:scale-90 hover:bg-surface-2"
        >
          <ChevronLeft className="size-6" />
        </button>
        <h1 className="min-w-0 flex-1 truncate px-1 text-title font-bold tracking-[-0.02em] text-text">
          {data.person.displayName}
        </h1>
      </header>

      {/* Balance ---------------------------------------------------------- */}
      <div className="mt-2 rounded-[var(--radius-xl)] border border-line bg-surface p-5 shadow-card">
        <div className="flex items-center gap-4">
          <Avatar person={data.person} size="lg" />
          <div className="min-w-0 flex-1">
            {!anythingOutstanding ? (
              <>
                <p className="text-subhead font-semibold text-muted">
                  You&rsquo;re all settled up
                </p>
                <p className="mt-0.5 text-body text-subtle">
                  Nothing outstanding, in any group.
                </p>
              </>
            ) : (
              <>
                <p className="text-caption font-semibold uppercase tracking-[0.06em] text-subtle">
                  Overall
                </p>
                <div className="mt-1 space-y-0.5">
                  {combined.map(([code, value]) => {
                    const net = BigInt(value);
                    return (
                      <p key={code}>
                        <Amount value={net} currency={code} size="lg" />
                        <span className="ml-1.5 text-caption font-semibold text-subtle">
                          {net > 0n ? "owed to you" : "you owe"}
                        </span>
                      </p>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          {anythingOutstanding ? (
            <Button size="sm" variant="secondary" onClick={() => setSettleUp(true)}>
              Settle up
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="primary"
            onClick={() => composer.open()}
            icon={<Plus className="size-4" strokeWidth={2.8} />}
          >
            Add an expense
          </Button>
          {/*
            Only offered once you are square. The server enforces it too, but a
            button that exists and always fails is worse than one that waits.
          */}
          {!anythingOutstanding ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRemoving(true)}
              icon={<UserMinus className="size-4" />}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      {/* Where that total comes from --------------------------------------- */}
      {ledgers.length > 0 ? (
        <section className="mt-5">
          <button
            onClick={() => {
              haptic();
              setShowBreakdown((current) => !current);
            }}
            aria-expanded={showBreakdown}
            className="flex w-full items-center gap-1.5 px-1 py-1 text-caption font-bold uppercase tracking-[0.07em] text-subtle"
          >
            Made up of {ledgers.length} {ledgers.length === 1 ? "balance" : "balances"}
            <ChevronDown
              className={cn("size-4 transition-transform", showBreakdown && "rotate-180")}
            />
          </button>

          {showBreakdown ? (
            <ul className="mt-2 space-y-1.5">
              {ledgers.map((ledger) => {
                const net = BigInt(ledger.net);
                const body = (
                  <>
                    <span className="min-w-0 flex-1 truncate text-body-lg font-semibold text-text">
                      {ledger.emoji ? `${ledger.emoji} ` : ""}
                      {ledger.name ?? "Just between you"}
                    </span>
                    <span className="shrink-0 text-right">
                      <Amount value={net} currency={ledger.currency} size="sm" />
                      <span className="block text-tiny text-subtle">
                        {net > 0n ? "owed to you" : "you owe"}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={ledger.groupId ?? "direct"}>
                    {ledger.groupId ? (
                      <Link
                        href={`/groups/${ledger.groupId}`}
                        className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-3.5 py-3 transition active:scale-[0.985]"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-3.5 py-3">
                        {body}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : data.sharedGroups.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 px-1 text-caption font-bold uppercase tracking-[0.07em] text-subtle">
            Also in
          </h2>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:-mx-8 lg:px-8">
            {data.sharedGroups.map((group) => (
              <Link
                key={group.id}
                href={`/groups/${group.id}`}
                className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 text-body font-semibold text-text transition active:scale-95"
              >
                <span>{group.emoji}</span>
                <span className="max-w-[140px] truncate">{group.name}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Direct ledger ----------------------------------------------------- */}
      <section className="mt-6">
        <h2 className="mb-2 px-1 text-caption font-bold uppercase tracking-[0.07em] text-subtle">
          Just between you
        </h2>

        {data.items.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-6" />}
            title="No shared expenses yet"
            description="Anything you split directly with them lands here."
          />
        ) : (
          <div className="space-y-5">
            {grouped.map(({ label, entries }) => (
              <div key={label}>
                <h3 className="mb-2 px-1 text-caption font-bold uppercase tracking-[0.06em] text-subtle">
                  {label}
                </h3>
                <ul className="space-y-1.5">
                  {entries.map((entry) =>
                    entry.kind === "expense" && entry.expense ? (
                      <li key={entry.expense.id}>
                        <ExpenseRow
                          expense={entry.expense}
                          meId={meId}
                          people={people}
                          onOpen={() => setOpenExpenseId(entry.expense!.id)}
                        />
                      </li>
                    ) : entry.settlement ? (
                      // The same row the group ledger uses, rather than a
                      // second copy of it: the copy that used to live here was
                      // inert, so a payment recorded against a friend by
                      // mistake could not be undone from the one screen that
                      // shows it. `groupId` is left unset because a direct
                      // payment belongs to no group.
                      <li key={entry.settlement.id}>
                        <SettlementRow
                          settlement={entry.settlement}
                          meId={meId}
                          people={people}
                          pending={entry.pending}
                        />
                      </li>
                    ) : null,
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <ExpenseDetailSheet
        expenseId={openExpenseId}
        onClose={() => setOpenExpenseId(null)}
        meId={meId}
        people={people}
      />

      <ConfirmSheet
        open={removing}
        onClose={() => setRemoving(false)}
        loading={removeFriend.isPending}
        onConfirm={() => {
          removeFriend.mutate(
            { id: data.person.id },
            {
              onSuccess: () => {
                setRemoving(false);
                toast({ tone: "success", title: `Removed ${data.person.displayName}` });
                router.push("/friends");
              },
              onError: (error) => {
                setRemoving(false);
                toast({
                  tone: "error",
                  title: "Could not remove them",
                  description: error instanceof Error ? error.message : undefined,
                });
              },
            },
          );
        }}
        title={`Remove ${data.person.displayName}?`}
        description="They drop off your friends list. Expenses you shared in a group stay exactly as they are, and you can add them again with their code."
        confirmLabel="Remove"
      />

      {/*
        One sheet for everywhere the two of you stand, because one transfer is
        what settles it. Each ledger is still written separately — the sheet
        lists exactly what it is about to record.
      */}
      {settleCurrency && settleLedgers.length > 0 ? (
        <SettleAcrossSheet
          open={settleUp}
          onClose={() => setSettleUp(false)}
          person={data.person}
          me={dashboard.me}
          ledgers={settleLedgers}
          currency={settleCurrency}
        />
      ) : null}
    </div>
  );
}
