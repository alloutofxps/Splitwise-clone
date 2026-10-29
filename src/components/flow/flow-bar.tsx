"use client";

import * as React from "react";
import { barSegments } from "@/lib/flow";
import { formatMoney } from "@/lib/money";
import type { PersonDto } from "@/lib/types";
import { usePersonHue } from "../ui/avatar";
import { cn } from "../ui/primitives";

/**
 * The flow bar: a thin bar made of one segment per person, sized by how much
 * is between you (DESIGN-PLAN Part 2). Solid for people who owe you, striped
 * for people you owe, so the direction never rests on colour alone.
 *
 * With `onOpen`, the whole bar is one button that opens the list of who
 * makes it up (BreakdownSheet). Each slice used to be a link of its own, 10
 * points tall and some 17 wide: too small to tap on purpose, and easy to tap
 * by accident. The bar is 10 tall too, so its tap area reaches out to 44.
 */
export function FlowBar({
  entries,
  currency,
  onOpen,
  className,
}: {
  entries: { person: PersonDto; amount: bigint }[];
  currency: string;
  onOpen?: () => void;
  className?: string;
}) {
  const people = React.useMemo(
    () => new Map(entries.map((entry) => [entry.person.id, entry.person])),
    [entries],
  );
  const segments = barSegments(entries.map((entry) => ({ personId: entry.person.id, amount: entry.amount })));
  if (segments.length === 0) return null;

  // The ends are rounded on the end segments rather than clipped by the bar,
  // which would clip the focus ring with them.
  const shape = "flex h-2.5 w-full gap-[2px] [&>:first-child]:rounded-l-full [&>:last-child]:rounded-r-full";
  if (onOpen) {
    const count = segments.length;
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Who makes up this balance: ${count} ${count === 1 ? "person" : "people"}`}
        aria-haspopup="dialog"
        className={cn("tap-44 relative rounded-full transition-opacity hover:opacity-80", shape, className)}
      >
        {segments.map((segment) => {
          const person = people.get(segment.personId);
          return person ? (
            <Segment
              key={segment.personId}
              person={person}
              amount={segment.amount}
              share={segment.share}
              currency={currency}
              drawn
            />
          ) : null;
        })}
      </button>
    );
  }

  return (
    <div role="list" aria-label="Who makes up this balance" className={cn(shape, className)}>
      {segments.map((segment) => {
        const person = people.get(segment.personId);
        if (!person) return null;
        return (
          <Segment
            key={segment.personId}
            person={person}
            amount={segment.amount}
            share={segment.share}
            currency={currency}
          />
        );
      })}
    </div>
  );
}

function Segment({
  person,
  amount,
  share,
  currency,
  drawn,
}: {
  person: PersonDto;
  amount: bigint;
  share: number;
  currency: string;
  /** Only drawn: the button around the bar says what it is. */
  drawn?: boolean;
}) {
  const hue = usePersonHue(person);
  const owesYou = amount > 0n;
  const money = formatMoney(owesYou ? amount : -amount, currency);
  const label = owesYou ? `${person.displayName} owes you ${money}` : `You owe ${person.displayName} ${money}`;
  const style: React.CSSProperties = {
    width: `${share * 100}%`,
    background: owesYou
      ? hue
      : `repeating-linear-gradient(135deg, ${hue} 0 3px, color-mix(in oklch, ${hue} 35%, var(--surface)) 3px 6px)`,
  };

  return drawn ? (
    <span aria-hidden className="h-full min-w-0" style={style} />
  ) : (
    <span role="listitem" aria-label={label} title={label} className="h-full min-w-0" style={style} />
  );
}
