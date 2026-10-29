"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { DURATION, EASE_STANDARD } from "@/components/ui/motion";
import { Copy, Paperclip, MessageSquare, Pencil, Receipt, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { ActionSheet, SwipeRow, useLongPress } from "../ui/swipe-row";
import { useComposer } from "../expense/composer-context";
import { Amount } from "../ui/money";
import { EmptyState, Skeleton, cn, haptic } from "../ui/primitives";
import { LoadMore } from "../ui/load-more";
import { Arrival, useArrivals } from "../ui/arrival";
import { Button } from "../ui/primitives";
import { Avatar, usePersonHue } from "../ui/avatar";
import { CategoryGlyph } from "../expense/category-glyph";
import { ExpenseDetailSheet } from "../expense/detail-sheet";
import { ConfirmSheet } from "../ui/sheet";
import { useToast } from "../ui/toast";
import {
  useDeleteExpense,
  useDeleteSettlement,
  useGroupLedger,
  useRestoreExpense,
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
  const [editOnOpen, setEditOnOpen] = React.useState(false);
  // One function for every row, so a row's props only change when its entry
  // does (LedgerExpenseRow).
  const openExpense = React.useCallback((id: string, edit: boolean) => {
    setEditOnOpen(edit);
    setOpenExpenseId(id);
  }, []);

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

  const items = data?.pages.flatMap((page) => page.items) ?? [];
  // A just-added expense lands in its place once the panel has gone, so it
  // reads as "arrived" rather than as the list redrawing.
  const isArriving = useArrivals(items, `${debounced}|${person}|${category}`, !isLoading);

  if (isLoading) {
    return (
      <div className="ring-inside divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-card">
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-10 shrink-0 rounded-[var(--radius-md)]" />
            <span className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </span>
          </div>
        ))}
      </div>
    );
  }

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
              className="min-w-0 flex-1 bg-transparent text-input text-text outline-none placeholder:text-subtle/70"
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
            <span className="flex-1" />
            <button
              onClick={() => {
                haptic();
                setShowFilters((open) => !open);
              }}
              aria-label="Filter this group"
              aria-expanded={showFilters}
              className={cn(
                // 44 wide, side by side with Search; tap-44 adds the height.
                "tap-44 relative flex h-8 min-w-11 items-center justify-center gap-1.5 rounded-full px-2 text-body font-medium transition-colors hover:bg-surface-2",
                activeFilters > 0 ? "text-text" : "text-muted",
              )}
            >
              <SlidersHorizontal className="size-[17px]" strokeWidth={1.75} />
              <span className="hidden sm:inline">Filter</span>
              {/* A dot rather than a count: with two filters the number carries
                  no information the chips below do not already show. */}
              {activeFilters > 0 ? (
                <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-text" />
              ) : null}
            </button>
            <button
              onClick={() => {
                haptic();
                setSearching(true);
              }}
              aria-label="Search this group"
              className="tap-44 relative flex h-8 min-w-11 items-center justify-center gap-1.5 rounded-full px-2 text-body font-medium text-muted transition-colors hover:bg-surface-2"
            >
              <Search className="size-[17px]" strokeWidth={1.75} />
              <span className="hidden sm:inline">Search</span>
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
            transition={{ duration: DURATION.change, ease: EASE_STANDARD }}
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
                    <bdi>{member.id === meId ? "You" : member.displayName.split(" ")[0]}</bdi>
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
                        <CategoryGlyph name={definition.icon} className="size-3.5" />
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
                  className="text-caption font-semibold text-brand transition active:opacity-70"
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
            description="Add the first one and everyone's balance updates right away."
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
              <h3 className="mb-2 px-1 text-caption font-medium text-subtle">{label}</h3>
              <ul className="ring-inside divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-card">
                <AnimatePresence initial={false}>
                {entries.map((entry) =>
                  entry.kind === "expense" && entry.expense ? (
                    <Arrival key={entry.expense.id} arriving={isArriving(entry)}>
                      <LedgerExpenseRow
                        expense={entry.expense}
                        meId={meId}
                        people={people}
                        pending={entry.pending}
                        showDate={!precise}
                        onOpenExpense={openExpense}
                      />
                    </Arrival>
                  ) : entry.settlement ? (
                    <Arrival key={entry.settlement.id} arriving={isArriving(entry)}>
                      <LedgerSettlementRow
                        settlement={entry.settlement}
                        meId={meId}
                        people={people}
                        pending={entry.pending}
                        groupId={groupId}
                        showDate={!precise}
                      />
                    </Arrival>
                  ) : null,
                )}
                </AnimatePresence>
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
        startInEdit={editOnOpen}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

