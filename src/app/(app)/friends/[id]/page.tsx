"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings2,
  UserMinus,
} from "lucide-react";
import { Amount } from "@/components/ui/money";
import { Avatar } from "@/components/ui/avatar";
import { Button, EmptyState, cn, haptic } from "@/components/ui/primitives";
import { FriendSkeleton } from "@/components/screen-skeletons";
import { ExpenseRow, SettlementRow } from "@/components/group/ledger";
import { ExpenseDetailSheet } from "@/components/expense/detail-sheet";
import { SettleAcrossSheet } from "@/components/friends/settle-across-sheet";
import { useComposer } from "@/components/expense/composer-context";
import { ConfirmSheet, Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useDashboard, useFriend, usePrefetch, useRemoveFriend } from "@/lib/client/queries";
import { useOpenScreen } from "@/components/ui/open-screen";

import { groupByDay } from "@/lib/day-groups";
import { formatMoney } from "@/lib/money";

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
  const prefetch = usePrefetch();
  const open = useOpenScreen();
  const { data: dashboard } = useDashboard();

  const [openExpenseId, setOpenExpenseId] = React.useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = React.useState<string>("all");
  const [settleUp, setSettleUp] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [settings, setSettings] = React.useState(false);
  const toast = useToast();
  const removeFriend = useRemoveFriend();

  const people = React.useMemo(
    () => new Map((dashboard?.people ?? []).map((person) => [person.id, person])),
    [dashboard?.people],
  );

  if (isLoading || !data || !dashboard) {
    return <FriendSkeleton name={people.get(params.id)?.displayName} />;
  }

  const meId = dashboard.me.id;
  // All shared history, narrowed to one group (or the direct ledger) on request.
  const filtered = data.items.filter((item) => {
    if (historyFilter === "all") return true;
    const groupId = item.expense?.groupId ?? item.settlement?.groupId ?? null;
    return historyFilter === "direct" ? groupId === null : groupId === historyFilter;
  });
  const grouped = groupByDay(filtered, (item) => item.date);
  const groupName = new Map(data.sharedGroups.map((group) => [group.id, `${group.emoji} ${group.name}`]));

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
          className="flex size-10 items-center justify-center rounded-full text-muted transition active:opacity-70 hover:bg-surface-2"
        >
          <ChevronLeft className="size-6" />
        </button>
        <h1 className="min-w-0 flex-1 truncate px-1 text-title font-semibold tracking-[-0.02em] text-text">
          {data.person.displayName}
        </h1>
        <button
          onClick={() => {
            haptic();
            setSettings(true);
          }}
          aria-label="Friend settings"
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted transition active:opacity-70 hover:bg-surface-2"
        >
          <Settings2 className="size-5" />
        </button>
      </header>

      {/* Who, and where you stand ---------------------------------------- */}
      <section className="mt-3">
        <div className="flex items-center gap-4">
          <Avatar person={data.person} size="lg" />
          <div className="min-w-0 flex-1">
            {!anythingOutstanding ? (
              <>
                <p className="text-title-lg font-semibold tracking-[-0.02em] text-text">You&rsquo;re all settled up</p>
                <p className="mt-0.5 text-body text-muted">Nobody owes anything, in any group.</p>
              </>
            ) : (
              combined.map(([code, value]) => {
                const net = BigInt(value);
                return (
                  <p key={code} className="flex flex-col">
                    <span className="text-body text-muted">
                      {net > 0n ? `${data.person.displayName.split(" ")[0]} owes you` : `You owe ${data.person.displayName.split(" ")[0]}`}
                    </span>
                    <Amount
                      value={net}
                      currency={code}
                      arrow
                      className="text-display font-semibold leading-tight tracking-[-0.03em]"
                    />
                  </p>
                );
              })
            )}
            {data.person.isGhost ? <p className="mt-1 text-caption text-subtle">Not on Divvy yet</p> : null}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          {anythingOutstanding ? (
            <Button variant="primary" onClick={() => setSettleUp(true)}>
              Settle up
            </Button>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => composer.open()}
            icon={<Plus className="size-4" strokeWidth={2.4} />}
          >
            Add an expense
          </Button>
        </div>
      </section>

      {/* Where that total lives -------------------------------------------- */}
      {ledgers.length > 1 || ledgers.some((ledger) => ledger.planned !== null) ? (
        <section className="mt-8">
          <h2 className="mb-2 px-1 text-title font-semibold tracking-[-0.01em] text-text">Where it comes from</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-card">
            {ledgers.map((ledger) => {
              const net = BigInt(ledger.net);
              const note =
                ledger.planned !== null
                  ? planNote(net, BigInt(ledger.planned), data.person.displayName.split(" ")[0], ledger.currency)
                  : null;
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-lg font-medium text-text">
                      {ledger.emoji ? `${ledger.emoji} ` : ""}
                      {ledger.name ?? "Just between you"}
                    </span>
                    {note ? <span className="mt-0.5 block text-caption leading-relaxed text-muted">{note}</span> : null}
                  </span>
                  <span className="shrink-0 text-right">
                    <Amount value={net} currency={ledger.currency} size="sm" />
                    <span className="block text-caption text-subtle">{net > 0n ? "owed to you" : "you owe"}</span>
                  </span>
                </>
              );
              return (
                <li key={ledger.groupId ?? "direct"}>
                  {ledger.groupId ? (
                    <Link href={`/groups/${ledger.groupId}`} prefetch onPointerDown={() => void prefetch.group(ledger.groupId!)} onClick={(event) => open(event, `/groups/${ledger.groupId}`, prefetch.group(ledger.groupId!))} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Everything you share ---------------------------------------------- */}
      <section className="mt-8">
        <h2 className="mb-2 px-1 text-title font-semibold tracking-[-0.01em] text-text">Shared history</h2>

        {data.sharedGroups.length > 0 ? (
          <div className="no-scrollbar -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 lg:-mx-8 lg:px-8">
            {[
              { id: "all", label: "Everything" },
              { id: "direct", label: "Just between you" },
              ...data.sharedGroups.map((group) => ({ id: group.id, label: `${group.emoji} ${group.name}` })),
            ].map((chip) => (
              <button
                key={chip.id}
                type="button"
                aria-pressed={historyFilter === chip.id}
                onClick={() => {
                  haptic();
                  setHistoryFilter(chip.id);
                }}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-body font-medium transition-colors",
                  historyFilter === chip.id ? "border-text bg-text text-inverse" : "border-line bg-surface text-text hover:bg-surface-2",
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <EmptyState
            title={data.items.length === 0 ? "No shared expenses yet" : "Nothing here"}
            description={
              data.items.length === 0
                ? "Expenses you split with this person, in a group or just the two of you, show up here."
                : "Nothing shared in this one yet."
            }
          />
        ) : (
          <div className="space-y-5">
            {grouped.map(({ label, precise, entries }) => (
              <div key={label}>
                <h3 className="mb-2 px-1 text-caption font-medium text-subtle">{label}</h3>
                <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-card">
                  {entries.map((entry) =>
                    entry.kind === "expense" && entry.expense ? (
                      <li key={entry.expense.id}>
                        <ExpenseRow
                          expense={entry.expense}
                          meId={meId}
                          people={people}
                          showDate={!precise}
                          showGroup={historyFilter === "all" && entry.expense.groupId ? groupName.get(entry.expense.groupId) : undefined}
                          onOpen={() => setOpenExpenseId(entry.expense!.id)}
                        />
                      </li>
                    ) : entry.settlement ? (
                      // The same row the group ledger uses, so a payment
                      // recorded by mistake can be undone from here too.
                      <li key={entry.settlement.id}>
                        <SettlementRow
                          settlement={entry.settlement}
                          meId={meId}
                          people={people}
                          pending={entry.pending}
                          groupId={entry.settlement.groupId ?? undefined}
                          showDate={!precise}
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

      {/*
        Everything about the relationship rather than the ledger: which groups
        you are both in, and the one destructive thing you can do here.

        No "block" and no "report". Blocking means suppressing somebody's
        content, and there is nothing here to suppress: the only way anyone
        reaches you is an invite code you gave them, and a shared group is a
        thing you leave rather than mute. Reporting needs somebody to report
        to, and a self-hosted app with no accounts has no such party — offering
        the button would be a promise nothing is behind.
      */}
      <Sheet open={settings} onClose={() => setSettings(false)} title="Friend settings">
        <div className="px-5 pb-6">
          {data.sharedGroups.length > 0 ? (
            <>
              <p className="mb-2 px-1 text-caption font-medium text-subtle">
                Shared groups
              </p>
              <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-card">
                {data.sharedGroups.map((group) => (
                  <li key={group.id}>
                    <Link
                      href={`/groups/${group.id}`}
                      prefetch
                      onPointerDown={() => void prefetch.group(group.id)}
                      onClick={(event) => {
                        setSettings(false);
                        open(event, `/groups/${group.id}`, prefetch.group(group.id));
                      }}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                    >
                      <span className="text-input">{group.emoji}</span>
                      <span className="min-w-0 flex-1 truncate text-body-lg font-semibold text-text">
                        {group.name}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-subtle" />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="px-1 text-body leading-relaxed text-muted">
              You&rsquo;re not in any groups together. Everything here is just between
              the two of you.
            </p>
          )}

          <p className="mb-2 mt-6 px-1 text-caption font-medium text-subtle">
            Manage
          </p>
          <button
            onClick={() => {
              haptic();
              setSettings(false);
              setRemoving(true);
            }}
            disabled={anythingOutstanding}
            className="flex w-full items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--card-border)] bg-surface shadow-card px-3.5 py-3 text-left press disabled:opacity-50"
          >
            <UserMinus className="mt-0.5 size-[18px] shrink-0 text-negative-text" />
            <span className="min-w-0 flex-1">
              <span className="block text-body-lg font-semibold text-text">
                Remove from friends list
              </span>
              <span className="mt-0.5 block text-caption leading-relaxed text-subtle">
                {anythingOutstanding
                  ? "You need to settle up first. Otherwise neither of you could see what's still owed."
                  : "Anything you share in groups will stay there."}
              </span>
            </span>
          </button>
        </div>
      </Sheet>

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
                  title: "Couldn't remove them",
                  description: error instanceof Error ? error.message : undefined,
                });
              },
            },
          );
        }}
        title={`Remove ${data.person.displayName}?`}
        description="They'll come off your friends list. Expenses in your groups won't change, and you can add them back any time with their code."
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

/**
 * Why the group screen shows a different payment between you than the total
 * here. The group's "fewest payments" plan passes debts along between people,
 * so a friend who owes you can end up paying someone else, who pays you.
 */
function planNote(net: bigint, planned: bigint, name: string, currency: string): string {
  const money = (value: bigint) => formatMoney(value < 0n ? -value : value, currency);
  const head = "In the group's plan for fewer payments, ";
  if (net > 0n) {
    if (planned > 0n && planned < net) {
      return `${head}${name} pays you ${money(planned)}. The other ${money(net - planned)} reaches you through other people in the group.`;
    }
    if (planned > net) {
      return `${head}${name} pays you ${money(planned)}. That includes money passed on from others in the group.`;
    }
    if (planned === 0n) {
      return `${head}${name} doesn't pay you directly. What they owe you reaches you through other people in the group.`;
    }
    return `${head}you pay ${name} ${money(planned)}. Debts are passed along between people, and it all evens out.`;
  }
  if (planned < 0n && planned > net) {
    return `${head}you pay ${name} ${money(planned)}. The other ${money(net - planned)} goes to other people in the group, who pass it on.`;
  }
  if (planned < net) {
    return `${head}you pay ${name} ${money(planned)}. That includes money you pass on for others in the group.`;
  }
  if (planned === 0n) {
    return `${head}you don't pay ${name} directly. You pay other people in the group, and it reaches ${name} through them.`;
  }
  return `${head}${name} pays you ${money(planned)}. Debts are passed along between people, and it all evens out.`;
}
