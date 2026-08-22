"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { ArrowLeftRight, Paperclip, MessageSquare, Receipt, Search, X } from "lucide-react";
import { Amount } from "../ui/money";
import { Avatar } from "../ui/avatar";
import { EmptyState, Skeleton, cn, haptic } from "../ui/primitives";
import { LoadMore } from "../ui/load-more";
import { Button } from "../ui/primitives";
import { CategoryGlyph } from "../expense/category-glyph";
import { ExpenseDetailSheet } from "../expense/detail-sheet";
import { useGroupLedger, type LedgerEntry } from "@/lib/client/queries";
import { categoryById } from "@/lib/categories";
import { formatMoney } from "@/lib/money";
import type { PersonDto } from "@/lib/types";

/**
 * The group ledger.
 *
 * Expenses and settlements share one chronological list, because that is how
 * the group experienced them - dinner, dinner, "Ravi paid Priya 40", dinner.
 * Filing settlements in a separate tab makes "did that ever get paid back?"
 * much harder to answer than it should be.
 *
 * Each row leads with the one number the reader wants: what *they* got out of
 * it. Not the total - the total is secondary information on a shared bill.
 */
export function GroupLedger({
  groupId,
  currency,
  meId,
  people,
  onAdd,
}: {
  groupId: string;
  currency: string;
  meId: string;
  people: Map<string, PersonDto>;
  onAdd: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [debounced, setDebounced] = React.useState("");
  const [openExpenseId, setOpenExpenseId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useGroupLedger(groupId, { q: debounced || undefined });

  if (isLoading) {
    return (
      <div className="space-y-2.5">
        {[0, 1, 2, 3, 4].map((index) => (
          <Skeleton key={index} className="h-[62px] w-full rounded-[--radius-lg]" />
        ))}
      </div>
    );
  }

  const items = data?.pages.flatMap((page) => page.items) ?? [];
  const groups = groupByDay(items);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        {searching ? (
          <motion.div
            initial={{ opacity: 0, width: "60%" }}
            animate={{ opacity: 1, width: "100%" }}
            className="flex flex-1 items-center gap-2 rounded-[--radius-md] bg-surface-2 px-3 py-2"
          >
            <Search className="size-4 shrink-0 text-subtle" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search this group"
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-[15px] text-text outline-none placeholder:text-subtle/70"
            />
            <button
              onClick={() => {
                haptic();
                setQuery("");
                setSearching(false);
              }}
              aria-label="Close search"
              className="shrink-0 text-subtle"
            >
              <X className="size-4" />
            </button>
          </motion.div>
        ) : (
          <>
            <p className="flex-1 text-[12px] font-bold uppercase tracking-[0.07em] text-subtle">
              {items.length > 0
                ? `${items.length}${hasNextPage ? "+" : ""} entries`
                : "Nothing yet"}
            </p>
            <button
              onClick={() => {
                haptic();
                setSearching(true);
              }}
              aria-label="Search this group"
              className="flex size-8 items-center justify-center rounded-full text-subtle transition active:scale-90 hover:bg-surface-2"
            >
              <Search className="size-[17px]" />
            </button>
          </>
        )}
      </div>

      {items.length === 0 ? (
        debounced ? (
          <EmptyState
            icon={<Search className="size-6" />}
            title="Nothing matches"
            description={`No expenses in this group mention "${debounced}".`}
          />
        ) : (
          <EmptyState
            icon={<Receipt className="size-6" />}
            title="No expenses yet"
            description="Add the first one and everyone's balance updates straight away."
            action={
              <Button variant="primary" onClick={onAdd}>
                Add an expense
              </Button>
            }
          />
        )
      ) : (
        <div className="space-y-5">
          {groups.map(({ label, entries }) => (
            <section key={label}>
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
                        pending={entry.pending}
                        onOpen={() => setOpenExpenseId(entry.expense!.id)}
                      />
                    </li>
                  ) : entry.settlement ? (
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
            </section>
          ))}
          <LoadMore
            hasMore={hasNextPage}
            loading={isFetchingNextPage}
            onLoad={() => void fetchNextPage()}
            label="Load older entries"
          />
        </div>
      )}

      <ExpenseDetailSheet
        expenseId={openExpenseId}
        onClose={() => setOpenExpenseId(null)}
        meId={meId}
        people={people}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ExpenseRow({
  expense,
  meId,
  people,
  onOpen,
  showGroup,
  pending,
}: {
  expense: NonNullable<LedgerEntry["expense"]>;
  meId: string;
  people: Map<string, PersonDto>;
  onOpen: () => void;
  showGroup?: string;
  /** Written optimistically; the server has not confirmed it yet. */
  pending?: boolean;
}) {
  const category = categoryById(expense.categoryId);
  const net = BigInt(expense.yourNet);
  const payer = expense.payers[0] ? people.get(expense.payers[0].personId) : undefined;

  const paidLabel =
    expense.payers.length > 1
      ? `${expense.payers.length} people paid`
      : payer
        ? `${payer.id === meId ? "You" : payer.displayName.split(" ")[0]} paid ${formatBare(expense.amount, expense.currency)}`
        : "";

  return (
    <button
      onClick={() => {
        haptic();
        onOpen();
      }}
      className={cn(
        "flex w-full items-center gap-3 rounded-[--radius-lg] border border-line bg-surface px-3 py-2.5 text-left transition active:scale-[0.985] active:bg-surface-2 hover:border-line-strong",
        // Faded rather than spinner-topped: the row is real and its numbers are
        // already correct, so the only thing being signalled is that the server
        // has not acknowledged it. A spinner would suggest it might not be
        // there yet, which is the opposite of what we want people to believe.
        pending && "opacity-60",
      )}
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-[--radius-md]"
        style={{
          background: `color-mix(in oklch, var(--avatar-${category.color}) 15%, transparent)`,
          color: `var(--avatar-${category.color})`,
        }}
      >
        <CategoryGlyph name={category.icon} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-semibold text-text">
            {expense.description}
          </span>
          {expense.attachments.length > 0 ? (
            <Paperclip className="size-3 shrink-0 text-subtle" />
          ) : null}
          {expense.commentCount > 0 ? (
            <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-subtle">
              <MessageSquare className="size-3" />
              {expense.commentCount}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-subtle">
          {showGroup ? `${showGroup} · ` : ""}
          {paidLabel}
        </span>
      </span>

      <span className="shrink-0 text-right">
        {net === 0n ? (
          <span className="text-[12px] font-semibold text-subtle">not involved</span>
        ) : (
          <>
            <Amount value={net} currency={expense.currency} size="sm" />
            <span className="mt-0.5 block text-[10px] font-semibold text-subtle">
              {net > 0n ? "you lent" : "you borrowed"}
            </span>
          </>
        )}
      </span>
    </button>
  );
}

function SettlementRow({
  settlement,
  meId,
  people,
  pending,
}: {
  settlement: NonNullable<LedgerEntry["settlement"]>;
  meId: string;
  people: Map<string, PersonDto>;
  pending?: boolean;
}) {
  const from = people.get(settlement.fromPersonId);
  const to = people.get(settlement.toPersonId);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[--radius-lg] border border-dashed border-line bg-surface-2/50 px-3 py-2.5",
        pending && "opacity-60",
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[--radius-md] bg-positive-soft text-positive-text">
        <ArrowLeftRight className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-text">
          {from?.id === meId ? "You" : (from?.displayName ?? "Someone")} paid{" "}
          {to?.id === meId ? "you" : (to?.displayName ?? "someone")}
        </span>
        {settlement.note || settlement.method ? (
          <span className="mt-0.5 block truncate text-[12px] text-subtle">
            {[settlement.method, settlement.note].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </span>
      <Amount
        value={settlement.amount}
        currency={settlement.currency}
        size="sm"
        tone="plain"
        className="shrink-0"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Groups entries under "Today", "Yesterday", then a month heading.
 *
 * Day-level headings for the recent past and month-level further back: a list
 * of forty individual date headings from a two-week holiday is unreadable, but
 * so is a wall of undifferentiated rows.
 */
export function groupByDay(
  items: LedgerEntry[],
): { label: string; entries: LedgerEntry[] }[] {
  const buckets = new Map<string, LedgerEntry[]>();

  for (const item of items) {
    const label = dayLabel(new Date(item.date));
    const bucket = buckets.get(label) ?? [];
    bucket.push(item);
    buckets.set(label, bucket);
  }

  return [...buckets].map(([label, entries]) => ({ label, entries }));
}

function dayLabel(date: Date): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.floor((startOfToday.getTime() - startOfDay(date).getTime()) / 86_400_000);

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: "long" });
  }
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatBare(amount: string, currency: string): string {
  return formatMoney(BigInt(amount), currency, { trimZeros: true });
}
