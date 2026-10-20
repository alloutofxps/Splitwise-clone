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
 * Tap a segment to open that person.
 */
export function FlowBar({
  entries,
  currency,
  onSelect,
  className,
}: {
  entries: { person: PersonDto; amount: bigint }[];
  currency: string;
  onSelect?: (personId: string) => void;
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
      className={cn("flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full", className)}
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
            onSelect={onSelect}
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
  onSelect,
}: {
  person: PersonDto;
  amount: bigint;
  share: number;
  currency: string;
  onSelect?: (personId: string) => void;
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

  // A tappable segment is a button inside a list item, not a button calling
  // itself one: speech software then says both "list item" and "button".
  return onSelect ? (
    <span role="listitem" className="h-full shrink-0" style={{ width: style.width }}>
      <button
        aria-label={label}
        title={label}
        onClick={() => onSelect(person.id)}
        className="block size-full transition-opacity hover:opacity-80"
        style={{ background: style.background }}
      />
    </span>
  ) : (
    <span role="listitem" aria-label={label} title={label} className="h-full shrink-0" style={style} />
  );
}