/*
 * The ledger's rows, redrawn only when their own entry changes. Saving a
 * payment or an expense redraws the ledger, and every row used to redraw
 * with it, on the same beat as the panel leaving. The query keeps an
 * unchanged entry as the same object, so comparing props is enough.
 */
const LedgerExpenseRow = React.memo(function LedgerExpenseRow({
  onOpenExpense,
  ...props
}: Omit<ExpenseRowProps, "onOpen" | "onEdit"> & { onOpenExpense: (id: string, edit: boolean) => void }) {
  const id = props.expense.id;
  return <ExpenseRow {...props} onOpen={() => onOpenExpense(id, false)} onEdit={() => onOpenExpense(id, true)} />;
});

const LedgerSettlementRow = React.memo(SettlementRow);

type ExpenseRowProps = {
  expense: NonNullable<LedgerEntry["expense"]>;
  meId: string;
  people: Map<string, PersonDto>;
  onOpen: () => void;
  /** Opens it for editing; defaults to opening it. */
  onEdit?: () => void;
  showGroup?: string;
  /** Written optimistically; the server has not confirmed it yet. */
  pending?: boolean;
  /** Set when the day heading above only names a month. */
  showDate?: boolean;
};

/**
 * An expense in a list. Tap to open it; swipe left to delete it (with Undo);
 * long-press or right-click for Edit, Duplicate and Delete (DESIGN-PLAN
 * Part 4). A row the server hasn't confirmed yet takes no gestures.
 */
export function ExpenseRow(props: ExpenseRowProps) {
  const { expense, onOpen, onEdit, pending } = props;
  const toast = useToast();
  const composer = useComposer();
  const remove = useDeleteExpense();
  const restore = useRestoreExpense();
  const [menu, setMenu] = React.useState(false);
  const press = useLongPress(() => setMenu(true));

  const remove_ = () =>
    remove.mutate(
      { id: expense.id, groupId: expense.groupId },
      {
        onSuccess: () =>
          toast({
            tone: "success",
            title: `Deleted ${expense.description}`,
            action: {
              label: "Undo",
              onClick: () => restore.mutate({ id: expense.id, groupId: expense.groupId }),
            },
          }),
        onError: () => toast({ tone: "error", title: "Couldn\u2019t delete that" }),
      },
    );

  if (pending) return <ExpenseRowButton {...props} onPress={onOpen} />;

  return (
    <>
      <SwipeRow action={{ label: "Delete", ariaLabel: `Delete ${expense.description}`, onPress: remove_ }}>
        {({ open, close }) => (
          <ExpenseRowButton
            {...props}
            pressHandlers={press.handlers}
            onPress={() => {
              if (press.consumed()) return;
              if (open) return close();
              onOpen();
            }}
          />
        )}
      </SwipeRow>
      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        title={expense.description}
        actions={[
          { label: "Edit", icon: <Pencil className="size-[18px]" strokeWidth={1.75} />, onPress: onEdit ?? onOpen },
          {
            label: "Duplicate",
            icon: <Copy className="size-[18px]" strokeWidth={1.75} />,
            onPress: () => composer.open(expense.groupId ?? undefined, expense),
          },
          { label: "Delete", icon: <Trash2 className="size-[18px]" strokeWidth={1.75} />, tone: "danger", onPress: remove_ },
        ]}
      />
    </>
  );
}

