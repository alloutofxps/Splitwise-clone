"use client";

import * as React from "react";
import Link from "next/link";
import { Button, EmptyState, Skeleton, cn, haptic } from "@/components/ui/primitives";
import { LoadMore } from "@/components/ui/load-more";
import { ExpenseDetailSheet } from "@/components/expense/detail-sheet";
import {
  useActivity,
  useDashboard,
  useMarkActivitySeen,
  usePrefetch,
  useRestoreExpense,
  useRestoreSettlement,
} from "@/lib/client/queries";
import { useToast } from "@/components/ui/toast";
import { useOpenScreen } from "@/components/ui/open-screen";

import { ApiError } from "@/lib/client/api";
import { groupByDay } from "@/lib/day-groups";
import { Avatar } from "@/components/ui/avatar";
import { activityEffect, describeActivity, timeAgo } from "@/components/activity/describe";
import type { ActivityDto, PersonDto } from "@/lib/types";

/**
 * The activity feed.
 *
 * Written as sentences rather than rows of fields, because the feed's job is to
 * be skimmed: "Priya added Dinner in Lisbon 2026" is parsed in one glance where
 * a table of type/actor/target columns is not.
 *
 * Entries render from a snapshot stored when the event happened, so a line
 * still reads correctly after the underlying expense has been edited or
 * deleted - which is exactly when someone is most likely to be scrolling back
 * looking for what changed.
 */
