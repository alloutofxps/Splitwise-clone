"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Settings2, UserPlus } from "lucide-react";
import { Amount } from "@/components/ui/money";
import { FlowBar } from "@/components/flow/flow-bar";
import { useWide } from "@/components/ui/use-wide";
import { AvatarStack, GroupHues } from "@/components/ui/avatar";
import { Button, Segmented, Skeleton, haptic } from "@/components/ui/primitives";
import { GroupLedger } from "@/components/group/ledger";
import { BalancesPanel } from "@/components/group/balances-panel";
import { GroupCharts } from "@/components/group/charts";
import { GroupSettingsSheet } from "@/components/group/settings-sheet";
import { InviteSheet } from "@/components/group/invite-sheet";
import { SettleUpSheet } from "@/components/group/settle-up-sheet";
import { useComposer } from "@/components/expense/composer-context";
import { useDashboard, useGroup, useMarkGroupRead } from "@/lib/client/queries";

type Tab = "expenses" | "balances" | "charts";

export default function GroupPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const groupId = params.id;

  const { data: group, isLoading } = useGroup(groupId);
  const { data: dashboard } = useDashboard();
  const markRead = useMarkGroupRead(groupId);
  const composer = useComposer();

  const [tab, setTab] = React.useState<Tab>("expenses");
  const wide = useWide();
  // ?open=settle or ?open=invite: arriving from a long-press on Home.
  const requested = useSearchParams().get("open");
  const [settings, setSettings] = React.useState(false);
  const [invite, setInvite] = React.useState(requested === "invite");
  const [settleUp, setSettleUp] = React.useState(requested === "settle");
  // The payment just saved, shown as a dot running along its line on the map.
  const [travel, setTravel] = React.useState<{ fromPersonId: string; toPersonId: string; nonce: number } | null>(null);
  // The transfer the sheet should open on, when it was reached by tapping a
  // specific one rather than the general "Settle up" button.
  const [settleEdge, setSettleEdge] = React.useState<
    { fromPersonId: string; toPersonId: string; amount: string } | undefined
  >();

  const openSettle = React.useCallback(
    (edge?: { fromPersonId: string; toPersonId: string; amount: string }) => {
      setSettleEdge(edge);
      setSettleUp(true);
    },
    [],
  );

  // Opening the group clears its unread badge. Fired once per mount rather than
  // on every render, and deliberately not awaited - it must never delay paint.
  const marked = React.useRef(false);
  React.useEffect(() => {
    if (!group || marked.current || group.unreadCount === 0) return;
    marked.current = true;
    markRead.mutate();
  }, [group, markRead]);

  const people = React.useMemo(
    () => new Map((dashboard?.people ?? []).map((person) => [person.id, person])),
    [dashboard?.people],
  );

  if (isLoading) return <GroupSkeleton />;
  if (!group || !dashboard) return null;

  const net = BigInt(group.yourNet);
  const meId = dashboard.me.id;

  // Who your balance in this group is with: one flow-bar segment per person,
  // from the literal person-to-person debts.
  const withMe = new Map<string, bigint>();
  for (const edge of group.balances.pairwise) {
    const amount = BigInt(edge.amount);
    if (edge.toPersonId === meId) withMe.set(edge.fromPersonId, (withMe.get(edge.fromPersonId) ?? 0n) + amount);
    if (edge.fromPersonId === meId) withMe.set(edge.toPersonId, (withMe.get(edge.toPersonId) ?? 0n) - amount);
  }
  const barEntries = [...withMe]
    .map(([personId, amount]) => ({ person: people.get(personId), amount }))
    .filter((entry): entry is { person: NonNullable<typeof entry.person>; amount: bigint } => Boolean(entry.person));

  const canSettle = net !== 0n || group.balances.pairwise.length > 0;

  // On a desktop the expenses stay on the left and the right column shows
  // Balances or Insights; on a phone, the three are tabs.
  const sideTab: Tab = tab === "expenses" ? "balances" : tab;

  const ledger = (
    <GroupLedger
      groupId={groupId}
      meId={meId}
      members={group.members}
      people={people}
      onAdd={() => composer.open(groupId)}
    />
  );
  const panel = (which: Tab) =>
    which === "balances" ? (
      <BalancesPanel group={group} meId={meId} people={people} onSettle={openSettle} travel={travel} />
    ) : which === "charts" ? (
      <GroupCharts groupId={groupId} people={people} />
    ) : (
      ledger
    );

  return (
    <GroupHues members={group.members}>
    <div className="pt-[max(0.5rem,env(safe-area-inset-top))]">
      {/* Header ---------------------------------------------------------- */}
      <header className="-mx-1 flex items-center gap-1 py-2">
        <button
          onClick={() => {
            haptic();
            router.back();
          }}
          aria-label="Back"
          className="flex size-10 items-center justify-center rounded-full text-text transition-colors hover:bg-surface-2"
        >
          <ChevronLeft className="size-6" strokeWidth={1.75} />
        </button>

        <h1 className="flex min-w-0 flex-1 items-center gap-2 px-1 text-title-lg font-semibold tracking-[-0.02em] text-text">
          <span aria-hidden>{group.emoji}</span>
          <span className="truncate">{group.name}</span>
        </h1>

        <HeaderButton
          label="Invite"
          icon={<UserPlus className="size-[18px]" strokeWidth={1.75} />}
          onClick={() => setInvite(true)}
        />
        <HeaderButton
          label="Settings"
          ariaLabel="Group settings"
          icon={<Settings2 className="size-[18px]" strokeWidth={1.75} />}
          onClick={() => setSettings(true)}
        />
      </header>

      {/* Who's in it and where you stand --------------------------------- */}
      <section className="mt-3">
        <button
          onClick={() => {
            haptic();
            setInvite(true);
          }}
          className="flex items-center gap-2 rounded-full py-1 pr-1 transition-opacity active:opacity-70"
        >
          <AvatarStack people={group.members} size="sm" max={6} />
          <span className="text-caption text-subtle">
            {group.memberCount} {group.memberCount === 1 ? "person" : "people"}
          </span>
        </button>

        <FlowBar className="mt-4" entries={barEntries} currency={group.currency} />

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          {net === 0n ? (
            <p className="text-display font-semibold tracking-[-0.03em] text-text">
              {group.balances.pairwise.length === 0 ? "Everyone is settled up" : "You’re settled up"}
            </p>
          ) : (
            <p className="flex flex-col">
              <span className="text-body text-muted">{net > 0n ? "You’re owed" : "You owe"}</span>
              <Amount
                value={net}
                currency={group.currency}
                arrow
                className="text-display font-semibold leading-tight tracking-[-0.03em]"
              />
            </p>
          )}
          {/* Adding an expense is the tab bar's job (it opens in this group);
              a second Add button here only made people wonder which to use. */}
          {canSettle ? (
            <Button variant="primary" onClick={() => openSettle()}>
              Settle up
            </Button>
          ) : null}
        </div>
      </section>

      {wide ? (
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] items-start gap-10">
          <div className="min-w-0">
            <h2 className="mb-3 text-title font-semibold tracking-[-0.01em] text-text">Expenses</h2>
            {ledger}
          </div>
          <div className="min-w-0">
            <Segmented
              value={sideTab}
              onChange={setTab}
              options={[
                { value: "balances", label: "Balances" },
                { value: "charts", label: "Insights" },
              ]}
            />
            <div className="mt-4">{panel(sideTab)}</div>
          </div>
        </div>
      ) : (
        <>
          {/* Tabs ---------------------------------------------------------- */}
          <div className="sticky top-0 z-20 -mx-4 mt-6 bg-bg px-4 lg:-mx-8 lg:px-8">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "expenses", label: "Expenses" },
                { value: "balances", label: "Balances" },
                { value: "charts", label: "Insights" },
              ]}
            />
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, pointerEvents: "none" }}
              transition={{ duration: 0.15 }}
              className="mt-4"
            >
              {panel(tab)}
            </motion.div>
          </AnimatePresence>
        </>
      )}

      {/* Sheets ------------------------------------------------------------ */}
      <GroupSettingsSheet
        open={settings}
        onClose={() => setSettings(false)}
        group={group}
        meId={meId}
        onOpenBalances={() => {
          setSettings(false);
          setTab("balances");
        }}
      />
      <InviteSheet open={invite} onClose={() => setInvite(false)} group={group} />
      <SettleUpSheet
        open={settleUp}
        onClose={() => setSettleUp(false)}
        group={group}
        meId={meId}
        people={people}
        initialEdge={settleEdge}
        onSaved={(payment) => {
          setTravel({ ...payment, nonce: Date.now() });
          // Show it where it happens: the map on a phone is behind a tab.
          if (!wide) setTab("balances");
        }}
      />
    </div>
    </GroupHues>
  );
}

// ---------------------------------------------------------------------------

function GroupSkeleton() {
  return (
    <div className="pt-6">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="mt-5 h-[148px] w-full rounded-[var(--radius-xl)]" />
      <Skeleton className="mt-5 h-11 w-full rounded-[var(--radius-md)]" />
      <div className="mt-5 space-y-2.5">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-[62px] w-full rounded-[var(--radius-lg)]" />
        ))}
      </div>
    </div>
  );
}

/** An icon with its word beside it on wider screens, and alone on a phone. */
function HeaderButton({
  label,
  ariaLabel,
  icon,
  onClick,
}: {
  label: string;
  ariaLabel?: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={() => {
        haptic();
        onClick();
      }}
      aria-label={ariaLabel ?? label}
      className="flex h-10 items-center gap-1.5 rounded-full px-2.5 text-body font-medium text-text transition-colors hover:bg-surface-2"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
