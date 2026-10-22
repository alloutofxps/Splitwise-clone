"use client";

import * as React from "react";
import Link from "next/link";
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
 * With `linkTo`, a segment is a link to that person: it opens their screen,
 * so it is announced as a link, not a button.
 */
export function FlowBar({
  entries,
  currency,
  linkTo,
  className,
}: {
  entries: { person: PersonDto; amount: bigint }[];
  currency: string;
  linkTo?: (personId: string) => string;
  className?: string;
}) {
  const people = React.useMemo(
    () => new Map(entries.map((entry) => [entry.person.id, entry.person])),
    [entries],
  );
  const segments = barSegments(entries.map((entry) => ({ personId: entry.person.id, amount: entry.amount })));
  if (segments.length === 0) return null;

  return (
    <div
      role="list"
      aria-label="Who makes up this balance"
      // The ends are rounded on the end segments rather than clipped by the
      // bar, which clipped a segment's focus ring with them.
      className={cn(
        "flex h-2.5 w-full gap-[2px] [&>:first-child]:rounded-l-full [&>:last-child]:rounded-r-full",
        className,
      )}
    >
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
            linkTo={linkTo}
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
  linkTo,
}: {
  person: PersonDto;
  amount: bigint;
  share: number;
  currency: string;
  linkTo?: (personId: string) => string;
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

  // A tappable segment is a link inside a list item, not a link calling
  // itself one: speech software then says both "list item" and "link".
  return linkTo ? (
    <span role="listitem" className="h-full min-w-0" style={{ width: style.width }}>
      <Link
        href={linkTo(person.id)}
        aria-label={label}
        title={label}
        // Above its neighbours while focused, so they don't cover its ring.
        className="relative block size-full rounded-[inherit] transition-opacity hover:opacity-80 focus-visible:z-10"
        style={{ background: style.background }}
      />
    </span>
  ) : (
    <span role="listitem" aria-label={label} title={label} className="h-full min-w-0" style={style} />
  );
}