function ExpenseRowButton({
  expense,
  meId,
  people,
  showGroup,
  pending,
  showDate,
  onPress,
  pressHandlers,
}: ExpenseRowProps & {
  onPress: () => void;
  pressHandlers?: ReturnType<typeof useLongPress>["handlers"];
}) {
  const category = categoryById(expense.categoryId);
  const net = BigInt(expense.yourNet);
  const foreign = expense.settlementCurrency !== expense.currency;
  const payer = expense.payers[0] ? people.get(expense.payers[0].personId) : undefined;

  // Who paid, and what. The name gives way when space runs short, never the
  // amount: a long name cut "Alexandra paid €9,999,…" mid-number.
  const payerName =
    expense.payers.length === 1 && payer ? (payer.id === meId ? "You" : payer.displayName.split(" ")[0]) : null;
  const paidLabel = expense.payers.length > 1 ? `${expense.payers.length} people paid` : "";

  return (
    <button
      {...pressHandlers}
      onClick={() => {
        haptic();
        onPress();
      }}
      className={cn(
        "flex w-full select-none items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 active:bg-surface-2",
        // Faded rather than spinner-topped: the row is real and its numbers are
        // already correct, so the only thing being signalled is that the server
        // has not acknowledged it. A spinner would suggest it might not be
        // there yet, which is the opposite of what we want people to believe.
        pending && "opacity-60",
      )}
    >
      {showDate ? <DateStamp date={expense.date} /> : null}

      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface-2 text-text"
      >
        <CategoryGlyph name={category.icon} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span dir="auto" className="truncate text-left text-body-lg font-medium text-text">
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
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-caption text-subtle">
          {showGroup ? <span className="min-w-0 truncate">{showGroup} ·</span> : null}
          {payer && expense.payers.length === 1 ? <PersonDot person={payer} /> : null}
          {payerName ? (
            <span className="flex min-w-0 gap-1">
              <span dir="auto" className="min-w-0 truncate text-left">
                {payerName}
              </span>
              <span className="shrink-0">paid {formatBare(expense.amount, expense.currency)}</span>
            </span>
          ) : (
            <span className="truncate">{paidLabel}</span>
          )}
        </span>
      </span>

      <span className="shrink-0 text-right">
        {net === 0n ? (
          <span className="text-caption text-subtle">not involved</span>
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
              <span className="mt-0.5 block text-caption text-subtle">
                ≈{" "}
                {formatMoney(
                  abs(BigInt(expense.yourNetConverted)),
                  expense.settlementCurrency,
                )}
              </span>
            ) : null}
            <span className="mt-0.5 block text-caption text-subtle">
              {net > 0n ? "you lent" : "you owe"}
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
            title: "Couldn't remove that payment",
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
          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
          pending ? "opacity-60" : "hover:bg-surface-2 active:bg-surface-2",
        )}
      >
      {showDate ? <DateStamp date={settlement.date} /> : null}

      <PairGlyph from={from} to={to} />
      <span className="min-w-0 flex-1">
        {/* First names, each cut on its own, so "paid you" always shows: a long
            name used to push it off the end and leave just the name. */}
        <span className="flex min-w-0 gap-1 text-body-lg font-medium text-text">
          <bdi className="min-w-0 truncate">{from?.id === meId ? "You" : (from?.displayName.split(" ")[0] ?? "Someone")}</bdi>
          <span className="shrink-0">paid</span>
          <bdi className="min-w-0 truncate">{to?.id === meId ? "you" : (to?.displayName.split(" ")[0] ?? "someone")}</bdi>
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
        description={`${fromLabel} paid ${toLabel} ${formatMoney(BigInt(settlement.amount), settlement.currency)}. If you remove it, that amount will be owed again.`}
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
  return formatMoney(BigInt(amount), currency);
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
      <p className="mb-1.5 text-caption font-medium text-subtle">
        {label}
      </p>
      <div className="-mx-1 -mt-1 -mb-0.5 flex gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
        "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-body font-semibold transition active:opacity-70",
        active
          ? "border-text bg-text text-inverse"
          : "border-line bg-surface text-text hover:bg-surface-2",
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
      <span className="text-caption font-medium">
        {value.toLocaleDateString(undefined, { month: "short" })}
      </span>
      <span className="tabular mt-0.5 text-body font-semibold">
        {value.toLocaleDateString(undefined, { day: "numeric" })}
      </span>
    </span>
  );
}

/** A person's colour as a small dot, beside their name in a caption. */
function PersonDot({ person }: { person: PersonDto }) {
  const hue = usePersonHue(person);
  return <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: hue }} />;
}

/**
 * A payment's mark: two dots, payer and payee in their own colours, joined by
 * the line the money travelled along. The same picture as the flow map, small.
 */
function PairGlyph({ from, to }: { from?: PersonDto; to?: PersonDto }) {
  const fromHue = usePersonHue(from ?? { avatarColor: "sand" });
  const toHue = usePersonHue(to ?? { avatarColor: "sand" });
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface-2">
      <svg viewBox="0 0 28 16" className="h-4 w-7" aria-hidden="true">
        <path d="M 5 11 Q 14 1 23 5" fill="none" stroke="var(--text-subtle)" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="5" cy="11" r="4" fill={fromHue} />
        <circle cx="23" cy="5" r="4" fill={toHue} />
      </svg>
    </span>
  );
}
