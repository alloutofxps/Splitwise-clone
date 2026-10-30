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
 *
 * With `fit`, it shows only as many as fit across, and counts the rest in the
 * "+N": with the largest text, a group's six faces ran off the edge of the
 * screen. It drops one at a time until nothing overflows, and starts again
 * from `max` when the space around it changes width.
 */
export function AvatarStack({
  people,
  max = 4,
  size = "sm",
  fit = false,
  className,
}: {
  people: PersonDto[];
  max?: number;
  size?: AvatarSize;
  fit?: boolean;
  className?: string;
}) {
  const stack = React.useRef<HTMLDivElement>(null);
  const [limit, setLimit] = React.useState(max);
  // Bumped to measure again even when `limit` is already `max`.
  const [pass, setPass] = React.useState(0);
  React.useLayoutEffect(() => {
    const element = stack.current;
    if (!fit || !element || limit <= 1) return;
    // Where the faces are against the stack's own edges: scrollWidth misses
    // what spills out of a reversed row in Chrome.
    const box = element.getBoundingClientRect();
    const spills = [...element.children].some((face) => {
      const at = face.getBoundingClientRect();
      return at.left < box.left - 1 || at.right > box.right + 1;
    });
    if (spills) setLimit(limit - 1);
  }, [fit, limit, pass, people, size]);
  React.useEffect(() => {
    // Start again from `max` when the room changes (the section it sits in,
    // not the stack or its button, which change width as faces come and go)
    // or the faces change size (the text size changed).
    const element = stack.current;
    const around = element?.closest("section") ?? document.body;
    const face = element?.lastElementChild;
    if (!fit || !face || typeof ResizeObserver === "undefined") return;
    let seen = `${around.clientWidth} ${face.clientWidth}`;
    const observer = new ResizeObserver(() => {
      const now = `${around.clientWidth} ${face.clientWidth}`;
      if (now === seen) return;
      seen = now;
      setLimit(max);
      setPass((count) => count + 1);
    });
    observer.observe(around);
    observer.observe(face);
    return () => observer.disconnect();
  }, [fit, max]);

  const shown = people.slice(0, fit ? Math.min(max, limit) : max);
  const overflow = people.length - shown.length;

  return (
    <div
      ref={stack}
      // Room for the rings, which overflow-hidden would otherwise clip.
      className={cn("flex flex-row-reverse items-center justify-end", fit && "-m-0.5 max-w-full overflow-hidden p-0.5", className)}
    >
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
          // Each overlaps the one to its left; in this reversed row that is
          // the next in the list, so the last (leftmost) has none to overlap.
          // It used to be the first, and the leftmost face stuck out 6px.
          className="-ml-1.5 last:ml-0"
        />
      ))}
    </div>
  );
}
