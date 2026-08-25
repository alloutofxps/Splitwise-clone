"use client";

import * as React from "react";
import { Check, Search } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { cn, haptic } from "../ui/primitives";
import { CURRENCIES } from "@/lib/money";
import { useResetOnOpen } from "../ui/use-reset-on-open";

/**
 * Currency picker.
 *
 * Fifty-odd entries, so this one does get a search box - and it matches on both
 * the code and the name, because half of users think "rupee" and half think
 * "INR".
 */
export function CurrencyPicker({
  open,
  onClose,
  value,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: string;
  onChange: (currency: string) => void;
}) {
  const [query, setQuery] = React.useState("");

  useResetOnOpen(open, () => setQuery(""));

  const term = query.trim().toLowerCase();
  const results = term
    ? CURRENCIES.filter(
        (entry) =>
          entry.code.toLowerCase().includes(term) ||
          entry.name.toLowerCase().includes(term) ||
          entry.symbol.toLowerCase().includes(term),
      )
    : CURRENCIES;

  return (
    <Sheet open={open} onClose={onClose} title="Currency" tall>
      <div className="px-5 pb-6">
        <div className="sticky top-0 z-10 -mx-5 bg-elevated px-5 pb-3">
          <label className="flex items-center gap-2.5 rounded-[var(--radius-md)] bg-surface-2 px-3.5 py-2.5">
            <Search className="size-4 shrink-0 text-subtle" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search currencies"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-subhead text-text outline-none placeholder:text-subtle/70"
            />
          </label>
        </div>

        <ul className="space-y-0.5">
          {results.map((entry) => {
            const active = entry.code === value;
            return (
              <li key={entry.code}>
                <button
                  onClick={() => {
                    haptic();
                    onChange(entry.code);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left transition active:scale-[0.985]",
                    active ? "bg-brand-soft" : "hover:bg-surface-2",
                  )}
                >
                  <span className="text-title-lg leading-none">{entry.flag}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body-lg font-semibold text-text">
                      {entry.code}
                    </span>
                    <span className="block truncate text-caption text-subtle">
                      {entry.name}
                    </span>
                  </span>
                  <span className="shrink-0 text-body-lg font-semibold text-muted">
                    {entry.symbol}
                  </span>
                  {active ? (
                    <Check className="size-[18px] shrink-0 text-brand" strokeWidth={3} />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        {results.length === 0 ? (
          <p className="py-10 text-center text-body-lg text-muted">
            Nothing matches &ldquo;{query}&rdquo;.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
