"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeftRight, Paperclip, MessageSquare, Receipt, Search, SlidersHorizontal, X } from "lucide-react";
import { Amount } from "../ui/money";
import { EmptyState, Skeleton, cn, haptic } from "../ui/primitives";
import { LoadMore } from "../ui/load-more";
import { Button } from "../ui/primitives";
import { Avatar } from "../ui/avatar";
import { CategoryGlyph } from "../expense/category-glyph";
import { ExpenseDetailSheet } from "../expense/detail-sheet";
import { ConfirmSheet } from "../ui/sheet";
import { useToast } from "../ui/toast";
import {
  useDeleteSettlement,
  useGroupLedger,
  useGroupStats,
  type LedgerEntry,
} from "@/lib/client/queries";
import { categoryById } from "@/lib/categories";
import { groupByDay } from "@/lib/day-groups";
import { abs, formatMoney } from "@/lib/money";
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
 *
 * No group currency is passed in: every row renders in the currency it was
 * entered in, because a trip can hold a euro dinner and a rupee taxi, and
 * relabelling either with the group's settlement currency would be a lie.
 */
export function GroupLedger({
  groupId,
  meId,
  people,
  members,
  onAdd,
}: {
  groupId: string;
  meId: string;
  people: Map<string, PersonDto>;
  /** This group's members, for the "who" filter. */
  members: PersonDto[];
  onAdd: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [debounced, setDebounced] = React.useState("");
  const [showFilters, setShowFilters] = React.useState(false);
  const [person, setPerson] = React.useState<string | null>(null);
  const [category, setCategory] = React.useState<string | null>(null);
  const [openExpenseId, setOpenExpenseId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useGroupLedger(
    groupId,
    {
      q: debounced || undefined,
      category: category ?? undefined,
      person: person ?? undefined,
    },
  );

  // The categories this group has actually spent in, biggest first. Offering
  // all thirty would be a wall of chips for things nobody in the group buys;
  // the stats endpoint already knows which ones exist and is fetched for the
  // Insights tab anyway.
  const { data: stats } = useGroupStats(groupId);
  const availableCategories = (stats?.byCategory ?? []).map((row) => row.categoryId);

  const activeFilters = (person ? 1 : 0) + (category ? 1 : 0);
  const clearFilters = () => {
    setPerson(null);
    setCategory(null);
  };

  if (isLoading) {
    return (
      <div className="space-y-2.5">
        {[0, 1, 2, 3, 4].map((index) => (
          <Skeleton key={index} className="h-[62px] w-full rounded-[var(--radius-lg)]" />
        ))}
      </div>
    );
  }

  const items = data?.pages.flatMap((page) => page.items) ?? [];
  const groups = groupByDay(items, (item) => item.date);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        {searching ? (
          <motion.div
            initial={{ opacity: 0, width: "60%" }}
            animate={{ opacity: 1, width: "100%" }}
            className="flex flex-1 items-center gap-2 rounded-[var(--radius-md)] bg-surface-2 px-3 py-2"
          >
            <Search className="size-4 shrink-0 text-subtle" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search this group"
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-subhead text-text outline-none placeholder:text-subtle/70"
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
            <p className="flex-1 text-caption font-bold uppercase tracking-[0.07em] text-subtle">
              {items.length > 0
                ? `${items.length}${hasNextPage ? "+" : ""} entries`
                : "Nothing yet"}
            </p>
            <button
              onClick={() => {
                haptic();
                setShowFilters((open) => !open);
              }}
              aria-label="Filter this group"
              aria-expanded={showFilters}
              className={cn(
                "relative flex size-8 items-center justify-center rounded-full transition active:scale-90 hover:bg-surface-2",
                activeFilters > 0 ? "text-brand" : "text-subtle",
              )}
            >
              <SlidersHorizontal className="size-[17px]" />
              {/* A dot rather than a count: with two filters the number carries
                  no information the chips below do not already show. */}
              {activeFilters > 0 ? (
                <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-brand" />
              ) : null}
            </button>
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

      <AnimatePresence initial={false}>
        {showFilters || activeFilters > 0 ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mb-3 space-y-2.5 rounded-[var(--radius-lg)] bg-surface-2 px-3 py-3">
              <FilterRow label="Who">
                {members.map((member) => (
                  <FilterChip
                    key={member.id}
                    active={person === member.id}
                    onClick={() => setPerson(person === member.id ? null : member.id)}
                  >
                    <Avatar person={member} size="xs" />
                    {member.id === meId ? "You" : member.displayName.split(" ")[0]}
                  </FilterChip>
                ))}
              </FilterRow>

              {availableCategories.length > 0 ? (
                <FilterRow label="Category">
                  {availableCategories.map((id) => {
                    const definition = categoryById(id);
                    return (
                      <FilterChip
                        key={id}
                        active={category === id}
                        onClick={() => setCategory(category === id ? null : id)}
                      >
                        <span style={{ color: `var(--avatar-${definition.color})` }}>
                          <CategoryGlyph name={definition.icon} className="size-3.5" />
                        </span>
                        {definition.name}
                      </FilterChip>
                    );
                  })}
                </FilterRow>
              ) : null}

              {activeFilters > 0 ? (
                <button
                  onClick={() => {
                    haptic();
                    clearFilters();
                  }}
                  className="text-caption font-bold text-brand transition active:scale-95"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {items.length === 0 ? (
        debounced || activeFilters > 0 ? (
          <EmptyState
            icon={<Search className="size-6" />}
            title="Nothing matches"
            description={
              debounced
                ? `No expenses in this group mention "${debounced}".`
                : "No expenses match those filters."
            }
            action={
              activeFilters > 0 ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
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
          {groups.map(({ label, precise, entries }) => (
            <section key={label}>
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
                        pending={entry.pending}
                        showDate={!precise}
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
                        groupId={groupId}
                        showDate={!precise}
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
  showDate,
}: {
  expense: NonNullable<LedgerEntry["expense"]>;
  meId: string;
  people: Map<string, PersonDto>;
  onOpen: () => void;
  showGroup?: string;
  /** Written optimistically; the server has not confirmed it yet. */
  pending?: boolean;
  /** Set when the day heading above only names a month. */
  showDate?: boolean;
}) {
  const category = categoryById(expense.categoryId);
  const net = BigInt(expense.yourNet);
  const foreign = expense.settlementCurrency !== expense.currency;
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
        "flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-3 py-2.5 text-left transition active:scale-[0.985] active:bg-surface-2 hover:border-line-strong",
        // Faded rather than spinner-topped: the row is real and its numbers are
        // already correct, so the only thing being signalled is that the server
        // has not acknowledged it. A spinner would suggest it might not be
        // there yet, which is the opposite of what we want people to believe.
        pending && "opacity-60",
      )}
    >
      {showDate ? <DateStamp date={expense.date} /> : null}

      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)]"
        style={{
          background: `color-mix(in oklch, var(--avatar-${category.color}) 15%, transparent)`,
          color: `var(--avatar-${category.color})`,
        }}
      >
        <CategoryGlyph name={category.icon} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-body-lg font-semibold text-text">
            {expense.description}
          </span>
          {expense.attachments.length > 0 ? (
            <Paperclip className="size-3 shrink-0 text-subtle" />
          ) : null}
          {expense.commentCount > 0 ? (
            <span className="flex shrink-0 items-center gap-0.5 text-micro font-semibold text-subtle">
              <MessageSquare className="size-3" />
              {expense.commentCount}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-caption text-subtle">
          {showGroup ? `${showGroup} · ` : ""}
          {paidLabel}
        </span>
      </span>

      <span className="shrink-0 text-right">
        {net === 0n ? (
          <span className="text-caption font-semibold text-subtle">not involved</span>
        ) : (
          <>
            <Amount value={net} currency={expense.currency} size="sm" />
            {/*
              A foreign expense is two figures and needs both. The amount stays
              in the currency it was paid in, because relabelling it as euros
              would be a lie — but the balance above this list is in the group's
              currency, so a row showing only pounds cannot be added up against
              it. The converted figure is what reconciles.
            */}
            {foreign ? (
              <span className="mt-0.5 block text-micro font-semibold text-subtle">
                ≈{" "}
                {formatMoney(
                  abs(BigInt(expense.yourNetConverted)),
                  expense.settlementCurrency,
                )}
              </span>
            ) : null}
            <span className="mt-0.5 block text-micro font-semibold text-subtle">
              {net > 0n ? "you lent" : "you borrowed"}
            </span>
          </>
        )}
      </span>
    </button>
  );
}

/**
 * A recorded payment, and the way to take it back.
 *
 * Recording a payment that did not happen - or recording the same one twice
 * after a flaky tap - moves a balance as surely as an invented expense does,
 * and it is a much easier mistake to make: there is nothing to check it
 * against. The row is therefore a control, not a label. Without this the API
 * route, its authorisation rules and the mutation hook were all reachable only
 * from a terminal.
 */
export function SettlementRow({
  settlement,
  meId,
  people,
  pending,
  groupId,
  showDate,
}: {
  settlement: NonNullable<LedgerEntry["settlement"]>;
  meId: string;
  people: Map<string, PersonDto>;
  pending?: boolean;
  groupId?: string;
  /** Set when the day heading above only names a month. */
  showDate?: boolean;
}) {
  const from = people.get(settlement.fromPersonId);
  const to = people.get(settlement.toPersonId);
  const toast = useToast();
  const remove = useDeleteSettlement();
  const [confirming, setConfirming] = React.useState(false);

  const fromLabel = from?.id === meId ? "You" : (from?.displayName ?? "Someone");
  const toLabel = to?.id === meId ? "you" : (to?.displayName ?? "someone");

  const undo = () => {
    remove.mutate(
      { id: settlement.id, groupId: groupId ?? null },
      {
        onSuccess: () => {
          setConfirming(false);
          toast({ tone: "success", title: "Payment removed" });
        },
        onError: (error) => {
          setConfirming(false);
          toast({
            tone: "error",
            title: "Could not remove that payment",
            description: error instanceof Error ? error.message : undefined,
          });
        },
      },
    );
  };

  return (
    <>
      <button
        type="button"
        // A payment that has not reached the server yet has no id the server
        // would recognise, so undoing it is offered once it is confirmed.
        disabled={pending}
        onClick={() => {
          haptic();
          setConfirming(true);
        }}
        aria-label={`${fromLabel} paid ${toLabel}. Remove this payment.`}
        className={cn(
          "flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-line bg-surface-2/50 px-3 py-2.5 text-left transition",
          pending ? "opacity-60" : "active:scale-[0.99] hover:bg-surface-2",
        )}
      >
      {showDate ? <DateStamp date={settlement.date} /> : null}

      <span className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-positive-soft text-positive-text">
        <ArrowLeftRight className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-lg font-semibold text-text">
          {from?.id === meId ? "You" : (from?.displayName ?? "Someone")} paid{" "}
          {to?.id === meId ? "you" : (to?.displayName ?? "someone")}
        </span>
        {settlement.note || settlement.method ? (
          <span className="mt-0.5 block truncate text-caption text-subtle">
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
      </button>

      <ConfirmSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={undo}
        loading={remove.isPending}
        title="Remove this payment?"
        description={`${fromLabel} paid ${toLabel} ${formatMoney(BigInt(settlement.amount), settlement.currency)}. Removing it puts that amount back on the balance.`}
        confirmLabel="Remove"
      />
    </>
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


function formatBare(amount: string, currency: string): string {
  return formatMoney(BigInt(amount), currency, { trimZeros: true });
}

// ---------------------------------------------------------------------------

/**
 * One labelled, horizontally scrollable row of filter chips.
 *
 * Scrolling rather than wrapping: a group with a dozen spending categories
 * would otherwise push the ledger itself off the screen, and the point of the
 * filter is to see the rows it produces.
 */
function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-tiny font-bold uppercase tracking-[0.07em] text-subtle">
        {label}
      </p>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </div>
  );
}

function FilterChip({
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
      // Pressed rather than a checkbox role: these are independent toggles, and
      // a screen reader should hear the state without inventing a group.
      aria-pressed={active}
      onClick={() => {
        haptic();
        onClick();
      }}
      className={cn(
        "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-body font-semibold transition active:scale-95",
        active
          ? "border-brand bg-brand text-white"
          : "border-line bg-surface text-muted hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The day a row happened, for lists whose heading only names a month.
 *
 * Two lines rather than one so it stays narrow enough to sit outside the
 * content column at any type size, and tabular so the numerals line up down the
 * list instead of shuffling with the glyph widths.
 */
function DateStamp({ date }: { date: string }) {
  const value = new Date(date);
  return (
    <span
      className="flex w-8 shrink-0 flex-col items-center leading-none text-subtle"
      aria-hidden="true"
    >
      <span className="text-micro font-semibold uppercase tracking-[0.06em]">
        {value.toLocaleDateString(undefined, { month: "short" })}
      </span>
      <span className="tabular mt-0.5 text-body font-semibold">
        {value.toLocaleDateString(undefined, { day: "numeric" })}
      </span>
    </span>
  );
}