export default function ActivityPage() {
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useActivity();
  const { data: dashboard } = useDashboard();
  const markSeen = useMarkActivitySeen();
  const [openExpenseId, setOpenExpenseId] = React.useState<string | null>(null);

  // Once per visit, after the feed has loaded: everything here is now seen.
  const loaded = Boolean(data);
  const { mutate: markSeenNow } = markSeen;
  React.useEffect(() => {
    if (loaded) markSeenNow();
  }, [loaded, markSeenNow]);
  const [groupFilter, setGroupFilter] = React.useState<string | null>(null);

  const people = React.useMemo(
    () => new Map((dashboard?.people ?? []).map((person) => [person.id, person])),
    [dashboard?.people],
  );

  if (isLoading || !dashboard) {
    return (
      <div className="pt-[max(1.5rem,env(safe-area-inset-top))]">
        <h1 className="mb-5 text-heading font-semibold tracking-[-0.02em] text-text">Activity</h1>
        <div className="ring-inside overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-card appear-late">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const all = data?.pages.flatMap((page) => page.items) ?? [];

  // Filtering client-side rather than by refetching: the feed is already
  // loaded, every entry carries its group, and a round trip to hide rows the
  // browser is holding would be slower and would reset the scroll position.
  const items = groupFilter ? all.filter((item) => item.groupId === groupFilter) : all;
  const days = groupByDay(items, (item) => item.createdAt);

  // Only groups that actually appear, so the chip row does not offer filters
  // that lead to an empty list.
  const groupsInFeed = dashboard.groups.filter((group) =>
    all.some((item) => item.groupId === group.id),
  );

  return (
    <div className="pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h1 className="mb-4 text-heading font-semibold tracking-[-0.02em] text-text">Activity</h1>

      {groupsInFeed.length > 1 ? (
        <div className="-mx-4 -mt-1 mb-3.5 flex gap-1.5 overflow-x-auto px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <GroupChip active={groupFilter === null} onClick={() => setGroupFilter(null)}>
            All
          </GroupChip>
          {groupsInFeed.map((group) => (
            <GroupChip
              key={group.id}
              active={groupFilter === group.id}
              onClick={() => setGroupFilter(groupFilter === group.id ? null : group.id)}
            >
              <span aria-hidden>{group.emoji}</span>
              <bdi>{group.name}</bdi>
            </GroupChip>
          ))}
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title={groupFilter ? "Nothing in this group yet" : "Nothing here yet"}
          description={
            groupFilter
              ? "Nothing has happened in this group yet."
              : "When someone adds an expense, pays someone back or leaves a comment, you'll see it here."
          }
          action={
            groupFilter ? (
              <Button variant="secondary" onClick={() => setGroupFilter(null)}>
                Show everything
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-5">
          {days.map(({ label, entries }) => (
            <section key={label}>
              <h2 className="mb-2 px-1 text-caption font-medium text-subtle">{label}</h2>
              <ul className="ring-inside overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-card">
                {entries.map((item) => (
                  <li key={item.id} className="border-b border-line last:border-b-0">
                    <ActivityRow
                      activity={item}
                      meId={dashboard.me.id}
                      people={people}
                      onOpenExpense={setOpenExpenseId}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <LoadMore
        hasMore={hasNextPage}
        loading={isFetchingNextPage}
        onLoad={() => void fetchNextPage()}
        label="Load older activity"
      />

      <ExpenseDetailSheet
        expenseId={openExpenseId}
        onClose={() => setOpenExpenseId(null)}
        meId={dashboard.me.id}
        people={people}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function GroupChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => {
        haptic();
        onClick();
      }}
      className={cn(
        "tap-44 relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-body font-semibold transition active:opacity-70",
        active
          ? "border-text bg-text text-inverse"
          : "border-line bg-surface text-text hover:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------

function ActivityRow({
  activity,
  meId,
  people,
  onOpenExpense,
}: {
  activity: ActivityDto;
  meId: string;
  people: Map<string, PersonDto>;
  onOpenExpense: (id: string) => void;
}) {
  const prefetch = usePrefetch();
  const open = useOpenScreen();
  const actor = people.get(activity.actorPersonId);
  const isMe = activity.actorPersonId === meId;
  const actorName = isMe ? "You" : (actor?.displayName ?? "Someone");

  const { sentence } = describeActivity(activity, actorName, meId, people);
  // A group entry names its group; one between friends says who it was with.
  const withNames = (activity.withPersonIds ?? [])
    .map((id) => people.get(id)?.displayName)
    .filter(Boolean)
    .join(", ");
  const effect = activityEffect(activity);

  /**
   * A deletion is the one entry that carries a reference it must not follow.
   *
   * The id is there so this row can offer to put the record back — but the
   * record is tombstoned, and every read route refuses a tombstone on purpose,
   * so opening it would 404. So a deleted row is not a link: it is a statement
   * with an undo attached.
   */
  const deleted =
    activity.type === "expense.deleted" || activity.type === "settlement.deleted";
  const clickable = Boolean(activity.expenseId) && !deleted;

  const body = (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 transition-colors",
        clickable && "hover:bg-surface-2 active:bg-surface-2",
      )}
    >
      {actor ? (
        <Avatar person={actor} size="sm" className="mt-0.5" />
      ) : (
        <span className="mt-0.5 size-8 shrink-0 rounded-full bg-surface-2" />
      )}

      <span className="min-w-0 flex-1">
        <span className="block text-body leading-snug text-muted">{sentence}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-caption text-subtle">
          {activity.groupName ? (
            <>
              <span className="shrink-0" aria-hidden>
                {activity.groupEmoji}
              </span>
              <span dir="auto" className="min-w-0 truncate text-left">
                {activity.groupName}
              </span>
              <span aria-hidden>·</span>
            </>
          ) : withNames ? (
            <>
              <span className="shrink-0">With</span>
              <span dir="auto" className="min-w-0 truncate text-left">
                {withNames}
              </span>
              <span aria-hidden>·</span>
            </>
          ) : null}
          <span className="shrink-0">{timeAgo(activity.createdAt)}</span>
        </span>
      </span>

      {deleted && activity.undoable ? (
        <UndoButton activity={activity} />
      ) : (
        <span className="flex shrink-0 items-center gap-2 pt-0.5">
          {effect ? (
            <span
              className={cn(
                "tabular text-caption font-medium",
                effect.owed ? "text-positive-text" : "text-negative-text",
              )}
            >
              {effect.text}
            </span>
          ) : null}
          {activity.isUnread ? (
            <span className="size-2 rounded-full bg-text" aria-label="Unread" />
          ) : null}
        </span>
      )}
    </div>
  );

  if (deleted) return body;

  if (clickable) {
    return (
      <button onClick={() => onOpenExpense(activity.expenseId!)} className="block w-full text-left">
        {body}
      </button>
    );
  }
  if (activity.groupId) {
    return (
      <Link href={`/groups/${activity.groupId}`} prefetch onPointerDown={() => void prefetch.group(activity.groupId!)} onClick={(event) => open(event, `/groups/${activity.groupId}`, prefetch.group(activity.groupId!))} className="block">
        {body}
      </Link>
    );
  }
  return body;
}

/**
 * Putting back what a row says was deleted.
 *
 * Offered to anyone who could have performed the delete, not only to whoever
 * did. Restricting repair more tightly than destruction would let a person
 * break a shared ledger and leave somebody else unable to fix it.
 *
 * The toast is the fast path and lasts seconds; this is the one that is still
 * here tomorrow, which is when people actually go looking.
 */
function UndoButton({ activity }: { activity: ActivityDto }) {
  const toast = useToast();
  const restoreExpense = useRestoreExpense();
  const restoreSettlement = useRestoreSettlement();

  const isExpense = activity.type === "expense.deleted";
  const id = isExpense ? activity.expenseId : activity.settlementId;
  const busy = isExpense ? restoreExpense.isPending : restoreSettlement.isPending;

  // Older entries were written before the delete routes carried the id, and a
  // group that has since been deleted takes its rows with it. Nothing to point
  // at, so nothing to offer.
  if (!id) return null;

  const label = isExpense ? "expense" : "payment";

  return (
    <button
      onClick={() => {
        haptic();
        const options = {
          onSuccess: () =>
            toast({ tone: "success", title: `${label[0].toUpperCase()}${label.slice(1)} is back` }),
          onError: (error: unknown) =>
            toast({
              tone: "error",
              title: `Couldn't bring the ${label} back`,
              description: error instanceof ApiError ? error.message : undefined,
            }),
        };
        if (isExpense) restoreExpense.mutate({ id }, options);
        else restoreSettlement.mutate({ id }, options);
      }}
      disabled={busy}
      aria-label={`Undo, bring this ${label} back`}
      className="tap-44 relative mt-0.5 shrink-0 rounded-full border border-line px-2.5 py-1 text-caption font-medium text-text transition active:opacity-70 hover:bg-surface-2 disabled:opacity-50"
    >
      {busy ? "…" : "Undo"}
    </button>
  );
}
