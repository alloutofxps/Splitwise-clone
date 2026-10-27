"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronLeft, Settings2, UserPlus } from "lucide-react";
import { Amount } from "@/components/ui/money";
import { DURATION, EASE_STANDARD } from "@/components/ui/motion";
import { RollingFigure } from "@/components/ui/rolling-figure";
import { FlowBar } from "@/components/flow/flow-bar";
import { TRAVEL_MS, type Travel } from "@/components/flow/flow-map";
import { WhileOpen } from "@/components/ui/sheet";
import { setBeat, whenPanelLeaving } from "@/components/ui/stage";
import { TRAVEL_IN_MS, leaveFrom, useArrival } from "@/components/ui/travel";
import { useWide } from "@/components/ui/use-wide";
import { StickyBar } from "@/components/ui/sticky";
import { AvatarStack, GroupHues } from "@/components/ui/avatar";
import { Button, Segmented, haptic, tabPanelProps } from "@/components/ui/primitives";
import { GroupSkeleton } from "@/components/screen-skeletons";
import { GroupLedger } from "@/components/group/ledger";
import { BalancesPanel } from "@/components/group/balances-panel";
import { useComposer } from "@/components/expense/composer-context";
import { lazyAfterLoad } from "@/components/ui/after-load";
import { useDashboard, useGroup, useMarkGroupRead } from "@/lib/client/queries";

type Tab = "expenses" | "balances" | "charts";
const TAB_NAMES: Record<Tab, string> = { expenses: "Expenses", balances: "Balances", charts: "Insights" };
const TAB_ORDER: Tab[] = ["expenses", "balances", "charts"];

// The tabs redraw only when what they show changes. Opening or closing a
// panel changes this screen's state, and redrew the whole open tab with it,
// in the instant a saved panel was trying to start leaving.
const Ledger = React.memo(GroupLedger);
const Balances = React.memo(BalancesPanel);
// Panels nobody sees until they tap, and the Insights tab: fetched once the
// page has loaded rather than with it (components/ui/after-load.tsx), all in
// one file with the expense composer, because they share much of their code
// and separate small files compressed to several KB more.
const Charts = React.memo(
  lazyAfterLoad(() => import(/* webpackChunkName: "panels" */ "@/components/group/charts").then((m) => m.GroupCharts)),
);
const GroupSettingsSheet = lazyAfterLoad(() =>
  import(/* webpackChunkName: "panels" */ "@/components/group/settings-sheet").then((m) => m.GroupSettingsSheet),
);
const InviteSheet = lazyAfterLoad(() =>
  import(/* webpackChunkName: "panels" */ "@/components/group/invite-sheet").then((m) => m.InviteSheet),
);
const SettleUpSheet = lazyAfterLoad(() =>
  import(/* webpackChunkName: "panels" */ "@/components/group/settle-up-sheet").then((m) => m.SettleUpSheet),
);

