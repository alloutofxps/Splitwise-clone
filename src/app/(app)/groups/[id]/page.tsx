"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Plus, Settings2, Share2 } from "lucide-react";
import { BalanceHeadline } from "@/components/ui/money";
import { AvatarStack } from "@/components/ui/avatar";
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
  const [settings, setSettings] = React.useState(false);
  const [invite, setInvite] = React.useState(false);
  const [settleUp, setSettleUp] = React.useState(false);

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

  return (
    <div className="pt-[max(0.5rem,env(safe-area-inset-top))]">
      {/* Header ---------------------------------------------------------- */}
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

        <div className="min-w-0 flex-1 px-1">
          <h1 className="flex items-center gap-2 truncate text-title font-bold tracking-[-0.02em] text-text">
            <span>{group.emoji}</span>
            <span className="truncate">{group.name}</span>
          </h1>
        </div>

        <button
          onClick={() => {
            haptic();
            setInvite(true);
          }}
          aria-label="Invite people"
          className="flex size-10 items-center justify-center rounded-full text-muted transition active:scale-90 hover:bg-surface-2"
        >
          <Share2 className="size-[19px]" />
        </button>
        <button
          onClick={() => {
            haptic();
            setSettings(true);
          }}
          aria-label="Group settings"
          className="flex size-10 items-center justify-center rounded-full text-muted transition active:scale-90 hover:bg-surface-2"
        >
          <Settings2 className="size-[19px]" />
        </button>
      </header>

      {/* Balance summary -------------------------------------------------- */}
      <div className="mt-2 rounded-[var(--radius-xl)] border border-line bg-surface p-5 shadow-card">
        <BalanceHeadline
          net={net}
          currency={group.currency}
          settledLabel="Everyone is square"
        />

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            onClick={() => {
              haptic();
              setInvite(true);
            }}
            className="flex shrink-0 items-center gap-2 rounded-full py-1 pr-1 transition active:scale-95"
          >
            <AvatarStack people={group.members} size="xs" max={4} />
            <span className="whitespace-nowrap text-caption font-semibold text-subtle">
              {group.memberCount}
            </span>
          </button>

          <div className="flex shrink-0 gap-2">
            {net !== 0n || group.balances.pairwise.length > 0 ? (
              <Button size="sm" variant="secondary" onClick={() => setSettleUp(true)}>
                Settle up
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="primary"
              onClick={() => composer.open(groupId)}
              icon={<Plus className="size-4" strokeWidth={2.8} />}
            >
              Add
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs -------------------------------------------------------------- */}
      <div className="sticky top-0 z-20 -mx-4 mt-5 bg-bg/90 px-4 py-2 backdrop-blur lg:-mx-8 lg:px-8">
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
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
          className="mt-4"
        >
          {tab === "expenses" ? (
            <GroupLedger
              groupId={groupId}
              meId={meId}
              members={group.members}
              people={people}
              onAdd={() => composer.open(groupId)}
            />
          ) : null}

          {tab === "balances" ? (
            <BalancesPanel
              group={group}
              meId={meId}
              people={people}
              onSettle={() => setSettleUp(true)}
            />
          ) : null}

          {tab === "charts" ? <GroupCharts groupId={groupId} people={people} /> : null}
        </motion.div>
      </AnimatePresence>

      {/* Sheets ------------------------------------------------------------ */}
      <GroupSettingsSheet
        open={settings}
        onClose={() => setSettings(false)}
        group={group}
        meId={meId}
      />
      <InviteSheet open={invite} onClose={() => setInvite(false)} group={group} />
      <SettleUpSheet
        open={settleUp}
        onClose={() => setSettleUp(false)}
        group={group}
        meId={meId}
        people={people}
      />
    </div>
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
