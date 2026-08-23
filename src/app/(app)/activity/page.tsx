"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  MessageSquare,
  Pencil,
  BellRing,
  Repeat,
  Trash2,
  UserPlus,
  Users,
  Receipt,
} from "lucide-react";
import { Button, EmptyState, Skeleton, cn, haptic } from "@/components/ui/primitives";
import { LoadMore } from "@/components/ui/load-more";
import { ExpenseDetailSheet } from "@/components/expense/detail-sheet";
import { useActivity, useDashboard } from "@/lib/client/queries";
import { groupByDay } from "@/lib/day-groups";
import { formatMoney } from "@/lib/money";
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
  const [openExpenseId, setOpenExpenseId] = React.useState<string | null>(null);
  const [groupFilter, setGroupFilter] = React.useState<string | null>(null);

  const people = React.useMemo(
    () => new Map((dashboard?.people ?? []).map((person) => [person.id, person])),
    [dashboard?.people],
  );

  if (isLoading || !dashboard) {
    return (
      <div className="pt-[max(1.5rem,env(safe-area-inset-top))]">
        <h1 className="mb-5 text-[26px] font-black tracking-[-0.03em] text-text">Activity</h1>
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-14 w-full rounded-[--radius-lg]" />
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
      <h1 className="mb-4 text-[26px] font-black tracking-[-0.03em] text-text">Activity</h1>

      {groupsInFeed.length > 1 ? (
        <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
              {group.name}
            </GroupChip>
          ))}
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={<Receipt className="size-6" />}
          title={groupFilter ? "Nothing in that group yet" : "Nothing has happened yet"}
          description={
            groupFilter
              ? "Nothing has happened in that group in the entries loaded so far."
              : "Expenses, payments and comments from all your groups show up here."
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
              <h2 className="mb-2 px-1 text-[12px] font-bold uppercase tracking-[0.06em] text-subtle">
                {label}
              </h2>
              <ul className="space-y-1">
                {entries.map((item) => (
                  <li key={item.id}>
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
        "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-semibold transition active:scale-95",
        active
          ? "border-brand bg-brand text-white"
          : "border-line bg-surface text-muted hover:text-text",
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
  const actor = people.get(activity.actorPersonId);
  const actorName = activity.actorPersonId === meId ? "You" : (actor?.displayName ?? "Someone");

  const { icon, tone, sentence } = describe(activity, actorName, meId, people);
  const clickable = Boolean(activity.expenseId);

  const body = (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[--radius-lg] px-3 py-3 transition",
        clickable && "hover:bg-surface-2 active:scale-[0.99] active:bg-surface-2",
        activity.isUnread && "bg-brand-soft/30",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
          tone === "positive" && "bg-positive-soft text-positive-text",
          tone === "negative" && "bg-negative-soft text-negative-text",
          tone === "neutral" && "bg-surface-2 text-muted",
          tone === "brand" && "bg-brand-soft text-brand-soft-text",
          tone === "warning" && "bg-warning-soft text-text",
        )}
      >
        {icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[14px] leading-snug text-text">{sentence}</span>
        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-subtle">
          {activity.groupName ? (
            <>
              <span className="truncate">
                {activity.groupEmoji} {activity.groupName}
              </span>
              <span>·</span>
            </>
          ) : null}
          <span className="shrink-0">{timeAgo(activity.createdAt)}</span>
        </span>
      </span>

      {activity.isUnread ? (
        <span className="mt-2 size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />
      ) : null}
    </div>
  );

  if (clickable) {
    return (
      <button onClick={() => onOpenExpense(activity.expenseId!)} className="block w-full text-left">
        {body}
      </button>
    );
  }
  if (activity.groupId) {
    return (
      <Link href={`/groups/${activity.groupId}`} className="block">
        {body}
      </Link>
    );
  }
  return body;
}

/**
 * Turns an event into a sentence.
 *
 * Amounts come from the stored snapshot rather than the live record, which is
 * the whole reason a deleted expense still says how much it was for.
 */
function describe(
  activity: ActivityDto,
  actorName: string,
  meId: string,
  people: Map<string, PersonDto>,
): {
  icon: React.ReactNode;
  tone: "positive" | "negative" | "neutral" | "brand" | "warning";
  sentence: React.ReactNode;
} {
  const data = activity.data;
  const amount =
    data.amount && data.currency
      ? formatMoney(BigInt(data.amount), data.currency)
      : null;

  const strong = (text: string) => <strong className="font-semibold">{text}</strong>;

  switch (activity.type) {
    case "expense.created":
      return {
        icon: <Receipt className="size-[17px]" />,
        tone: "brand",
        sentence: (
          <>
            {strong(actorName)} added {strong(String(data.description ?? "an expense"))}
            {amount ? <> · <span className="tabular">{amount}</span></> : null}
          </>
        ),
      };

    case "expense.updated": {
      const changes = Array.isArray(data.changes) ? (data.changes) : [];
      return {
        icon: <Pencil className="size-[16px]" />,
        tone: "neutral",
        sentence: (
          <>
            {strong(actorName)}{" "}
            {changes.length > 0 ? changes.join(" and ") : "edited"} on{" "}
            {strong(String(data.description ?? "an expense"))}
          </>
        ),
      };
    }

    case "expense.deleted":
      return {
        icon: <Trash2 className="size-[16px]" />,
        tone: "negative",
        sentence: (
          <>
            {strong(actorName)} deleted {strong(String(data.description ?? "an expense"))}
            {amount ? <> · <span className="tabular">{amount}</span></> : null}
          </>
        ),
      };

    case "settlement.created": {
      const from = data.fromPersonId as string | undefined;
      const to = data.toPersonId as string | undefined;
      const fromName = from === meId ? "You" : (people.get(from ?? "")?.displayName ?? "Someone");
      const toName = to === meId ? "you" : (people.get(to ?? "")?.displayName ?? "someone");
      return {
        icon: <ArrowLeftRight className="size-[16px]" />,
        tone: "positive",
        sentence: (
          <>
            {strong(fromName)} paid {strong(toName)}
            {amount ? <> <span className="tabular">{amount}</span></> : null}
          </>
        ),
      };
    }

    case "settlement.deleted":
      return {
        icon: <ArrowLeftRight className="size-[16px]" />,
        tone: "negative",
        sentence: <>{strong(actorName)} removed a payment{amount ? <> of <span className="tabular">{amount}</span></> : null}</>,
      };

    case "comment.created":
      return {
        icon: <MessageSquare className="size-[16px]" />,
        tone: "neutral",
        sentence: (
          <>
            {strong(actorName)} commented on {strong(String(data.description ?? "an expense"))}
            {/*
              `ActivityData` is an open bag of `unknown`, so this is checked
              rather than coerced: a payload shape that changed under us should
              drop the quote line, not render "[object Object]" inside quotes.
            */}
            {typeof data.preview === "string" && data.preview ? (
              <span className="mt-0.5 block truncate text-[13px] text-muted">
                &ldquo;{data.preview}&rdquo;
              </span>
            ) : null}
          </>
        ),
      };

    case "member.joined":
      return {
        icon: <UserPlus className="size-[16px]" />,
        tone: "brand",
        sentence: <>{strong(actorName)} joined {strong(String(data.groupName ?? "the group"))}</>,
      };

    case "member.added": {
      const other = people.get((data.otherPersonId as string) ?? "");
      return {
        icon: <UserPlus className="size-[16px]" />,
        tone: "neutral",
        sentence: (
          <>
            {strong(actorName)} added {strong(other?.displayName ?? "someone")}
          </>
        ),
      };
    }

    case "member.left":
    case "member.removed": {
      const other = people.get((data.otherPersonId as string) ?? "");
      return {
        icon: <Users className="size-[16px]" />,
        tone: "neutral",
        sentence:
          activity.type === "member.left" ? (
            <>{strong(actorName)} left the group</>
          ) : (
            <>{strong(actorName)} removed {strong(other?.displayName ?? "someone")}</>
          ),
      };
    }

    case "recurrence.fired":
      return {
        icon: <Repeat className="size-[16px]" />,
        tone: "brand",
        sentence: (
          <>
            {strong(String(data.description ?? "A repeating expense"))} posted automatically
            {amount ? <> · <span className="tabular">{amount}</span></> : null}
          </>
        ),
      };

    case "nudge.sent": {
      const target = people.get(activity.targetPersonId ?? "");
      // Reads differently depending on which end you are: "you reminded Ravi"
      // is a record, "Ravi reminded you" is a prompt.
      return {
        icon: <BellRing className="size-[16px]" />,
        tone: "warning",
        sentence:
          activity.targetPersonId === meId ? (
            <>
              {strong(actorName)} reminded you about
              {amount ? <> <span className="tabular">{amount}</span></> : <> a balance</>}
            </>
          ) : (
            <>
              You reminded {strong(target?.displayName ?? "someone")}
              {amount ? <> about <span className="tabular">{amount}</span></> : null}
            </>
          ),
      };
    }

    case "group.created":
      return {
        icon: <Users className="size-[16px]" />,
        tone: "brand",
        sentence: <>{strong(actorName)} created {strong(String(data.groupName ?? "a group"))}</>,
      };

    default:
      return {
        icon: <Receipt className="size-[16px]" />,
        tone: "neutral",
        sentence: <>{strong(actorName)} made a change</>,
      };
  }
}

/**
 * Relative time.
 *
 * Stops at a week: "23 days ago" is harder to place than a date, and by then
 * the exact day matters more than the elapsed span.
 */
function timeAgo(iso: string): string {
  const then = new Date(iso);
  const seconds = Math.floor((Date.now() - then.getTime()) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;

  return then.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(then.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}
