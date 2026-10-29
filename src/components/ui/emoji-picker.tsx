"use client";

import * as React from "react";
import { Sheet } from "./sheet";
import { cn, haptic } from "./primitives";
import { EMOJI_GROUPS } from "@/lib/emoji";
import { AVATAR_COLORS, hueVar, normalizeColor, type AvatarColor } from "@/lib/avatar";

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
  color,
  onColor,
}: {
  /** The person's colour; with `onColor`, the sheet also offers the palette. */
  color?: string;
  onColor?: (color: AvatarColor) => void;
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
    <Sheet open={open} onClose={onClose} title={onColor ? "How you look" : "Pick an emoji"} tall>
      <div className="px-5 pb-6">
        {onColor ? (
          // One sheet for how you look (DESIGN-PLAN 3.9): your colour, then
          // initials or an emoji. Picking a colour keeps the sheet open.
          <div className="mb-6">
            <h3 className="mb-2 text-caption font-medium text-subtle">Your colour</h3>
            {/* Two rows of five: ten in a row left each one 30 points, with no
                room around it for a 44-point tap area. */}
            <div className="grid grid-cols-5 gap-x-1.5 gap-y-2">
              {AVATAR_COLORS.map((option) => (
                <button
                  key={option}
                  onClick={() => {
                    haptic();
                    onColor(option);
                  }}
                  aria-label={`Use the ${option} colour`}
                  aria-pressed={normalizeColor(color) === option}
                  className={cn(
                    "tap-44 relative aspect-square w-full max-w-9 justify-self-center rounded-full transition-opacity active:opacity-70",
                    normalizeColor(color) === option && "outline-2 outline-offset-2 outline-text outline-solid",
                  )}
                  style={{ background: hueVar(option) }}
                />
              ))}
            </div>
          </div>
        ) : null}
        <button
          onClick={() => choose(null)}
          aria-pressed={value === null}
          className={cn(
            "mb-5 flex w-full items-center gap-3 rounded-[var(--radius-md)] border px-3.5 py-3 text-left transition-colors",
            value === null ? "border-text bg-surface-2" : "border-line bg-surface hover:bg-surface-2",
          )}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-body-lg font-semibold text-text">
            {initials}
          </span>
          <span className="text-body-lg font-semibold text-text">Use my initials</span>
        </button>

        {EMOJI_GROUPS.map((group) => (
          <div key={group.name} className="mb-5 last:mb-0">
            <h3 className="mb-2 text-caption font-medium text-subtle">
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
                    "flex aspect-square items-center justify-center rounded-[var(--radius-sm)] text-title-lg transition active:opacity-70",
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
