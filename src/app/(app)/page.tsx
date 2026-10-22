"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  Download,
  Plus,
  Search,
  ShieldCheck,
  Target,
  Ticket,
} from "lucide-react";
import { useActivity, useBudgets, useDashboard, usePrefetch, useUpdateGroup } from "@/lib/client/queries";
import { useOpenScreen } from "@/components/ui/open-screen";
import { TRAVEL_BACK_MS, useArrival } from "@/components/ui/travel";
import { AnimatePresence, motion } from "motion/react";
import { DURATION, EASE_STANDARD } from "@/components/ui/motion";

import { ActionSheet, useLongPress } from "@/components/ui/swipe-row";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/client/api";
import { Amount } from "@/components/ui/money";
import { Avatar } from "@/components/ui/avatar";
import { FlowDoodle } from "@/components/ui/doodle";
import { Skeleton, cn } from "@/components/ui/primitives";
import { NewGroupSheet } from "@/components/group/new-group-sheet";
import { JoinSheet } from "@/components/group/join-sheet";
import { ImportSheet } from "@/components/group/import-sheet";
import { Wordmark } from "@/components/app-shell";
import { FlowBar } from "@/components/flow/flow-bar";
import { GroupMark } from "@/components/group/group-mark";
import { activityEffect, describeActivity, timeAgo } from "@/components/activity/describe";
import { formatMoney } from "@/lib/money";
import { recoveryPending } from "@/lib/client/recovery";
import type { DashboardPayload } from "@/lib/client/queries";
import type { ActivityDto, GroupSummaryDto, PersonDto } from "@/lib/types";
import { isolate } from "@/lib/bidi";

/**
 * Home: what needs you (DESIGN-PLAN 3.2).
 *
 * From the top: where you stand, then the few things worth doing about it,
 * then your groups. On a desktop the balance moves to a right-hand column so
 * the lists aren't pushed below the fold.
 */
