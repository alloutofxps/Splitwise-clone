"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { EmptyState, Skeleton, haptic } from "@/components/ui/primitives";
import { ExpenseRow } from "@/components/group/ledger";
import { ExpenseDetailSheet } from "@/components/expense/detail-sheet";
import { useDashboard, useSearch } from "@/lib/client/queries";
import { formatMoney } from "@/lib/money";
import { CATEGORIES } from "@/lib/categories";
import { StickyBar } from "@/components/ui/sticky";

/**
 * Search across everything.
 *
 * Another feature that is normally behind a subscription, which never made
 * sense to me: the reason to keep six years of expenses is to be able to answer
 * "what did we pay for that boat?".
 *
 * Supports inline filters (`category:dining`) alongside free text, and shows a
 * running total of what matched — often the actual question behind the search.
 */
export default function SearchPage() {
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [openExpenseId, setOpenExpenseId] = React.useState<string | null>(null);

  const { data: dashboard } = useDashboard();
  const { data, isFetching } = useSearch(debounced);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 280);
    return () => clearTimeout(timer);
  }, [query]);

  const people = React.useMemo(
    () => new Map((dashboard?.people ?? []).map((person) => [person.id, person])),
    [dashboard?.people],
  );

  const groupNames = React.useMemo(
    () => new Map((data?.groups ?? []).map((group) => [group.id, `${group.emoji} ${group.name}`])),
    [data?.groups],
  );

  const items = data?.items ?? [];

  // Totals only make sense per currency, so they are bucketed rather than summed.
  const totals = new Map<string, bigint>();
  for (const expense of items) {
    totals.set(
      expense.currency,
      (totals.get(expense.currency) ?? 0n) + BigInt(expense.amount),
    );
  }

  return (
    <div className="pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h1 className="mb-4 text-display-sm font-semibold tracking-[-0.03em] text-text">Search</h1>

      <StickyBar className="-mx-4 bg-bg px-4 pb-3 lg:-mx-8 lg:px-8">
        <label className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--card-border)] bg-surface px-3.5 py-3 focus-within:border-brand focus-within:ring-[1.5px] focus-within:ring-text">
          <Search className="size-[18px] shrink-0 text-subtle" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Boat, hotel, groceries…"
            autoFocus
            enterKeyHint="search"
            className="min-w-0 flex-1 bg-transparent text-input text-text outline-none placeholder:text-subtle/70"
          />
          {query ? (
            <button
              onClick={() => {
                haptic();
                setQuery("");
              }}
              aria-label="Clear search"
              className="shrink-0 text-subtle"
            >
              <X className="size-[18px]" />
            </button>
          ) : null}
        </label>
      </StickyBar>

      {debounced.trim().length < 2 ? (
        <div className="mt-2">
          <p className="mb-2 px-1 text-caption font-medium text-subtle">
            Try a category
          </p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.filter((category) =>
              ["dining", "groceries", "accommodation", "transport", "drinks", "taxi", "entertainment", "utilities"].includes(
                category.id,
              ),
            ).map((category) => (
              <button
                key={category.id}
                onClick={() => {
                  haptic();
                  setQuery(`category:${category.id}`);
                }}
                className="rounded-full border border-[var(--card-border)] bg-surface px-3 py-1.5 text-body font-semibold text-muted transition active:opacity-70 hover:bg-surface-2"
              >
                {category.name}
              </button>
            ))}
          </div>
          <p className="mt-4 px-1 text-caption leading-relaxed text-subtle">
            Searches the names and notes of expenses in all your groups. Tip: type
            <code>category:dining</code> to see only one category.
          </p>
        </div>
      ) : isFetching && items.length === 0 ? (
        <div className="mt-2 space-y-2">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-[62px] w-full rounded-[var(--radius-lg)]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Search className="size-6" />}
          title="Nothing found"
          description={`No expenses match "${debounced}".`}
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
            <p className="text-caption font-medium text-subtle">
              {items.length} {items.length === 1 ? "match" : "matches"}
            </p>
            {[...totals].map(([currency, total]) => (
              <p key={currency} className="tabular text-body font-semibold text-text">
                {formatMoney(total, currency)}
              </p>
            ))}
          </div>

          <ul className="ring-inside divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-card">
            {items.map((expense) => (
              <li key={expense.id}>
                <ExpenseRow
                  expense={expense}
                  meId={dashboard?.me.id ?? ""}
                  people={people}
                  onOpen={() => setOpenExpenseId(expense.id)}
                  showGroup={
                    expense.groupId ? groupNames.get(expense.groupId) : "Direct"
                  }
                />
              </li>
            ))}
          </ul>
        </>
      )}

      <ExpenseDetailSheet
        expenseId={openExpenseId}
        onClose={() => setOpenExpenseId(null)}
        meId={dashboard?.me.id ?? ""}
        people={people}
      />
    </div>
  );
}