export default function GroupPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const groupId = params.id;

  const { data: group, isLoading } = useGroup(groupId);
  const { data: dashboard } = useDashboard();
  const markRead = useMarkGroupRead(groupId);
  const composer = useComposer();

  const [tab, setTabState] = React.useState<Tab>("expenses");
  // Which way the tab content slides in: from the side its tab sits on, or
  // not at all when the switch happens behind a closing panel.
  const [slide, setSlide] = React.useState<-1 | 0 | 1>(0);
  const setTab = (next: Tab, moving = true) => {
    setSlide(!moving || next === tab ? 0 : TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(tab) ? 1 : -1);
    setTabState(next);
  };
  const reduce = useReducedMotion();
  const wide = useWide();
  const screen = React.useRef<HTMLDivElement>(null);
  // ?open=settle or ?open=invite: arriving from a long-press on Home.
  const requested = useSearchParams().get("open");
  const [settings, setSettings] = React.useState(false);
  const [invite, setInvite] = React.useState(requested === "invite");
  const [settleUp, setSettleUp] = React.useState(requested === "settle");
  // The payment just saved, shown as a dot running along its line on the map.
  const [travel, setTravel] = React.useState<Travel | null>(null);
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

  // Stable, so the tabs (memoised below) keep the same props when a panel
  // opens or closes.
  const openComposer = composer.open;
  const addHere = React.useCallback(() => openComposer(groupId), [openComposer, groupId]);
  const travelled = React.useCallback(() => setTravel(null), []);

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

  // The row you tapped on Home flies into this header; leaving, the header
  // hands its pieces back to the row (components/ui/travel.ts).
  const ready = Boolean(group && dashboard);
  useArrival(screen, `/groups/${groupId}`, ready, TRAVEL_IN_MS);
  React.useLayoutEffect(() => {
    const node = screen.current;
    if (!ready || !node) return;
    return () => leaveFrom(node, `back:/groups/${groupId}`);
  }, [ready, groupId]);

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
    <Ledger
      groupId={groupId}
      meId={meId}
      members={group.members}
      people={people}
      onAdd={addHere}
    />
  );
  const panel = (which: Tab) =>
    which === "balances" ? (
      <Balances
        group={group}
        meId={meId}
        people={people}
        onSettle={openSettle}
        travel={travel}
        onTravelled={travelled}
      />
    ) : which === "charts" ? (
      <Charts groupId={groupId} people={people} />
    ) : (
      ledger
    );

  return (
    <GroupHues members={group.members}>
    <div ref={screen} className="pt-[max(0.5rem,env(safe-area-inset-top))]">
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
          <span aria-hidden data-travel="icon">
            {group.emoji}
          </span>
          <span data-travel="name" dir="auto" className="truncate text-left">
            {group.name}
          </span>
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

        {/* The balance shrinks to fit this row (Amount's `fit`); Settle up
            moves under it when both don't fit. */}
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3 [container-type:inline-size]">
          <Standing net={net} currency={group.currency} everyone={group.balances.pairwise.length === 0} />
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
              id="group-side-tabs"
              value={sideTab}
              onChange={setTab}
              options={[
                { value: "balances", label: "Balances" },
                { value: "charts", label: "Insights" },
              ]}
            />
            <div className="mt-4" {...tabPanelProps("group-side-tabs", sideTab)}>
              {panel(sideTab)}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Tabs ---------------------------------------------------------- */}
          <StickyBar spacing="mt-6" className="-mx-4 bg-bg px-4 lg:-mx-8 lg:px-8">
            <Segmented
              id="group-tabs"
              value={tab}
              onChange={setTab}
              options={[
                { value: "expenses", label: "Expenses" },
                { value: "balances", label: "Balances" },
                { value: "charts", label: "Insights" },
              ]}
            />
          </StickyBar>

          {/*
            The three sit side by side, so the content slides in from the side
            its tab is on, with the underline (MOTION-SPEC 4). Only the arrival
            moves: the old tab is replaced at once, so there is never a blank
            moment between the two. Whole transform strings, so the browser can
            run it on the compositor.
          */}
          <motion.div
            key={tab}
            initial={
              slide === 0
                ? false
                : reduce
                  ? { opacity: 0.4, transform: "translateX(0px)" }
                  : { opacity: 0.4, transform: `translateX(${slide * 32}px)` }
            }
            animate={{ opacity: 1, transform: "translateX(0px)", transitionEnd: { transform: "none" } }}
            transition={reduce ? { duration: DURATION.fade } : { duration: DURATION.change, ease: EASE_STANDARD }}
            className="mt-4"
            {...tabPanelProps("group-tabs", tab)}
          >
            {/* The tabs stand in for this heading on screen; speech still needs it. */}
            <h2 className="sr-only">{TAB_NAMES[tab]}</h2>
            {panel(tab)}
          </motion.div>
        </>
      )}

      {/* Sheets ------------------------------------------------------------ */}
      {/*
        Out of the page while shut (WhileOpen), so they don't redraw with it.
        Settle up stays: its Undo outlives the panel.
      */}
      <WhileOpen open={settings}>
        <GroupSettingsSheet
          open={settings}
          onClose={() => setSettings(false)}
          group={group}
          meId={meId}
          onOpenBalances={() => {
            setSettings(false);
            setTab("balances", false);
          }}
        />
      </WhileOpen>
      <WhileOpen open={invite}>
        <InviteSheet open={invite} onClose={() => setInvite(false)} group={group} />
      </WhileOpen>
      <SettleUpSheet
        open={settleUp}
        onClose={() => setSettleUp(false)}
        group={group}
        meId={meId}
        people={people}
        initialEdge={settleEdge}
        onSaved={(payment) => {
          // Balances wait for the money to reach the other person before
          // they count.
          setBeat(TRAVEL_MS);
          // Built once the panel is on its way out, so it can leave at once;
          // the travel itself waits for the panel to be gone either way.
          whenPanelLeaving(() => {
            setTravel({ ...payment, nonce: Date.now() });
            // Show it where it happens: the map on a phone is behind a tab.
            if (!wide) setTab("balances", false);
          });
        }}
      />
    </div>
    </GroupHues>
  );
}

// ---------------------------------------------------------------------------

/**
 * Where you stand in the group. Rolls to each new figure once the panel that
 * changed it has gone, and only says "settled up" when the roll reaches zero,
 * so paying off the last of it is something you watch happen.
 */
function Standing({ net, currency, everyone }: { net: bigint; currency: string; everyone: boolean }) {
  const [rest, setRest] = React.useState(net);
  // Colour, arrow and wording follow the figure the roll is at rest on, so
  // they change once, when it lands, not halfway through it.
  const shown = rest;
  return (
    <AnimatePresence mode="wait" initial={false}>
      {shown === 0n && net === 0n ? (
        <motion.p
          key="settled"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.fade }}
          className="text-display font-semibold tracking-[-0.03em] text-text"
        >
          {everyone ? "Everyone is settled up" : "You’re settled up"}
        </motion.p>
      ) : (
        <motion.p
          key="balance"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.fade }}
          className="flex flex-col"
        >
          <span className="text-body text-muted">{shown > 0n ? "You’re owed" : "You owe"}</span>
          <span data-travel="amount" className="self-start">
            <Amount
              value={shown === 0n ? net : shown}
              currency={currency}
              arrow
              figure={<RollingFigure value={net} currency={currency} onRest={setRest} />}
              fit="display"
              className="text-display font-semibold leading-tight tracking-[-0.03em]"
            />
          </span>
        </motion.p>
      )}
    </AnimatePresence>
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