export default function HomePage() {
  const { data } = useDashboard();
  const [newGroup, setNewGroup] = React.useState(false);
  const [joining, setJoining] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  // The groups on Home load in spare moments, so opening one slides in a
  // screen that is already complete (MOTION-SPEC 1).
  const prefetch = usePrefetch();
  const groupIds = (data?.groups ?? [])
    .filter((group) => !group.archivedAt)
    .slice(0, 6)
    .map((group) => group.id)
    .join(",");
  React.useEffect(() => {
    if (!groupIds) return;
    const load = () => groupIds.split(",").forEach((id) => void prefetch.group(id));
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(load, { timeout: 2000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(load, 300);
    return () => window.clearTimeout(timer);
  }, [groupIds, prefetch]);

  if (!data) return null;

  const active = data.groups.filter((group) => !group.archivedAt);
  const archived = data.groups.filter((group) => group.archivedAt);
  const firstRun = active.length === 0 && archived.length === 0 && data.friends.length === 0;

  return (
    <div className="pt-[max(1rem,env(safe-area-inset-top))]">
      {/* The wordmark stands in for this on screen; speech still needs it. */}
      <h1 className="sr-only">Home</h1>
      <header className="mb-5 flex items-center justify-between gap-3">
        {/* On a desktop the sidebar already carries the logo. */}
        <Wordmark className="lg:invisible" />
        <div className="flex items-center gap-1">
          <Link
            href="/search"
            aria-label="Search expenses"
            className="flex size-10 items-center justify-center rounded-full text-text transition-colors hover:bg-surface-2 lg:hidden"
          >
            <Search className="size-5" strokeWidth={1.75} />
          </Link>
          <Link href="/account" aria-label="You" className="rounded-full p-1 transition-opacity active:opacity-70">
            {/* The initials are a picture of you here, not the button's name. */}
            <span aria-hidden>
              <Avatar person={data.me} size="sm" />
            </span>
          </Link>
        </div>
      </header>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-start lg:gap-10">
        <div className="min-w-0 lg:sticky lg:top-6 lg:order-2">
          <Balance data={data} />
          <ThisMonth />
        </div>

        <div className="min-w-0 lg:order-1">
          {firstRun ? (
            <>
            <BackupNotice />
            <FlowDoodle play="start" className="-ml-2 mb-2 mt-6" />
            <Section title="Get started">
              <Rows>
                <ActionRow
                  icon={<Plus className="size-5" strokeWidth={1.75} />}
                  title="Start a group"
                  caption="For a trip, a flat or a night out"
                  onClick={() => setNewGroup(true)}
                />
                <ActionRow
                  icon={<Ticket className="size-5" strokeWidth={1.75} />}
                  title="Join with a code"
                  caption="Someone sent you an invite"
                  onClick={() => setJoining(true)}
                />
                <ActionRow
                  icon={<Download className="size-5" strokeWidth={1.75} />}
                  title="Move from Splitwise"
                  caption="Bring a group and its expenses across"
                  onClick={() => setImporting(true)}
                />
              </Rows>
            </Section>
            </>
          ) : (
            <NeedsYou data={data} />
          )}

          {!firstRun ? (
            <Section
              title="Groups"
              action={
                <span className="flex items-center gap-1">
                  <TextButton onClick={() => setJoining(true)}>Join</TextButton>
                  <TextButton onClick={() => setNewGroup(true)}>New group</TextButton>
                </span>
              }
            >
              {active.length === 0 ? (
                <p className="rounded-[var(--radius-lg)] border border-line bg-surface shadow-card px-4 py-4 text-body text-muted">
                  No groups yet.{" "}
                  <button
                    onClick={() => setNewGroup(true)}
                    className="font-medium text-text underline-offset-2 hover:underline"
                  >
                    Start one
                  </button>
                </p>
              ) : (
                <Rows>
                  {active.map((group) => (
                    <GroupRow key={group.id} group={group} meId={data.me.id} />
                  ))}
                </Rows>
              )}
            </Section>
          ) : null}

          {archived.length > 0 ? <Archived groups={archived} meId={data.me.id} /> : null}
        </div>
      </div>

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
// Balance

/**
 * Where you stand: what you're owed and what you owe, one line each per
 * currency, with the flow bar of who makes it up underneath.
 */
function Balance({ data }: { data: DashboardPayload }) {
  const currencies = Object.keys(data.totals);
  const nothingYet = data.groups.length === 0 && data.friends.length === 0;

  if (currencies.length === 0) {
    return (
      <section className="mb-8">
        <p className="text-hero font-semibold leading-[1.1] tracking-[-0.035em] text-text">
          {nothingYet ? "Nothing owed yet" : "All settled up"}
        </p>
        <p className="mt-2 text-body text-muted">
          {nothingYet
            ? "Add what people paid and Divvy works out who owes who."
            : "Nobody owes anybody anything."}
        </p>
      </section>
    );
  }

  // Split by direction, per currency, from the people who make it up: a
  // single net figure hides that you can be owed by some and owe others.
  const lines = currencies.map((currency) => {
    const entries = data.friends
      .filter((friend) => friend.net[currency])
      .map((friend) => ({ person: friend.person, amount: BigInt(friend.net[currency]) }));
    const owed = entries.reduce((sum, entry) => (entry.amount > 0n ? sum + entry.amount : sum), 0n);
    const owe = entries.reduce((sum, entry) => (entry.amount < 0n ? sum - entry.amount : sum), 0n);
    return { currency, owed, owe, entries };
  });

  const approx = data.approxTotal ? BigInt(data.approxTotal.amount) : null;

  return (
    <section className="mb-8">
      <div className="space-y-5">
        {lines.map((line) => (
          <div key={line.currency}>
            {line.owed > 0n ? (
              <BalanceLine label="You're owed" amount={line.owed} currency={line.currency} />
            ) : null}
            {line.owe > 0n ? (
              <BalanceLine label="You owe" amount={-line.owe} currency={line.currency} />
            ) : null}
            <FlowBar
              className="mt-3"
              currency={line.currency}
              entries={line.entries}
              linkTo={(personId) => `/friends/${personId}`}
            />
          </div>
        ))}
      </div>

      {approx !== null && data.approxTotal ? (
        <p className="mt-3 text-body text-muted">
          About {formatMoney(approx < 0n ? -approx : approx, data.approxTotal.currency)}{" "}
          {approx >= 0n ? "owed to you" : "that you owe"} overall
        </p>
      ) : null}
    </section>
  );
}

function BalanceLine({ label, amount, currency }: { label: string; amount: bigint; currency: string }) {
  return (
    // The label always beside the figure, which shrinks to fit the rest of
    // the line. It used to wrap under the label only when long, so the labels
    // sat in two different places.
    <p className="flex items-baseline gap-x-2">
      <span className="shrink-0 text-body text-muted">{label}</span>
      <span className="min-w-0 flex-1 [container-type:inline-size]">
        <Amount
          value={amount}
          currency={currency}
          arrow
          fit="hero"
          className="text-hero font-semibold leading-[1.15] tracking-[-0.035em]"
        />
      </span>
    </p>
  );
}

/** The month so far against an overall budget, if one is set. */
function ThisMonth() {
  const { data: budgets } = useBudgets();
  const overall = budgets?.find(
    (budget) => !budget.groupId && !budget.categoryId && budget.period === "MONTHLY",
  );
  if (!overall) return null;
  const spent = BigInt(overall.spent);
  const limit = BigInt(overall.amount);
  const share = limit > 0n ? Math.min(1, Number(spent) / Number(limit)) : 0;
  return (
    <Link
      href="/account"
      className="mb-8 block rounded-[var(--radius-lg)] border border-line bg-surface shadow-card px-4 py-3 press hover:bg-surface-2"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-body text-muted">This month</span>
        <span className="tabular text-body text-text">
          {formatMoney(spent, overall.currency)}{" "}
          <span className="text-muted">of {formatMoney(limit, overall.currency)}</span>
        </span>
      </span>
      <span className="mt-2 block h-1 overflow-hidden rounded-full bg-surface-2">
        <span
          className={cn("block h-full rounded-full", share >= 1 ? "bg-negative" : "bg-text")}
          style={{ width: `${share * 100}%` }}
        />
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Needs you

/**
 * Only what you can act on, at most four rows: backing up the account, money
 * you can pay, things others changed that you haven't seen, and a budget
 * nearly used up.
 */
function NeedsYou({ data }: { data: DashboardPayload }) {
  const { data: activity, isLoading } = useActivity();
  const { data: budgets } = useBudgets();
  const [backup] = React.useState(() => recoveryPending());
  const people = React.useMemo(
    () => new Map(data.people.map((person) => [person.id, person])),
    [data.people],
  );

  const rows: { id: string; node: React.ReactNode }[] = [];

  if (backup) {
    rows.push({
      id: "backup",
      node: (
        <LinkRow
          href="/account"
          icon={<ShieldCheck className="size-5" strokeWidth={1.75} />}
          title="Back up your account"
          caption="So you can get back in on a new phone · 1 minute"
        />
      ),
    });
  }

  // Money you can pay, biggest first.
  const toPay = data.friends
    .flatMap((friend) =>
      Object.entries(friend.net)
        .filter(([, value]) => BigInt(value) < 0n)
        .map(([currency, value]) => ({ person: friend.person, currency, amount: -BigInt(value) })),
    )
    .sort((a, b) => (b.amount > a.amount ? 1 : -1))
    .slice(0, 2);
  for (const item of toPay) {
    rows.push({
      id: `pay-${item.person.id}-${item.currency}`,
      node: (
        <LinkRow
          href={`/friends/${item.person.id}`}
          avatar={item.person}
          title={`Pay ${isolate(item.person.displayName.split(" ")[0])} ${formatMoney(item.amount, item.currency)}`}
          caption="Settle up"
          tone="owe"
        />
      ),
    });
  }

  // Changes by other people you haven't seen yet.
  const unread = (activity?.pages[0]?.items ?? [])
    .filter((item) => item.isUnread && item.actorPersonId !== data.me.id)
    .slice(0, 2);
  for (const item of unread) {
    rows.push({ id: item.id, node: <UnreadRow activity={item} meId={data.me.id} people={people} /> });
  }

  const nearLimit = (budgets ?? []).find((budget) => {
    const limit = BigInt(budget.amount);
    return limit > 0n && Number(BigInt(budget.spent)) / Number(limit) >= 0.8;
  });
  if (nearLimit) {
    rows.push({
      id: "budget",
      node: (
        <LinkRow
          href="/account"
          icon={<Target className="size-5" strokeWidth={1.75} />}
          title={`${formatMoney(BigInt(nearLimit.spent), nearLimit.currency)} of ${formatMoney(BigInt(nearLimit.amount), nearLimit.currency)} budget used`}
          caption={
            nearLimit.period === "WEEKLY" ? "This week" : nearLimit.period === "YEARLY" ? "This year" : "This month"
          }
        />
      ),
    });
  }

  const shown = rows.slice(0, 4);

  // Until the activity is in, an outline the size of the finished section:
  // showing the settle-up row alone and then growing to three pushed
  // everything below it down a moment after Home appeared.
  if (isLoading) {
    return (
      <Section title="Needs you">
        <Rows>
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <span className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </span>
            </div>
          ))}
        </Rows>
      </Section>
    );
  }

  if (rows.length === 0) return null;

  return (
    <Section
      title="Needs you"
      action={
        unread.length > 0 ? (
          <Link href="/activity" className="flex items-center gap-0.5 text-body text-muted hover:text-text">
            All activity <ArrowRight className="size-3.5" />
          </Link>
        ) : undefined
      }
    >
      {/*
        A row that goes (news you've now seen, a debt you've paid) and the one
        that takes its place cross-fade in the same spot (POLISH-AUDIT 27).
        They used to swap in one frame as Home came back from a group you had
        just read. Nothing below moves unless the number of rows changes: the
        group's name and balance are flying back into their row just then.
      */}
      <Rows as="ul">
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((row) => (
            <motion.li
              key={row.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION.fade, ease: EASE_STANDARD }}
            >
              {row.node}
            </motion.li>
          ))}
        </AnimatePresence>
      </Rows>
    </Section>
  );
}

/** A brand-new account sees this above "Get started" until it's backed up. */
function BackupNotice() {
  const [backup] = React.useState(() => recoveryPending());
  if (!backup) return null;
  return (
    <Section title="Needs you">
      <Rows>
        <LinkRow
          href="/account"
          icon={<ShieldCheck className="size-5" strokeWidth={1.75} />}
          title="Back up your account"
          caption="So you can get back in on a new phone · 1 minute"
        />
      </Rows>
    </Section>
  );
}

function UnreadRow({
  activity,
  meId,
  people,
}: {
  activity: ActivityDto;
  meId: string;
  people: Map<string, PersonDto>;
}) {
  const actor = people.get(activity.actorPersonId);
  const { sentence } = describeActivity(
    activity,
    actor?.displayName.split(" ")[0] ?? "Someone",
    meId,
    people,
  );
  const effect = activityEffect(activity);
  return (
    <Link
      href={activity.groupId ? `/groups/${activity.groupId}` : "/activity"}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
    >
      {actor ? <Avatar person={actor} size="sm" /> : <span className="size-8 rounded-full bg-surface-2" />}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-body leading-snug text-muted">{sentence}</span>
        <span className="mt-0.5 block text-caption text-subtle">
          {activity.groupName ? `${activity.groupEmoji ?? ""} ${activity.groupName} · ` : ""}
          {timeAgo(activity.createdAt)}
          {effect ? (
            <span className={effect.owed ? "text-positive-text" : "text-negative-text"}> · {effect.text}</span>
          ) : null}
        </span>
      </span>
      <span className="size-2 shrink-0 rounded-full bg-text" aria-label="Unread" />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Groups

function GroupRow({ group, meId }: { group: GroupSummaryDto; meId: string }) {
  const net = BigInt(group.yourNet);
  const router = useRouter();
  const toast = useToast();
  const update = useUpdateGroup(group.id);
  const [menu, setMenu] = React.useState(false);
  // Long-press (or right-click) for the things you'd otherwise open the group
  // to do (DESIGN-PLAN Part 4).
  const press = useLongPress(() => setMenu(true));
  const prefetch = usePrefetch();
  const open = useOpenScreen();
  // Back from the group: its header's pieces fly home into this row.
  const row = React.useRef<HTMLAnchorElement>(null);
  useArrival(row, `back:/groups/${group.id}`, true, TRAVEL_BACK_MS);
  const archive = (archived: boolean) =>
    update.mutate(
      { archived },
      {
        onSuccess: () =>
          toast({
            tone: "success",
            title: archived ? `Archived ${group.name}` : `${group.name} is back`,
            action: archived ? { label: "Undo", onClick: () => archive(false) } : undefined,
          }),
        onError: (error) =>
          toast({
            tone: "error",
            title: "Couldn\u2019t change that",
            description: error instanceof ApiError ? error.message : undefined,
          }),
      },
    );

  return (
    <>
    <ActionSheet
      open={menu}
      onClose={() => setMenu(false)}
      title={`${group.emoji} ${group.name}`}
      actions={[
        ...(net !== 0n
          ? [{ label: "Settle up", onPress: () => router.push(`/groups/${group.id}?open=settle`) }]
          : []),
        { label: "Invite people", onPress: () => router.push(`/groups/${group.id}?open=invite`) },
        group.archivedAt
          ? { label: "Unarchive", onPress: () => archive(false) }
          : { label: "Archive", onPress: () => archive(true) },
      ]}
    />
    <Link
      ref={row}
      href={`/groups/${group.id}`}
      prefetch
      {...press.handlers}
      // The touch that starts a tap is the moment to fetch what's behind it.
      onPointerDown={(event) => {
        void prefetch.group(group.id);
        press.handlers.onPointerDown(event);
      }}
      onClick={(event) => {
        if (press.consumed()) event.preventDefault();
        else open(event, `/groups/${group.id}`, prefetch.group(group.id));
      }}
      className="flex select-none items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 active:bg-surface-2"
    >
      <span data-travel="icon" className="shrink-0 text-title">
        <GroupMark group={group} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {/* dir="auto": a right-to-left name is cut at its end, not its start. */}
          <span data-travel="name" dir="auto" className="truncate text-left text-title font-semibold tracking-[-0.01em] text-text">
            {group.name}
          </span>
          {group.unreadCount > 0 ? (
            <span className="size-2 shrink-0 rounded-full bg-text" aria-label="New activity" />
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-caption text-subtle">{groupCaption(group, meId)}</span>
      </span>
      <span className="shrink-0 text-right">
        {net === 0n ? (
          <span className="text-caption text-subtle">settled</span>
        ) : (
          <>
            <span data-travel="amount" className="block">
              <Amount value={net} currency={group.currency} size="md" className="block" />
            </span>
            <span className="block text-caption text-subtle">{net > 0n ? "you're owed" : "you owe"}</span>
          </>
        )}
      </span>
    </Link>
    </>
  );
}

/** "Ravi added Taxi · 2h", or how many people are in it if nothing has happened. */
function groupCaption(group: GroupSummaryDto, meId: string): string {
  const last = group.lastActivity;
  const when = group.lastActivityAt ? timeAgo(group.lastActivityAt) : null;
  if (!last || !when) return `${group.memberCount} ${group.memberCount === 1 ? "person" : "people"}`;
  const actor =
    last.actorPersonId === meId
      ? "You"
      : isolate(
          group.members.find((member) => member.id === last.actorPersonId)?.displayName.split(" ")[0] ?? "Someone",
        );
  const what = last.description ? ` ${isolate(last.description)}` : "";
  const verb =
    last.type === "expense.created"
      ? `added${what}`
      : last.type === "expense.updated"
        ? `edited${what}`
        : last.type === "expense.deleted"
          ? `deleted${what}`
          : last.type === "settlement.created"
            ? "recorded a payment"
            : last.type === "member.joined"
              ? "joined"
              : last.type === "comment.created"
                ? `commented${what ? ` on${what}` : ""}`
                : last.type === "group.created"
                  ? "started the group"
                  : "made a change";
  return `${actor} ${verb} · ${when}`;
}

function Archived({ groups, meId }: { groups: GroupSummaryDto[]; meId: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <section className="mb-8">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 px-1 text-body text-muted hover:text-text"
      >
        Archived ({groups.length})
        <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
      </button>
      {open ? (
        <div className="mt-2 opacity-80">
          <Rows>
            {groups.map((group) => (
              <GroupRow key={group.id} group={group} meId={meId} />
            ))}
          </Rows>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Building blocks

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <h2 className="text-title font-semibold tracking-[-0.01em] text-text">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A grouped inset list: one card, rows separated by hairlines. */
function Rows({ children, as: Tag = "div" }: { children: React.ReactNode; as?: "div" | "ul" }) {
  return (
    <Tag className="ring-inside relative divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-card">
      {children}
    </Tag>
  );
}

function TextButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-[var(--radius-sm)] px-2 py-1 text-body font-medium text-text transition-colors hover:bg-surface-2"
    >
      {children}
    </button>
  );
}

function LinkRow({
  href,
  icon,
  avatar,
  title,
  caption,
  tone,
}: {
  href: string;
  icon?: React.ReactNode;
  avatar?: PersonDto;
  title: string;
  caption?: string;
  tone?: "owe";
}) {
  const prefetch = usePrefetch();
  const open = useOpenScreen();
  // The screen behind the row starts loading as the finger lands on it.
  const load = () => {
    const friend = /^\/friends\/([^/?]+)/.exec(href)?.[1];
    const group = /^\/groups\/([^/?]+)/.exec(href)?.[1];
    return friend ? prefetch.friend(friend) : group ? prefetch.group(group) : Promise.resolve();
  };
  return (
    <Link
      href={href}
      prefetch
      onPointerDown={() => void load()}
      onClick={(event) => open(event, href, load())}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 active:bg-surface-2"
    >
      {avatar ? (
        <Avatar person={avatar} size="sm" />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span
          className={cn("block text-body font-medium", tone === "owe" ? "text-negative-text" : "text-text")}
        >
          {tone === "owe" ? <ArrowUpRight aria-hidden className="mr-0.5 inline size-3.5 -translate-y-px" strokeWidth={2.25} /> : null}
          {title}
        </span>
        {caption ? <span className="mt-0.5 block text-caption text-subtle">{caption}</span> : null}
      </span>
      <ChevronRight className="size-4 shrink-0 text-subtle" />
    </Link>
  );
}

function ActionRow({
  icon,
  title,
  caption,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  caption: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-lg font-medium text-text">{title}</span>
        <span className="mt-0.5 block text-caption text-subtle">{caption}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-subtle" />
    </button>
  );
}
