"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { usePrefetch } from "@/lib/client/queries";
import type { PersonDto } from "@/lib/types";
import { Avatar } from "../ui/avatar";
import { Amount } from "../ui/money";
import { useOpenScreen } from "../ui/open-screen";
import { Sheet } from "../ui/sheet";

/**
 * Who makes up a balance, one full-size row each, largest first: what tapping
 * Home's flow bar opens. The bar's slices used to be links of their own, 10
 * points tall and down to 17 wide, too small to tap on purpose and easy to
 * tap by accident (findings item 6).
 */
export function BreakdownSheet({
  open,
  onClose,
  entries,
  currency,
}: {
  open: boolean;
  onClose: () => void;
  entries: { person: PersonDto; amount: bigint }[];
  currency: string;
}) {
  const prefetch = usePrefetch();
  const openScreen = useOpenScreen();
  const rows = [...entries]
    .filter((entry) => entry.amount !== 0n)
    .sort((a, b) => {
      const size = (n: bigint) => (n < 0n ? -n : n);
      return size(b.amount) > size(a.amount) ? 1 : size(b.amount) < size(a.amount) ? -1 : 0;
    });

  return (
    <Sheet open={open} onClose={onClose} title="Who makes up this balance">
      <div className="px-5 pb-8">
        <ul className="ring-inside relative divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-card">
          {rows.map(({ person, amount }) => {
            const href = `/friends/${person.id}`;
            const load = () => prefetch.friend(person.id);
            return (
              <li key={person.id}>
                <Link
                  href={href}
                  prefetch
                  onPointerDown={() => void load()}
                  onClick={(event) => openScreen(event, href, load())}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 active:bg-surface-2"
                >
                  <Avatar person={person} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="block truncate text-body font-medium text-text">
                      {person.displayName}
                    </span>
                    <span className="mt-0.5 block text-caption text-subtle">
                      {amount > 0n ? "owes you" : "you owe"}
                    </span>
                  </span>
                  <Amount value={amount} currency={currency} size="sm" arrow />
                  <ChevronRight className="size-4 shrink-0 text-subtle" />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </Sheet>
  );
}
