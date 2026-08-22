"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { EmptyState, Skeleton, haptic } from "@/components/ui/primitives";
import { ExpenseRow } from "@/components/group/ledger";
import { ExpenseDetailSheet } from "@/components/expense/detail-sheet";
import { useDashboard, useSearch } from "@/lib/client/queries";
import { formatMoney } from "@/lib/money";
import { CATEGORIES } from "@/lib/categories";

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
      <h1 className="mb-4 text-[26px] font-black tracking-[-0.03em] text-text">Search</h1>

      <div className="sticky top-0 z-20 -mx-4 bg-bg/90 px-4 pb-3 backdrop-blur lg:-mx-8 lg:px-8">
        <label className="flex items-center gap-2.5 rounded-[--radius-md] border border-line bg-surface px-3.5 py-3 focus-within:border-brand focus-within:ring-4 focus-within:ring-[--brand-ring]">
          <Search className="size-[18px] shrink-0 text-subtle" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Boat, hotel, groceries…"
            autoFocus
            enterKeyHint="search"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-text outline-none placeholder:text-subtle/70"
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
      </div>

      {debounced.trim().length < 2 ? (
        <div className="mt-2">
          <p className="mb-2 px-1 text-[12px] font-bold uppercase tracking-[0.07em] text-subtle">
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
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-semibold text-muted transition active:scale-95 hover:bg-surface-2"
              >
                {category.name}
              </button>
            ))}
          </div>
          <p className="mt-4 px-1 text-[12px] leading-relaxed text-subtle">
            Searches descriptions and notes across every group you are in. You
            can also filter inline with <code>category:dining</code>.
          </p>
        </div>
      ) : isFetching && items.length === 0 ? (
        <div className="mt-2 space-y-2">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-[62px] w-full rounded-[--radius-lg]" />
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
            <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-subtle">
              {items.length} {items.length === 1 ? "match" : "matches"}
            </p>
            {[...totals].map(([currency, total]) => (
              <p key={currency} className="tabular text-[13px] font-semibold text-text">
                {formatMoney(total, currency)}
              </p>
            ))}
          </div>

          <ul className="space-y-1.5">
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
