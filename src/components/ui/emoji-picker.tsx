"use client";

import * as React from "react";
import { Sheet } from "./sheet";
import { cn, haptic } from "./primitives";
import { EMOJI_GROUPS } from "@/lib/emoji";

/**
 * The full avatar-emoji grid.
 *
 * Lives in a sheet rather than expanding in place, because it is 128 targets
 * and the screens that open it — onboarding and the account page — both have
 * something more important below the fold.
 *
 * "Use my initials" is the first option rather than a way to clear a choice
 * afterwards. It is what the app does by default, so it belongs in the list of
 * things you can pick, not hidden behind a reset.
 */
export function EmojiPicker({
  open,
  onClose,
  value,
  onSelect,
  initials,
}: {
  open: boolean;
  onClose: () => void;
  /** Currently chosen emoji, or null for initials. */
  value: string | null;
  onSelect: (emoji: string | null) => void;
  /** Shown on the "use my initials" tile so the choice is previewed, not described. */
  initials: string;
}) {
  const choose = (emoji: string | null) => {
    haptic();
    onSelect(emoji);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Pick an emoji" tall>
      <div className="px-5 pb-6">
        <button
          onClick={() => choose(null)}
          aria-pressed={value === null}
          className={cn(
            "mb-5 flex w-full items-center gap-3 rounded-[var(--radius-md)] border px-3.5 py-3 text-left transition active:scale-[0.985]",
            value === null ? "border-brand/40 bg-brand-soft" : "border-line bg-surface",
          )}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-body-lg font-bold text-text">
            {initials}
          </span>
          <span className="text-body-lg font-semibold text-text">Use my initials</span>
        </button>

        {EMOJI_GROUPS.map((group) => (
          <div key={group.name} className="mb-5 last:mb-0">
            <h3 className="mb-2 text-caption font-bold uppercase tracking-[0.07em] text-subtle">
              {group.name}
            </h3>
            {/* Six across at 390px, more as the sheet widens. */}
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
              {group.emoji.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => choose(emoji)}
                  aria-label={emoji}
                  aria-pressed={value === emoji}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-[var(--radius-sm)] text-title-lg transition active:scale-90",
                    value === emoji ? "bg-brand-soft ring-2 ring-brand" : "hover:bg-surface-2",
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
