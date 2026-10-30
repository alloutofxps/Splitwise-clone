"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { cn, haptic } from "../ui/primitives";
import { useResetOnOpen } from "../ui/use-reset-on-open";
import { CategoryGlyph } from "./category-glyph";
import { CATEGORIES, CATEGORY_GROUPS } from "@/lib/categories";

/**
 * Category picker (DESIGN-PLAN 3.4): a four-column grid of icon and short
 * name, grouped, with a search at the top for when you know the word but not
 * where it lives. Recognising an icon is still the fast path; the search is
 * for "where's parking".
 */
export function CategoryPicker({
  open,
  onClose,
  value,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: string;
  onChange: (categoryId: string) => void;
}) {
  const [query, setQuery] = React.useState("");
  useResetOnOpen(open, () => setQuery(""));

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? CATEGORIES.filter(
        (category) =>
          category.name.toLowerCase().includes(needle) || category.group.toLowerCase().includes(needle),
      )
    : null;

  const grid = (entries: typeof CATEGORIES) => (
    <div className="grid grid-cols-4 gap-1">
      {entries.map((category) => {
        const active = category.id === value;
        return (
          <button
            key={category.id}
            onClick={() => {
              haptic();
              onChange(category.id);
            }}
            aria-pressed={active}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-[var(--radius-md)] px-1 py-2.5 text-center transition-colors",
              active ? "bg-surface-2" : "hover:bg-surface-2",
            )}
          >
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-[var(--radius-md)] transition-colors",
                active ? "bg-text text-inverse" : "bg-surface-2 text-text",
              )}
            >
              <CategoryGlyph name={category.icon} />
            </span>
            <span className="line-clamp-2 text-caption leading-tight text-text">{category.name}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Category"
      tall
      header={
        <label className="flex items-center gap-2 rounded-[var(--radius-md)] border border-field-edge bg-surface-2 px-3 py-2.5 focus-within:ring-[1.5px] focus-within:ring-text">
          <Search className="size-4 shrink-0 text-subtle" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search categories"
            aria-label="Search categories"
            className="min-w-0 flex-1 bg-transparent text-input text-text outline-none placeholder:text-subtle"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-subtle">
              <X className="size-4" />
            </button>
          ) : null}
        </label>
      }
    >
      <div className="px-4 pb-6">
        {matches ? (
          matches.length > 0 ? (
            grid(matches)
          ) : (
            <p className="py-10 text-center text-body text-muted">No category called &ldquo;{query.trim()}&rdquo;.</p>
          )
        ) : (
          CATEGORY_GROUPS.map((groupName) => {
            const entries = CATEGORIES.filter((category) => category.group === groupName);
            if (entries.length === 0) return null;
            return (
              <section key={groupName} className="mb-5 last:mb-0">
                <h3 className="mb-1 px-1 text-caption font-medium text-subtle">{groupName}</h3>
                {grid(entries)}
              </section>
            );
          })
        )}
      </div>
    </Sheet>
  );
}
