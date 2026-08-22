"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { cn, haptic } from "../ui/primitives";
import { CategoryGlyph } from "./category-glyph";
import { CATEGORIES, CATEGORY_GROUPS } from "@/lib/categories";

/**
 * Category picker.
 *
 * Grouped and shown all at once rather than searchable: the whole taxonomy is
 * thirty items, and recognising an icon is faster than typing. A search box
 * here would be a box that gets used once and ignored.
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
  return (
    <Sheet open={open} onClose={onClose} title="Category" tall>
      <div className="px-5 pb-6">
        {CATEGORY_GROUPS.map((groupName) => {
          const entries = CATEGORIES.filter((category) => category.group === groupName);
          if (entries.length === 0) return null;

          return (
            <section key={groupName} className="mb-6 last:mb-0">
              <h3 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.07em] text-subtle">
                {groupName}
              </h3>
              <div className="grid grid-cols-2 gap-2 xs:grid-cols-3">
                {entries.map((category) => {
                  const active = category.id === value;
                  return (
                    <button
                      key={category.id}
                      onClick={() => {
                        haptic();
                        onChange(category.id);
                      }}
                      className={cn(
                        "relative flex flex-col items-start gap-2 rounded-[--radius-md] border p-3 text-left transition active:scale-95",
                        active
                          ? "border-brand bg-brand-soft"
                          : "border-line bg-surface hover:bg-surface-2",
                      )}
                    >
                      <span
                        className="flex size-9 items-center justify-center rounded-[--radius-sm]"
                        style={{
                          background: `color-mix(in oklch, var(--avatar-${category.color}) 18%, transparent)`,
                          color: `var(--avatar-${category.color})`,
                        }}
                      >
                        <CategoryGlyph name={category.icon} />
                      </span>
                      <span className="text-[13px] font-semibold leading-tight text-text">
                        {category.name}
                      </span>
                      {active ? (
                        <Check
                          className="absolute right-2 top-2 size-4 text-brand"
                          strokeWidth={3}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Sheet>
  );
}
