"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Plus, Receipt } from "lucide-react";
import { Amount } from "@/components/ui/money";
import { Avatar } from "@/components/ui/avatar";
import { Button, EmptyState, Skeleton, haptic } from "@/components/ui/primitives";
import { ExpenseRow } from "@/components/group/ledger";
import { ExpenseDetailSheet } from "@/components/expense/detail-sheet";
import { SettleUpSheet } from "@/components/group/settle-up-sheet";
import { useComposer } from "@/components/expense/composer-context";
import { useDashboard, useFriend } from "@/lib/client/queries";
import { groupByDay } from "@/lib/day-groups";
import { formatMoney } from "@/lib/money";

/**
 * One friend.
 *
 * The direct ledger between the two of you, plus links to the groups you share.
 * The separation is the point: this page never quotes a single combined number,
 * because "you owe me 90" is only a useful sentence when both people agree on
 * which 90 it is.
 */
export default function FriendPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const composer = useComposer();

  const { data, isLoading } = useFriend(params.id);
  const { data: dashboard } = useDashboard();

  const [openExpenseId, setOpenExpenseId] = React.useState<string | null>(null);
  const [settleUp, setSettleUp] = React.useState(false);

  const people = React.useMemo(
    () => new Map((dashboard?.people ?? []).map((person) => [person.id, person])),
    [dashboard?.people],
  );

  if (isLoading || !data || !dashboard) {
    return (
      <div className="pt-8">
        <Skeleton className="h-20 w-full rounded-[--radius-xl]" />
        <div className="mt-4 space-y-2.5">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-[62px] w-full rounded-[--radius-lg]" />
          ))}
        </div>
      </div>
    );
  }

  const meId = dashboard.me.id;
  const grouped = groupByDay(data.items, (item) => item.date);
  const hasBalance = data.balances.some((entry) => BigInt(entry.net) !== 0n);

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
        <h1 className="min-w-0 flex-1 truncate px-1 text-[17px] font-bold tracking-[-0.02em] text-text">
          {data.person.displayName}
        </h1>
      </header>

      {/* Balance ---------------------------------------------------------- */}
      <div className="mt-2 rounded-[--radius-xl] border border-line bg-surface p-5 shadow-card">
        <div className="flex items-center gap-4">
          <Avatar person={data.person} size="lg" />
          <div className="min-w-0 flex-1">
            {data.balances.length === 0 ? (
              <>
                <p className="text-[15px] font-semibold text-muted">
                  You&rsquo;re all settled up
                </p>
                <p className="mt-0.5 text-[13px] text-subtle">
                  Nothing outstanding between you two.
                </p>
              </>
            ) : (
              <>
                <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-subtle">
                  Between you two
                </p>
                <div className="mt-1 space-y-0.5">
                  {data.balances.map((entry) => {
                    const net = BigInt(entry.net);
                    return (
                      <p key={entry.currency}>
                        <Amount value={net} currency={entry.currency} size="lg" />
                        <span className="ml-1.5 text-[12px] font-semibold text-subtle">
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
          {hasBalance ? (
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
        </div>
      </div>

      {/* Shared groups ----------------------------------------------------- */}
      {data.sharedGroups.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 px-1 text-[12px] font-bold uppercase tracking-[0.07em] text-subtle">
            Also in
          </h2>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:-mx-8 lg:px-8">
            {data.sharedGroups.map((group) => (
              <Link
                key={group.id}
                href={`/groups/${group.id}`}
                className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 text-[13px] font-semibold text-text transition active:scale-95"
              >
                <span>{group.emoji}</span>
                <span className="max-w-[140px] truncate">{group.name}</span>
              </Link>
            ))}
          </div>
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-subtle">
            Balances in those groups are kept separate from the direct one above.
          </p>
        </section>
      ) : null}

      {/* Direct ledger ----------------------------------------------------- */}
      <section className="mt-6">
        <h2 className="mb-2 px-1 text-[12px] font-bold uppercase tracking-[0.07em] text-subtle">
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
                <h3 className="mb-2 px-1 text-[12px] font-bold uppercase tracking-[0.06em] text-subtle">
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
                      <li
                        key={entry.settlement.id}
                        className="flex items-center gap-3 rounded-[--radius-lg] border border-dashed border-line bg-surface-2/50 px-3 py-2.5"
                      >
                        <span className="min-w-0 flex-1 text-[14px] font-semibold text-text">
                          {entry.settlement.fromPersonId === meId
                            ? `You paid ${data.person.displayName.split(" ")[0]}`
                            : `${data.person.displayName.split(" ")[0]} paid you`}
                        </span>
                        <span className="tabular shrink-0 text-[14px] font-semibold text-muted">
                          {formatMoney(
                            BigInt(entry.settlement.amount),
                            entry.settlement.currency,
                          )}
                        </span>
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

      <SettleUpSheet
        open={settleUp}
        onClose={() => setSettleUp(false)}
        meId={meId}
        people={people}
        fixedPersonId={data.person.id}
        directCurrency={data.balances[0]?.currency ?? dashboard.me.defaultCurrency}
      />
    </div>
  );
}
