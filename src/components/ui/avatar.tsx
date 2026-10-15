"use client";

import * as React from "react";
import { cn } from "./primitives";
import { hueVar, initials, resolveHues, type AvatarColor } from "@/lib/avatar";
import type { PersonDto } from "@/lib/types";

/**
 * Hues for the people on screen, when two of them chose the same one. A group
 * screen wraps itself in this so nobody in the group shares a colour; outside
 * a group, everyone simply shows their own.
 */
const HueContext = React.createContext<Map<string, AvatarColor> | null>(null);

export function GroupHues({
  members,
  children,
}: {
  members: { id: string; avatarColor: string }[];
  children: React.ReactNode;
}) {
  const hues = React.useMemo(() => resolveHues(members), [members]);
  return <HueContext.Provider value={hues}>{children}</HueContext.Provider>;
}

/** The colour to draw a person in, here. */
export function usePersonHue(person: { id?: string; avatarColor: string }): string {
  const hues = React.useContext(HueContext);
  const resolved = person.id ? hues?.get(person.id) : undefined;
  return hueVar(resolved ?? person.avatarColor);
}

const SIZES = {
  xs: "size-6 text-micro",
  sm: "size-8 text-caption",
  md: "size-10 text-body-lg",
  lg: "size-14 text-title-lg",
  xl: "size-20 text-display-sm",
} as const;

export type AvatarSize = keyof typeof SIZES;

/**
 * A person, rendered as their initials on a colour derived from their name.
 *
 * No photo uploads anywhere in the app: nobody sets one, half the group ends up
 * as grey silhouettes, and the list becomes unreadable. Deterministic colour
 * plus initials is recognisable at 24px and needs nothing from the user.
 */
export function Avatar({
  person,
  size = "md",
  className,
  ring,
  single,
}: {
  person: Pick<PersonDto, "displayName" | "avatarColor" | "avatarEmoji" | "isGhost"> & { id?: string };
  size?: AvatarSize;
  className?: string;
  /** Draws a ring in the surface colour, for overlapping stacks. */
  ring?: boolean;
  /**
   * One letter instead of two. Overlapping stacks leave only a sliver of each
   * avatar visible, and two initials in that sliver get sliced in half.
   */
  single?: boolean;
}) {
  const label = initials(person.displayName);
  const colour = usePersonHue(person);

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-[var(--on-person)]",
        SIZES[size],
        ring && "ring-2 ring-surface",
        className,
      )}
      // Someone not on Divvy yet is an outline in their colour rather than a
      // filled disc: the same person, not quite here.
      style={
        person.isGhost
          ? { background: "var(--surface)", color: colour, boxShadow: `inset 0 0 0 1.5px ${colour}` }
          : { background: colour }
      }
      aria-hidden
    >
      {person.avatarEmoji ? (
        <span className="text-[1.15em] leading-none">{person.avatarEmoji}</span>
      ) : (
        <span className="leading-none tracking-[-0.02em]">
          {single ? label.slice(0, 1) : label}
        </span>
      )}
    </span>
  );
}

/**
 * Overlapping avatars for a group row.
 *
 * Reversed flex order so earlier avatars paint *over* later ones - otherwise
 * each new avatar covers the previous one's initials and the stack reads as a
 * single blob.
 */
export function AvatarStack({
  people,
  max = 4,
  size = "sm",
  className,
}: {
  people: PersonDto[];
  max?: number;
  size?: AvatarSize;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;

  return (
    <div className={cn("flex flex-row-reverse items-center justify-end", className)}>
      {overflow > 0 ? (
        <span
          className={cn(
            "-ml-1.5 inline-flex items-center justify-center rounded-full bg-surface-2 font-semibold text-muted ring-2 ring-surface",
            SIZES[size],
          )}
        >
          +{overflow}
        </span>
      ) : null}
      {[...shown].reverse().map((person) => (
        <Avatar
          key={person.id}
          person={person}
          size={size}
          ring
          single
          className="-ml-1.5 first:ml-0"
        />
      ))}
    </div>
  );
}
